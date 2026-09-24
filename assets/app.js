(function () {
  "use strict";

  const content = window.NT_CONTENT;
  if (!content) {
    document.getElementById("sections").innerHTML =
      '<div class="panel error"><h2>Couldn\'t load content</h2><p>There is probably a typo in <code>data/resources.js</code> (often a missing comma or bracket). Open the browser console (F12) to see the line number.</p></div>';
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
        (catById[r.category] || {}).name, (r.roles || []).join(" ")].join(" ").toLowerCase(),
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
    role: store.get("role", ""),
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

  function matchesRole(r) {
    return !state.role || !r.roles || r.roles.length === 0 || r.roles.includes(state.role);
  }
  function matches(r) {
    if (!matchesRole(r)) return false;
    if (state.type && r._type !== state.type) return false;
    if (state.query) {
      return state.query.split(/\s+/).every((w) => r._search.includes(w));
    }
    return true;
  }

  function linkAttrs(r) {
    const external = isExternal(r.url) || !isDownload(r._type);
    return `href="${esc(r.url)}"` + (external ? ' target="_blank" rel="noopener"' : " download");
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
    const roles = r.roles && r.roles.length
      ? `<div class="roles">${r.roles.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : "";
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
        ${hint}
        ${roles}
        ${meta ? `<div class="meta">${meta}</div>` : ""}
        <a class="open" ${linkAttrs(r)}>${isDownload(r._type) && !isExternal(r.url) ? "Download ↓" : "Open ↗"}</a>
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
    }).join("");

    // Hide the "home" panels while searching so results are front and centre
    ["#starter", "#quick", "#favourites", "#contacts"].forEach((s) =>
      $(s).classList.toggle("collapsed", Boolean(filtering)));
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

  function renderContacts() {
    const list = content.contacts || [];
    $("#contacts").hidden = !list.length;
    $("#contact-list").innerHTML = list.map((c) => `
      <div class="contact">
        <strong>${esc(c.name)}</strong>
        ${c.role ? `<span class="muted small">${esc(c.role)}</span>` : ""}
        ${c.phone ? `<span>☎️ ${esc(c.phone)}</span>` : ""}
        ${c.email ? `<a href="mailto:${esc(c.email)}">✉️ ${esc(c.email)}</a>` : ""}
      </div>`).join("");
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
    renderTypeFilters();
    renderStarter();
    renderQuick();
    renderFavs();
    renderSections();
    renderContacts();
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  document.title = content.siteName || document.title;
  $("#site-name").textContent = content.siteName || "Information Center";
  $("#site-tagline").textContent = content.tagline || "";

  const roleSel = $("#role");
  (content.roles || []).forEach((r) => roleSel.add(new Option(r, r)));
  if (state.role && !(content.roles || []).includes(state.role)) state.role = "";
  roleSel.value = state.role;
  roleSel.addEventListener("change", () => {
    state.role = roleSel.value;
    store.set("role", state.role);
    renderAll();
  });

  let searchTimer;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = e.target.value.trim().toLowerCase();
      renderSections();
    }, 120);
  });

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (e.key === "/" && !["input", "textarea", "select"].includes(tag)) {
      e.preventDefault();
      $("#search").focus();
    }
  });

  document.addEventListener("click", (e) => {
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

  // ---------------------------------------------------------------------------
  // "Add resource" helper — builds an entry to paste into data/resources.js
  // ---------------------------------------------------------------------------
  const dialog = $("#add-dialog");
  const form = $("#add-form");
  Object.entries(TYPES).forEach(([k, t]) => form.type.add(new Option(t.icon + " " + t.label, k)));
  categories.forEach((c) => form.category.add(new Option(c.name, c.id)));
  (content.roles || []).forEach((r) => form.roles.add(new Option(r, r)));

  function buildSnippet() {
    const f = form;
    const q = (s) => JSON.stringify(s);
    const lines = [`  title: ${q(f.title.value.trim())},`];
    if (f.description.value.trim()) lines.push(`  description: ${q(f.description.value.trim())},`);
    lines.push(`  url: ${q(f.url.value.trim())},`);
    if (f.type.value) lines.push(`  type: ${q(f.type.value)},`);
    lines.push(`  category: ${q(f.category.value)},`);
    const roles = [...f.roles.selectedOptions].map((o) => o.value);
    if (roles.length) lines.push(`  roles: ${JSON.stringify(roles)},`);
    const tags = f.tags.value.split(",").map((s) => s.trim()).filter(Boolean);
    if (tags.length) lines.push(`  tags: ${JSON.stringify(tags)},`);
    if (f.owner.value.trim()) lines.push(`  owner: ${q(f.owner.value.trim())},`);
    lines.push(`  updated: ${q(new Date().toISOString().slice(0, 10))},`);
    if (f.newStarter.checked) lines.push(`  newStarter: true,`);
    if (f.pinned.checked) lines.push(`  pinned: true,`);
    $("#snippet").value = "{\n" + lines.join("\n") + "\n},";
  }

  form.addEventListener("input", buildSnippet);
  form.addEventListener("change", buildSnippet);
  $("#add-btn").addEventListener("click", () => { buildSnippet(); dialog.showModal(); });
  $("#copy-btn").addEventListener("click", async () => {
    if (!form.reportValidity()) return;
    buildSnippet();
    const btn = $("#copy-btn");
    try {
      await navigator.clipboard.writeText($("#snippet").value);
    } catch (e) {
      $("#snippet").select();
      document.execCommand("copy");
    }
    btn.textContent = "Copied ✓";
    setTimeout(() => (btn.textContent = "Copy entry"), 1500);
  });

  renderAll();
})();
