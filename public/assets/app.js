(async function () {
  "use strict";

  let content;
  let me = null;
  try {
    const [res, meRes] = await Promise.all([fetch("/api/content", { cache: "no-cache" }), fetch("/api/me", { cache: "no-store" })]);
    if (res.status === 401) return (location.href = "/login?next=/");
    if (res.status === 403) return (location.href = "/account?welcome=1");
    if (!res.ok) throw new Error(res.status);
    content = await res.json();
    me = (await meRes.json()).user;
  } catch (e) {
    document.getElementById("sections").innerHTML =
      '<div class="panel error"><h2>Couldn\'t load content</h2><p>The server didn\'t respond. Refresh the page, or try again in a minute.</p></div>';
    return;
  }

  // ---------------------------------------------------------------------------
  // File types
  // ---------------------------------------------------------------------------
  const TYPES = {
    sop:        { label: "SOP",        icon: "📋" },
    pdf:        { label: "PDF",        icon: "📕" },
    word:       { label: "Word",       icon: "📘" },
    excel:      { label: "Excel",      icon: "📗" },
    macro:      { label: "Macro",      icon: "⚙️" },
    powerpoint: { label: "PowerPoint", icon: "📙" },
    website:    { label: "Website",    icon: "🌐" },
    video:      { label: "Video",      icon: "🎬" },
    form:       { label: "Form",       icon: "📝" },
    image:      { label: "Image",      icon: "🖼️" },
    other:      { label: "Other",      icon: "📄" },
  };

  const EXT_TYPES = {
    pdf: "pdf",
    doc: "word", docx: "word", dotx: "word", rtf: "word", odt: "word",
    xls: "excel", xlsx: "excel", csv: "excel", ods: "excel",
    xlsm: "macro", xlsb: "macro", xltm: "macro", xlam: "macro", bas: "macro",
    ppt: "powerpoint", pptx: "powerpoint", ppsx: "powerpoint",
    mp4: "video", mov: "video", webm: "video",
    png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image",
  };

  function detectType(r) {
    if (r.type && TYPES[r.type]) return r.type;
    const url = String(r.url || "");
    if (/youtube\.com|youtu\.be|vimeo\.com|stream\.microsoft/i.test(url)) return "video";
    const ext = url.split(/[?#]/)[0].split(".").pop().toLowerCase();
    if (EXT_TYPES[ext]) return EXT_TYPES[ext];
    if (/^https?:\/\//i.test(url)) return "website";
    return "other";
  }

  const isExternal = (url) => /^https?:\/\//i.test(url);
  const isDownload = (type) => ["word", "excel", "macro", "powerpoint"].includes(type);

  // ---------------------------------------------------------------------------
  // Data prep
  // ---------------------------------------------------------------------------
  const categories = content.categories || [];
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const resources = (content.resources || []).map((r, i) => {
    const type = detectType(r);
    return {
      ...r,
      _id: r.id || slug(r.title) + "-" + i,
      _type: type,
      _search: [r.title, r.description, (r.tags || []).join(" "), r.owner, TYPES[type].label,
        (catById[r.category] || {}).name, (r.roles || []).join(" "), (r.departments || []).join(" ")].join(" ").toLowerCase(),
    };
  });

  // ---------------------------------------------------------------------------
  // Per-browser state (favourites, checklist, role)
  // ---------------------------------------------------------------------------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("ntic:" + key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("ntic:" + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
  };

  const state = {
    query: "",
    type: "",
    // Default the filters to the signed-in person's own role and department
    role: store.get("role", me && me.role ? me.role : ""),
    dept: store.get("dept", me && me.department ? me.department : ""),
    serverHits: new Map(), // resource id -> snippet, from searching inside documents
    favs: new Set(store.get("favs", [])),
    done: new Set(store.get("done", [])),
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function slug(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const $ = (sel) => document.querySelector(sel);

  // "Relevant to me": matches the chosen role AND department (untagged = everyone).
  function matchesRole(r) {
    const roleOk = !state.role || !r.roles || r.roles.length === 0 || r.roles.includes(state.role);
    const deptOk = !state.dept || !r.departments || r.departments.length === 0 || r.departments.includes(state.dept);
    return roleOk && deptOk;
  }
  function matches(r) {
    if (!matchesRole(r)) return false;
    if (state.type && r._type !== state.type) return false;
    if (state.query) {
      return state.query.split(/\s+/).every((w) => r._search.includes(w)) || state.serverHits.has(r._id);
    }
    return true;
  }

  // Links go through /go/:id so the site can count which resources get used.
  function linkAttrs(r) {
    const href = r.id ? "/go/" + encodeURIComponent(r.id) : r.url;
    const external = isExternal(r.url) || !isDownload(r._type);
    return `href="${esc(href)}"` + (external ? ' target="_blank" rel="noopener"' : " download");
  }

  // ----- Required reading ("I've read this") -----
  function ackState(r) {
    if (!r.requiresAck || !me) return null;
    const a = me.acks && me.acks[r._id];
    if (a && a.rev === (r.rev || 1)) return { read: true, at: a.at };
    return { read: false, changed: Boolean(a) };
  }
  function ackHtml(r) {
    const st = ackState(r);
    if (!st) return r.requiresAck ? '<p class="ack-note">📌 Required reading</p>' : "";
    if (st.read) return `<p class="ack-note done">✅ You confirmed you read this on ${formatDate(st.at.slice(0, 10))}</p>`;
    return `<button type="button" class="btn btn-small ack-btn" data-ack="${esc(r._id)}">
      ${st.changed ? "Updated — confirm you've read the new version" : "✔ I've read this"}</button>`;
  }

  function formatDate(d) {
    if (!d) return "";
    const date = new Date(d + "T00:00:00");
    if (isNaN(date)) return esc(d);
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function card(r) {
    const t = TYPES[r._type];
    const fav = state.favs.has(r._id);
    const meta = [
      r.owner ? `<span title="Owner">👤 ${esc(r.owner)}</span>` : "",
      r.updated ? `<span title="Last reviewed">🗓️ ${formatDate(r.updated)}</span>` : "",
    ].join("");
    const tagsList = [...(r.departments || []).map((x) => "🏢 " + x), ...(r.roles || [])];
    const roles = tagsList.length
      ? `<div class="roles">${tagsList.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : "";
    const hint = r._type === "macro"
      ? `<p class="hint">⚠️ Download, open in Excel and click <em>Enable Content</em>.</p>` : "";

    return `
      <article class="card type-${r._type}">
        <div class="card-top">
          <span class="badge badge-${r._type}">${t.icon} ${t.label}</span>
          <button type="button" class="fav ${fav ? "on" : ""}" data-fav="${esc(r._id)}"
            aria-pressed="${fav}" title="${fav ? "Remove from" : "Add to"} favourites">${fav ? "♥" : "♡"}</button>
        </div>
        <h3><a ${linkAttrs(r)}>${esc(r.title)}</a></h3>
        ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ""}
        ${state.query && state.serverHits.has(r._id) ? `<p class="snippet">🔎 ${esc(state.serverHits.get(r._id))}</p>` : ""}
        ${hint}
        ${roles}
        ${meta ? `<div class="meta">${meta}</div>` : ""}
        <div class="card-actions">
          <a class="open" ${linkAttrs(r)}>${isDownload(r._type) && !isExternal(r.url) ? "Download ↓" : "Open ↗"}</a>
          ${ackHtml(r)}
        </div>
      </article>`;
  }

  function renderSections() {
    const filtered = resources.filter(matches);
    const filtering = state.query || state.type;

    $("#results-summary").innerHTML = filtering
      ? `Showing <strong>${filtered.length}</strong> of ${resources.length} resources` +
        (filtered.length ? "" : ` — nothing matched. <button type="button" class="linkish" id="clear">Clear filters</button>`)
      : "";

    let html = "";
    const known = new Set();
    categories.forEach((c) => {
      known.add(c.id);
      const items = filtered.filter((r) => r.category === c.id);
      if (!items.length && filtering) return;
      html += `
        <section class="category" id="cat-${esc(c.id)}">
          <header>
            <h2>${esc(c.icon || "")} ${esc(c.name)} <span class="count">${items.length}</span></h2>
            ${c.description ? `<p class="muted">${esc(c.description)}</p>` : ""}
          </header>
          ${items.length ? `<div class="card-grid">${items.map(card).join("")}</div>`
                         : `<p class="empty">Nothing here yet.</p>`}
        </section>`;
    });
    const orphans = filtered.filter((r) => !known.has(r.category));
    if (orphans.length) {
      html += `<section class="category" id="cat-other"><header><h2>📁 Other</h2></header>
        <div class="card-grid">${orphans.map(card).join("")}</div></section>`;
    }
    $("#sections").innerHTML = html;

    // Sidebar counts
    $("#category-nav").innerHTML = categories.map((c) => {
      const n = filtered.filter((r) => r.category === c.id).length;
      return `<li><a href="#cat-${esc(c.id)}" class="${n ? "" : "dim"}">
        <span>${esc(c.icon || "")} ${esc(c.name)}</span><span class="count">${n}</span></a></li>`;
    }).join("") +
      ($("#contacts").hidden ? "" : `<li class="nav-sep"><a href="#contacts"><span>📞 Who to Ask</span></a></li>`) +
      ($("#org").hidden ? "" : `<li><a href="#org"><span>🏢 Org Chart</span></a></li>`);

    // Hide the "home" panels while searching so results are front and centre
    ["#starter", "#quick", "#favourites", "#contacts", "#org"].forEach((s) =>
      $(s).classList.toggle("collapsed", Boolean(filtering)));
    if (!filtering && window.fitOrgChart) window.fitOrgChart($("#org-chart"));
  }

  function renderReading() {
    const items = me ? resources.filter((r) => {
      const st = ackState(r);
      return st && !st.read && (!r.roles || !r.roles.length || r.roles.includes(me.role)) &&
        (!r.departments || !r.departments.length || r.departments.includes(me.department));
    }) : [];
    $("#reading").hidden = !items.length;
    $("#reading-list").innerHTML = items.map((r) => `<li>
      <span aria-hidden="true">${TYPES[r._type].icon}</span>
      <a ${linkAttrs(r)}>${esc(r.title)}</a>
      <button type="button" class="btn btn-small ack-btn" data-ack="${esc(r._id)}">✔ I've read this</button>
    </li>`).join("");
  }

  function renderAnnouncements() {
    let dismissed = store.get("dismissed", []);
    const list = (content.announcements || []).filter((a) => !dismissed.includes(a.id + a.text.length));
    $("#announcements").innerHTML = list.map((a) => `
      <div class="announcement ${esc(a.level)}" role="status">
        <span aria-hidden="true">${a.level === "warning" ? "⚠️" : a.level === "success" ? "✅" : "📣"}</span>
        <p>${esc(a.text)}</p>
        <button type="button" class="dismiss" data-dismiss="${esc(a.id + a.text.length)}" aria-label="Dismiss">✕</button>
      </div>`).join("");
  }

  function renderUserMenu() {
    const box = $("#user-menu");
    if (!me) {
      box.innerHTML = `<a class="btn btn-ghost" href="/login">Sign in</a>`;
      return;
    }
    box.innerHTML = `
      <a class="btn btn-ghost user-btn" href="/account" title="My account">👤 ${esc(me.name.split(" ")[0])}</a>
      ${me.isAdmin ? '<a class="btn btn-ghost" href="/admin">Admin</a>' : ""}
      <form method="post" action="/logout"><button class="btn btn-ghost" type="submit">Sign out</button></form>`;
  }

  function renderStarter() {
    const items = resources.filter((r) => r.newStarter && matchesRole(r));
    $("#starter").hidden = !items.length;
    if (!items.length) return;
    const done = items.filter((r) => state.done.has(r._id)).length;
    $("#starter-count").textContent = `${done} / ${items.length} done`;
    $("#starter-bar").style.width = (100 * done / items.length) + "%";
    $("#starter-list").innerHTML = items.map((r) => {
      const checked = state.done.has(r._id);
      const t = TYPES[r._type];
      return `<li class="${checked ? "done" : ""}">
        <label><input type="checkbox" data-done="${esc(r._id)}" ${checked ? "checked" : ""} />
          <span class="sr-only">Mark as done</span></label>
        <span class="check-icon" aria-hidden="true">${t.icon}</span>
        <a ${linkAttrs(r)}>${esc(r.title)}</a>
        ${r.description ? `<span class="muted small">${esc(r.description)}</span>` : ""}
      </li>`;
    }).join("");
  }

  function renderQuick() {
    const items = resources.filter((r) => r.pinned && matchesRole(r));
    $("#quick").hidden = !items.length;
    $("#quick-list").innerHTML = items.map((r) =>
      `<a class="quick" ${linkAttrs(r)}><span>${TYPES[r._type].icon}</span>${esc(r.title)}</a>`).join("");
  }

  function renderFavs() {
    const items = resources.filter((r) => state.favs.has(r._id));
    $("#favourites").hidden = !items.length;
    $("#fav-list").innerHTML = items.map(card).join("");
  }

  function inMyDept(p) {
    return !state.dept || !p.department || p.department === state.dept;
  }

  function renderContacts() {
    const list = (content.people || []).filter((p) => p.showInContacts && inMyDept(p));
    $("#contacts").hidden = !list.length;
    $("#contact-list").innerHTML = list.map((c) => `
      <div class="contact">
        ${c.photo ? `<img class="contact-photo" src="/files/${encodeURIComponent(c.photo)}" alt="" loading="lazy" />` : ""}
        <strong>${esc(c.name || c.jobTitle)}</strong>
        ${c.name && c.jobTitle ? `<span class="job">${esc(c.jobTitle)}${c.department ? " · " + esc(c.department) : ""}</span>` : ""}
        ${c.responsibilities ? `<span class="muted small">${esc(c.responsibilities)}</span>` : ""}
        ${c.phone ? `<span>☎️ ${esc(c.phone)}</span>` : ""}
        ${c.email ? `<a href="mailto:${esc(c.email)}">✉️ ${esc(c.email)}</a>` : ""}
      </div>`).join("");
  }

  function renderOrg() {
    const html = window.renderOrgChart ? window.renderOrgChart(content.people, { department: state.dept }) : "";
    $("#org").hidden = !html;
    $("#org-chart").innerHTML = html;
    if (window.fitOrgChart) window.fitOrgChart($("#org-chart"));
    $("#org-note").textContent = state.dept
      ? `People in ${state.dept} are highlighted. Hover or tap a person for contact details.`
      : "Hover or tap a person for contact details.";
  }

  function renderTypeFilters() {
    const used = new Set(resources.map((r) => r._type));
    const chips = [["", "All"]].concat(
      Object.keys(TYPES).filter((k) => used.has(k)).map((k) => [k, TYPES[k].icon + " " + TYPES[k].label]));
    $("#type-filters").innerHTML = chips.map(([k, label]) =>
      `<button type="button" class="chip ${state.type === k ? "active" : ""}" data-type="${k}"
        aria-pressed="${state.type === k}">${label}</button>`).join("");
  }

  function renderAll() {
    renderReading();
    renderTypeFilters();
    renderStarter();
    renderQuick();
    renderFavs();
    renderContacts();
    renderOrg();
    renderSections();
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  document.title = content.siteName || document.title;
  $("#site-name").textContent = content.siteName || "Information Center";
  $("#site-tagline").textContent = content.tagline || "";
  if (content.logo) {
    const src = "/files/" + encodeURIComponent(content.logo);
    $("#brand-mark").innerHTML = `<img class="brand-logo" src="${src}" alt="" />`;
    document.querySelector('link[rel="icon"]').href = src;
  }

  const roleSel = $("#role");
  (content.roles || []).forEach((r) => roleSel.add(new Option(r, r)));
  if (state.role && !(content.roles || []).includes(state.role)) state.role = "";
  roleSel.value = state.role;
  roleSel.addEventListener("change", () => {
    state.role = roleSel.value;
    store.set("role", state.role);
    renderAll();
  });

  const deptSel = $("#dept");
  const departments = content.departments || [];
  departments.forEach((d) => deptSel.add(new Option(d, d)));
  if (state.dept && !departments.includes(state.dept)) state.dept = "";
  deptSel.value = state.dept;
  deptSel.closest("label").hidden = !departments.length;
  deptSel.addEventListener("change", () => {
    state.dept = deptSel.value;
    store.set("dept", state.dept);
    renderAll();
  });

  let searchTimer;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      state.query = e.target.value.trim().toLowerCase();
      renderSections();
      if (state.query.length < 3) { state.serverHits = new Map(); return; }
      const q = state.query;
      try {
        const hits = await (await fetch("/api/search?q=" + encodeURIComponent(q))).json();
        if (q !== state.query) return; // a newer search has started
        state.serverHits = new Map(hits.map((h) => [h.id, h.snippet]));
        renderSections();
      } catch (err) { /* title search still works */ }
    }, 200);
  });

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (e.key === "/" && !["input", "textarea", "select"].includes(tag)) {
      e.preventDefault();
      $("#search").focus();
    }
  });

  document.addEventListener("click", async (e) => {
    const ackBtn = e.target.closest("[data-ack]");
    if (ackBtn) {
      ackBtn.disabled = true;
      try {
        const res = await fetch("/api/me/ack/" + encodeURIComponent(ackBtn.dataset.ack), {
          method: "POST", headers: { "X-Requested-With": "ntic" },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        me.acks = me.acks || {};
        me.acks[ackBtn.dataset.ack] = { at: new Date().toISOString(), rev: data.rev };
        renderReading();
        renderSections();
        renderFavs();
      } catch (err) {
        ackBtn.disabled = false;
        alert(err.message || "Couldn't save — please try again.");
      }
      return;
    }
    const dismiss = e.target.closest("[data-dismiss]");
    if (dismiss) {
      store.set("dismissed", [...store.get("dismissed", []), dismiss.dataset.dismiss].slice(-50));
      renderAnnouncements();
      return;
    }
    const typeBtn = e.target.closest("[data-type]");
    if (typeBtn) {
      state.type = typeBtn.dataset.type;
      renderTypeFilters();
      renderSections();
      return;
    }
    const favBtn = e.target.closest("[data-fav]");
    if (favBtn) {
      const id = favBtn.dataset.fav;
      state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
      store.set("favs", [...state.favs]);
      renderFavs();
      renderSections();
      return;
    }
    if (e.target.id === "clear") {
      state.query = ""; state.type = "";
      $("#search").value = "";
      renderTypeFilters();
      renderSections();
    }
  });

  document.addEventListener("change", (e) => {
    const box = e.target.closest("[data-done]");
    if (!box) return;
    box.checked ? state.done.add(box.dataset.done) : state.done.delete(box.dataset.done);
    store.set("done", [...state.done]);
    renderStarter();
  });

  renderUserMenu();
  renderAnnouncements();
  renderAll();
})();
