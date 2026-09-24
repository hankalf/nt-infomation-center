(function () {
  "use strict";

  const TYPES = {
    sop: "📋 SOP", pdf: "📕 PDF", word: "📘 Word", excel: "📗 Excel", macro: "⚙️ Macro",
    powerpoint: "📙 PowerPoint", website: "🌐 Website", video: "🎬 Video", form: "📝 Form",
    image: "🖼️ Image", other: "📄 Other",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let content = null;
  let editingId = null;

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  async function api(method, url, body) {
    const opts = { method, headers: { "X-Requested-With": "ntic-admin" } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
      location.href = "/admin";
      throw new Error("Signed out");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }

  async function reload() {
    const res = await fetch("/api/content", { cache: "no-cache" });
    content = await res.json();
    $("#site-name").textContent = content.siteName || "Information Center";
    renderResources();
  }

  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "show" + (isError ? " error" : "");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.className = ""), isError ? 6000 : 2500);
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", b === btn);
    });
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.id !== "tab-" + btn.dataset.tab));
    if (btn.dataset.tab !== "resources") renderSettings();
  }));

  // ---------------------------------------------------------------------------
  // Resources list
  // ---------------------------------------------------------------------------
  function typeOf(r) {
    if (r.type) return r.type;
    const ext = String(r.url || "").split(/[?#]/)[0].split(".").pop().toLowerCase();
    const map = { pdf: "pdf", doc: "word", docx: "word", xls: "excel", xlsx: "excel", csv: "excel",
      xlsm: "macro", xlsb: "macro", ppt: "powerpoint", pptx: "powerpoint", mp4: "video" };
    if (map[ext]) return map[ext];
    return /^https?:/i.test(r.url || "") ? "website" : "other";
  }

  function renderResources() {
    const sectionSel = $("#admin-section");
    const current = sectionSel.value;
    sectionSel.innerHTML = '<option value="">All sections</option>' +
      content.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</option>`).join("");
    sectionSel.value = content.categories.some((c) => c.id === current) ? current : "";

    const q = $("#admin-search").value.trim().toLowerCase();
    const filterCat = sectionSel.value;

    let html = "";
    content.categories.forEach((cat) => {
      if (filterCat && cat.id !== filterCat) return;
      const all = content.resources.filter((r) => r.category === cat.id);
      const items = all.filter((r) => !q ||
        [r.title, r.description, (r.tags || []).join(" "), r.owner, r.file].join(" ").toLowerCase().includes(q));
      if (q && !items.length) return;
      html += `<div class="panel group">
        <h2>${esc(cat.icon)} ${esc(cat.name)} <span class="count">${all.length}</span></h2>
        ${items.length ? `<ul class="res-list">${items.map((r) => {
          const idx = all.indexOf(r);
          return `<li>
            <div class="order">
              <button type="button" class="icon-btn" data-move="-1" data-id="${esc(r.id)}" ${idx === 0 ? "disabled" : ""} title="Move up" aria-label="Move up">▲</button>
              <button type="button" class="icon-btn" data-move="1" data-id="${esc(r.id)}" ${idx === all.length - 1 ? "disabled" : ""} title="Move down" aria-label="Move down">▼</button>
            </div>
            <div class="res-main">
              <div class="res-title">
                <span class="type">${esc(TYPES[typeOf(r)] || "")}</span>
                <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
                ${r.pinned ? '<span class="flag" title="In Quick Links">⭐</span>' : ""}
                ${r.newStarter ? '<span class="flag" title="On New Starter checklist">🚀</span>' : ""}
              </div>
              <div class="res-meta muted small">
                ${r.file ? `📎 ${esc(r.file)}` : `🔗 ${esc(r.url)}`}
                ${r.roles && r.roles.length ? ` · 👥 ${esc(r.roles.join(", "))}` : ""}
                ${r.updated ? ` · 🗓️ ${esc(r.updated)}` : ""}
              </div>
            </div>
            <div class="res-actions">
              <button type="button" class="btn btn-small" data-edit="${esc(r.id)}">Edit</button>
              <button type="button" class="btn btn-small btn-danger" data-delete="${esc(r.id)}">Delete</button>
            </div>
          </li>`;
        }).join("")}</ul>` : '<p class="empty">No resources in this section yet.</p>'}
      </div>`;
    });

    const orphans = content.resources.filter((r) => !content.categories.some((c) => c.id === r.category));
    if (orphans.length && !filterCat) {
      html += `<div class="panel group"><h2>⚠️ No section</h2><ul class="res-list">${orphans.map((r) => `
        <li><div class="res-main"><div class="res-title">${esc(r.title)}</div></div>
        <div class="res-actions"><button type="button" class="btn btn-small" data-edit="${esc(r.id)}">Edit</button></div></li>`).join("")}</ul></div>`;
    }
    $("#resource-list").innerHTML = html || '<p class="empty">Nothing matches.</p>';
  }

  $("#admin-search").addEventListener("input", renderResources);
  $("#admin-section").addEventListener("change", renderResources);

  $("#resource-list").addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) return openDialog(content.resources.find((r) => r.id === edit.dataset.edit));

    const del = e.target.closest("[data-delete]");
    if (del) {
      const r = content.resources.find((x) => x.id === del.dataset.delete);
      if (!r || !confirm(`Delete "${r.title}"?` + (r.file ? "\n\nThe uploaded file will be deleted too." : ""))) return;
      try {
        await api("DELETE", "/api/admin/resources/" + encodeURIComponent(r.id));
        toast("Deleted");
        await reload();
      } catch (err) { toast(err.message, true); }
      return;
    }

    const move = e.target.closest("[data-move]");
    if (move) {
      const r = content.resources.find((x) => x.id === move.dataset.id);
      const siblings = content.resources.filter((x) => x.category === r.category);
      const i = siblings.indexOf(r);
      const j = i + Number(move.dataset.move);
      if (j < 0 || j >= siblings.length) return;
      // Swap the two resources' positions in the full list
      const list = content.resources.slice();
      const a = list.indexOf(r), b = list.indexOf(siblings[j]);
      [list[a], list[b]] = [list[b], list[a]];
      content.resources = list;
      renderResources();
      try {
        await api("POST", "/api/admin/resources/order", { ids: list.map((x) => x.id) });
      } catch (err) { toast(err.message, true); await reload(); }
    }
  });

  // ---------------------------------------------------------------------------
  // Add / edit dialog
  // ---------------------------------------------------------------------------
  const dialog = $("#resource-dialog");
  const form = $("#resource-form");
  Object.entries(TYPES).forEach(([k, label]) => form.type.add(new Option(label, k)));

  function setSource(source) {
    form.source.value = source;
    $("#file-field").hidden = source !== "file";
    $("#url-field").hidden = source !== "link";
  }
  form.querySelectorAll('[name="source"]').forEach((el) => el.addEventListener("change", () => setSource(form.source.value)));

  function openDialog(r) {
    editingId = r ? r.id : null;
    form.reset();
    $("#form-error").hidden = true;
    $("#dialog-title").textContent = r ? "Edit resource" : "Add resource";

    form.category.innerHTML = content.categories.map((c) =>
      `<option value="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</option>`).join("");
    $("#role-checks").innerHTML = content.roles.map((role) =>
      `<label class="inline"><input type="checkbox" name="roles" value="${esc(role)}" /> ${esc(role)}</label>`).join("")
      || '<span class="muted small">No roles set up yet (see Sections &amp; Roles).</span>';

    const filterCat = $("#admin-section").value;
    form.title.value = r ? r.title : "";
    form.description.value = (r && r.description) || "";
    form.category.value = r ? r.category : (filterCat || (content.categories[0] || {}).id || "");
    form.type.value = (r && r.type) || "";
    form.tags.value = ((r && r.tags) || []).join(", ");
    form.owner.value = (r && r.owner) || "";
    form.updated.value = (r && r.updated) || new Date().toISOString().slice(0, 10);
    form.newStarter.checked = Boolean(r && r.newStarter);
    form.pinned.checked = Boolean(r && r.pinned);
    ((r && r.roles) || []).forEach((role) => {
      const box = [...form.querySelectorAll('[name="roles"]')].find((b) => b.value === role);
      if (box) box.checked = true;
    });

    const hasFile = Boolean(r && r.file);
    $("#current-file").hidden = !hasFile;
    $("#current-file").innerHTML = hasFile
      ? `Current file: <a href="${esc(r.url)}" target="_blank" rel="noopener">📎 ${esc(r.file)}</a> — choose a new file below only if you want to replace it.`
      : "";
    $("#file-label").textContent = hasFile ? "Replace file (optional)" : "File *";
    form.url.value = r && !r.file ? r.url : "";
    setSource(r && !r.file ? "link" : "file");

    dialog.showModal();
    form.title.focus();
  }

  $("#new-resource").addEventListener("click", () => openDialog(null));
  $("#cancel-resource").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const existing = editingId && content.resources.find((r) => r.id === editingId);
    const source = form.source.value;
    const file = form.file.files[0];
    const err = $("#form-error");

    if (source === "file" && !file && !(existing && existing.file)) {
      err.textContent = "Please choose a file to upload.";
      err.hidden = false;
      return;
    }
    if (source === "link" && !form.url.value.trim()) {
      err.textContent = "Please enter the web address.";
      err.hidden = false;
      return;
    }

    const fd = new FormData();
    ["title", "description", "category", "type", "tags", "owner", "updated"].forEach((k) => fd.append(k, form[k].value));
    fd.append("roles", [...form.querySelectorAll('[name="roles"]:checked')].map((b) => b.value).join(","));
    fd.append("newStarter", form.newStarter.checked);
    fd.append("pinned", form.pinned.checked);
    if (source === "link") fd.append("url", form.url.value.trim());
    if (source === "file") {
      fd.append("keepFile", String(!file));
      if (file) fd.append("file", file);
    }

    const btn = $("#save-resource");
    btn.disabled = true;
    btn.textContent = file ? "Uploading…" : "Saving…";
    try {
      if (editingId) await api("PUT", "/api/admin/resources/" + encodeURIComponent(editingId), fd);
      else await api("POST", "/api/admin/resources", fd);
      dialog.close();
      toast(editingId ? "Saved" : "Added — it's live on the site now");
      await reload();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Save";
    }
  });

  // ---------------------------------------------------------------------------
  // Settings: sections, roles, contacts, site details
  // ---------------------------------------------------------------------------
  let draft = null;

  function renderSettings() {
    if (!draft) {
      draft = {
        categories: content.categories.map((c) => ({ ...c })),
        contacts: content.contacts.map((c) => ({ ...c })),
      };
      $("#roles").value = content.roles.join("\n");
      $("#siteName").value = content.siteName || "";
      $("#tagline").value = content.tagline || "";
    }
    $("#section-rows").innerHTML = draft.categories.map((c, i) => {
      const used = content.resources.filter((r) => r.category === c.id).length;
      return `<div class="edit-row section-row" data-i="${i}">
        <div class="order">
          <button type="button" class="icon-btn" data-sec-move="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">▲</button>
          <button type="button" class="icon-btn" data-sec-move="1" ${i === draft.categories.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button>
        </div>
        <label class="narrow">Icon<input data-k="icon" value="${esc(c.icon)}" maxlength="16" /></label>
        <label>Name<input data-k="name" value="${esc(c.name)}" maxlength="80" /></label>
        <label class="grow">Description<input data-k="description" value="${esc(c.description)}" maxlength="300" /></label>
        <button type="button" class="btn btn-small btn-danger" data-sec-remove ${used ? `disabled title="Has ${used} resource(s) — move or delete them first"` : ""}>Remove</button>
      </div>`;
    }).join("");

    $("#contact-rows").innerHTML = draft.contacts.map((c, i) => `
      <div class="edit-row contact-row" data-i="${i}">
        <label>Name<input data-k="name" value="${esc(c.name)}" /></label>
        <label>What to ask them about<input data-k="role" value="${esc(c.role)}" /></label>
        <label>Phone<input data-k="phone" value="${esc(c.phone)}" /></label>
        <label>Email<input data-k="email" type="email" value="${esc(c.email)}" /></label>
        <button type="button" class="btn btn-small btn-danger" data-contact-remove>Remove</button>
      </div>`).join("") || '<p class="empty">No contacts yet.</p>';
  }

  $("#section-rows").addEventListener("input", (e) => {
    const row = e.target.closest("[data-i]");
    if (row && e.target.dataset.k) draft.categories[row.dataset.i][e.target.dataset.k] = e.target.value;
  });
  $("#contact-rows").addEventListener("input", (e) => {
    const row = e.target.closest("[data-i]");
    if (row && e.target.dataset.k) draft.contacts[row.dataset.i][e.target.dataset.k] = e.target.value;
  });
  $("#section-rows").addEventListener("click", (e) => {
    const row = e.target.closest("[data-i]");
    if (!row) return;
    const i = Number(row.dataset.i);
    if (e.target.closest("[data-sec-remove]")) draft.categories.splice(i, 1);
    const mv = e.target.closest("[data-sec-move]");
    if (mv) {
      const j = i + Number(mv.dataset.secMove);
      [draft.categories[i], draft.categories[j]] = [draft.categories[j], draft.categories[i]];
    }
    renderSettings();
  });
  $("#contact-rows").addEventListener("click", (e) => {
    const row = e.target.closest("[data-i]");
    if (row && e.target.closest("[data-contact-remove]")) {
      draft.contacts.splice(Number(row.dataset.i), 1);
      renderSettings();
    }
  });
  $("#add-section").addEventListener("click", () => {
    draft.categories.push({ id: "", name: "", icon: "📁", description: "" });
    renderSettings();
    const inputs = document.querySelectorAll('#section-rows [data-k="name"]');
    inputs[inputs.length - 1].focus();
  });
  $("#add-contact").addEventListener("click", () => {
    draft.contacts.push({ name: "", role: "", phone: "", email: "" });
    renderSettings();
    const inputs = document.querySelectorAll('#contact-rows [data-k="name"]');
    inputs[inputs.length - 1].focus();
  });

  document.querySelectorAll("[data-save-settings]").forEach((btn) => btn.addEventListener("click", async () => {
    const body = {
      siteName: $("#siteName").value,
      tagline: $("#tagline").value,
      roles: $("#roles").value.split("\n").map((s) => s.trim()).filter(Boolean),
      categories: draft.categories,
      contacts: draft.contacts,
    };
    btn.disabled = true;
    try {
      await api("PUT", "/api/admin/settings", body);
      draft = null;
      await reload();
      renderSettings();
      toast("Saved — the public site is updated");
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  }));

  reload().catch((err) => toast("Couldn't load content: " + err.message, true));
})();
