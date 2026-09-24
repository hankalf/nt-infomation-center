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
    const opts = { method, headers: { "X-Requested-With": "ntic" } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
      location.href = "/login?next=/admin";
      throw new Error("Signed out");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }

  async function reload() {
    content = await api("GET", "/api/admin/content");
    content.departments = content.departments || [];
    content.people = content.people || [];
    content.access = content.access || [];
    $("#site-name").textContent = content.siteName || "Information Center";
    renderResources();
    renderAccess();
    NTA.onReload.forEach((fn) => fn(content));
  }

  /** A grid of checkboxes, e.g. for roles or departments. */
  function checkboxes(container, name, values, selected, emptyMsg) {
    const sel = new Set(selected || []);
    container.innerHTML = values.map((v) =>
      `<label class="inline"><input type="checkbox" name="${name}" value="${esc(v)}" ${sel.has(v) ? "checked" : ""} /> ${esc(v)}</label>`).join("")
      || `<span class="muted small">${emptyMsg}</span>`;
  }
  const checked = (form, name) => [...form.querySelectorAll(`[name="${name}"]:checked`)].map((b) => b.value);

  function fillSelect(sel, values, firstLabel) {
    const current = sel.value;
    sel.innerHTML = `<option value="">${esc(firstLabel)}</option>` + values.map((v) => `<option>${esc(v)}</option>`).join("");
    sel.value = values.includes(current) ? current : "";
  }

  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "show" + (isError ? " error" : "");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.className = ""), isError ? 6000 : 2500);
  }

  const fmtDate = (iso) => (iso ? new Date(iso.length === 10 ? iso + "T00:00:00" : iso)
    .toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
  const appliesTo = (item, person) =>
    (!(item.departments || []).length || item.departments.includes(person.department)) &&
    (!(item.roles || []).length || item.roles.includes(person.role));

  // Shared with admin-employees.js and admin-dashboard.js
  const NTA = window.NTA = {
    api, toast, esc, $, checkboxes, checked, fillSelect, fmtDate, appliesTo, reload,
    get content() { return content; },
    onReload: [],
    onTab: {},
    openTab(name) { const b = document.querySelector(`.tab[data-tab="${name}"]`); if (b) b.click(); },
    editResource(id) { NTA.openTab("resources"); openDialog(content.resources.find((r) => r.id === id)); },
  };

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", b === btn);
    });
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.id !== "tab-" + btn.dataset.tab));
    if (["sections", "contacts", "site"].includes(btn.dataset.tab)) renderSettings();
    if (btn.dataset.tab === "access") renderAccess();
    (NTA.onTab[btn.dataset.tab] || []).forEach((fn) => fn());
    try { sessionStorage.setItem("ntic:tab", btn.dataset.tab); } catch (e) { /* ignore */ }
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

    fillSelect($("#admin-dept"), content.departments, "All departments");
    $("#admin-dept").hidden = !content.departments.length;
    const filterDept = $("#admin-dept").value;
    const q = $("#admin-search").value.trim().toLowerCase();
    const filterCat = sectionSel.value;

    let html = "";
    content.categories.forEach((cat) => {
      if (filterCat && cat.id !== filterCat) return;
      const all = content.resources.filter((r) => r.category === cat.id);
      const items = all.filter((r) => (!q ||
        [r.title, r.description, (r.tags || []).join(" "), r.owner, r.file].join(" ").toLowerCase().includes(q)) &&
        (!filterDept || !r.departments || !r.departments.length || r.departments.includes(filterDept)));
      if ((q || filterDept) && !items.length) return;
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
                ${r.requiresAck ? '<span class="flag" title="Staff must confirm they have read it">📌</span>' : ""}
                ${r.versions && r.versions.length ? `<span class="flag muted small" title="Has previous versions">🕘 ${r.versions.length}</span>` : ""}
              </div>
              <div class="res-meta muted small">
                ${r.file ? `📎 ${esc(r.file)}` : `🔗 ${esc(r.url)}`}
                ${r.departments && r.departments.length ? ` · 🏢 ${esc(r.departments.join(", "))}` : ""}
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
  $("#admin-dept").addEventListener("change", renderResources);

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
    checkboxes($("#role-checks"), "roles", content.roles, r && r.roles,
      "No roles set up yet (see Sections, Roles &amp; Departments).");
    checkboxes($("#dept-checks"), "departments", content.departments,
      r ? r.departments : ($("#admin-dept").value ? [$("#admin-dept").value] : []),
      "No departments set up yet (see Sections, Roles &amp; Departments).");

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
    form.requiresAck.checked = Boolean(r && r.requiresAck);
    $("#bump-field").hidden = !(r && r.requiresAck);
    const hasFile = Boolean(r && r.file);
    $("#current-file").hidden = !hasFile;
    $("#current-file").innerHTML = hasFile
      ? `Current file: <a href="${esc(r.url)}" target="_blank" rel="noopener">📎 ${esc(r.originalName || r.file)}</a> — choose a new file below only if you want to replace it. The current file will be kept as a previous version.`
      : "";
    const versions = (r && r.versions) || [];
    $("#versions").hidden = !versions.length;
    $("#versions").innerHTML = versions.length ? `<h3>🕘 Previous versions</h3><ul>${versions.map((v) => `
      <li><a href="/files/${encodeURIComponent(v.file)}" target="_blank" rel="noopener">📎 ${esc(v.originalName || v.file)}</a>
        <span class="muted small">replaced ${esc(fmtDate(v.replacedAt))}${v.replacedBy ? " by " + esc(v.replacedBy) : ""}</span>
        <button type="button" class="btn btn-small btn-ghost" data-restore-version="${esc(v.file)}">Restore this version</button></li>`).join("")}</ul>` : "";
    $("#file-label").textContent = hasFile ? "Replace file (optional)" : "File *";
    form.url.value = r && !r.file ? r.url : "";
    setSource(r && !r.file ? "link" : "file");

    dialog.showModal();
    form.title.focus();
  }

  $("#new-resource").addEventListener("click", () => openDialog(null));
  form.requiresAck.addEventListener("change", () => {
    $("#bump-field").hidden = !(editingId && form.requiresAck.checked &&
      (content.resources.find((r) => r.id === editingId) || {}).requiresAck);
  });
  $("#versions").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-restore-version]");
    if (!btn || !confirm("Put this older version back? The current file will be kept as a previous version.")) return;
    try {
      const r = await api("POST", `/api/admin/resources/${encodeURIComponent(editingId)}/restore`, { file: btn.dataset.restoreVersion });
      toast("Previous version restored");
      await reload();
      openDialog(content.resources.find((x) => x.id === r.id));
    } catch (err) { toast(err.message, true); }
  });

  // ----- Bulk upload -----------------------------------------------------------
  const bulkDialog = $("#bulk-dialog");
  const bulkForm = $("#bulk-form");
  function showBulkFiles() {
    const files = [...bulkForm.files.files];
    $("#bulk-files").innerHTML = files.map((f) =>
      `<li>📎 ${esc(f.name)} <span class="muted small">${(f.size / 1048576).toFixed(1)} MB</span></li>`).join("");
    $("#save-bulk").textContent = files.length ? `Upload ${files.length} file${files.length === 1 ? "" : "s"}` : "Upload";
  }
  $("#bulk-upload").addEventListener("click", () => {
    bulkForm.reset();
    $("#bulk-error").hidden = true;
    bulkForm.category.innerHTML = content.categories.map((c) =>
      `<option value="${esc(c.id)}">${esc(c.icon)} ${esc(c.name)}</option>`).join("");
    if ($("#admin-section").value) bulkForm.category.value = $("#admin-section").value;
    checkboxes($("#bulk-dept-checks"), "departments", content.departments, [], "No departments set up yet.");
    checkboxes($("#bulk-role-checks"), "roles", content.roles, [], "No roles set up yet.");
    bulkForm.updated.value = new Date().toISOString().slice(0, 10);
    showBulkFiles();
    bulkDialog.showModal();
  });
  $("#cancel-bulk").addEventListener("click", () => bulkDialog.close());
  bulkForm.files.addEventListener("change", showBulkFiles);
  const dz = $("#dropzone");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove("over")));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    bulkForm.files.files = e.dataTransfer.files;
    showBulkFiles();
  });
  bulkForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const files = [...bulkForm.files.files];
    const err = $("#bulk-error");
    if (!files.length) { err.textContent = "Choose some files first."; err.hidden = false; return; }
    if (files.length > 30) { err.textContent = "Please upload 30 files or fewer at a time."; err.hidden = false; return; }
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("category", bulkForm.category.value);
    fd.append("departments", checked(bulkForm, "departments").join(","));
    fd.append("roles", checked(bulkForm, "roles").join(","));
    fd.append("owner", bulkForm.owner.value);
    fd.append("updated", bulkForm.updated.value);
    fd.append("requiresAck", bulkForm.requiresAck.checked);
    const btn = $("#save-bulk");
    btn.disabled = true;
    btn.textContent = "Uploading…";
    try {
      const created = await api("POST", "/api/admin/resources/bulk", fd);
      bulkDialog.close();
      toast(`Added ${created.length} resource${created.length === 1 ? "" : "s"}`);
      await reload();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      showBulkFiles();
    }
  });
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
    fd.append("roles", checked(form, "roles").join(","));
    fd.append("departments", checked(form, "departments").join(","));
    fd.append("newStarter", form.newStarter.checked);
    fd.append("pinned", form.pinned.checked);
    fd.append("requiresAck", form.requiresAck.checked);
    fd.append("bumpRev", form.bumpRev.checked);
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
  // Settings: sections, roles, departments, people, site details
  // ---------------------------------------------------------------------------
  let draft = null;
  const tempId = () => "p" + Math.random().toString(36).slice(2, 10);

  function personLabel(p) {
    return [p.name, p.jobTitle].filter(Boolean).join(" — ") || "(unnamed)";
  }

  function renderSettings() {
    if (!draft) {
      draft = {
        categories: content.categories.map((c) => ({ ...c })),
        people: content.people.map((p) => ({ ...p })),
        announcements: (content.announcements || []).map((a) => ({ ...a })),
      };
      $("#requireLogin").checked = content.settings.requireLogin !== false;
      $("#reviewMonths").value = content.settings.reviewMonths || 12;
      $("#roles").value = content.roles.join("\n");
      $("#departments").value = content.departments.join("\n");
      $("#siteName").value = content.siteName || "";
      $("#tagline").value = content.tagline || "";
    }
    renderLogo();
    renderAnnouncements();

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

    renderPeople();
  }

  function currentDepartments() {
    return $("#departments").value.split("\n").map((s) => s.trim()).filter(Boolean);
  }

  function renderPeople() {
    const depts = currentDepartments();
    $("#people-rows").innerHTML = draft.people.map((p, i) => {
      const bossOptions = draft.people.filter((o) => o.id !== p.id).map((o) =>
        `<option value="${esc(o.id)}" ${o.id === p.reportsTo ? "selected" : ""}>${esc(personLabel(o))}</option>`).join("");
      const deptOptions = depts.map((d) => `<option ${d === p.department ? "selected" : ""}>${esc(d)}</option>`).join("");
      return `<div class="edit-row person-row" data-i="${i}">
        <div class="photo-cell">
          ${p.photo ? `<img class="photo-thumb" src="/files/${encodeURIComponent(p.photo)}" alt="" />`
                    : `<span class="photo-thumb empty" aria-hidden="true">📷</span>`}
          <label class="btn btn-small btn-ghost file-btn">${p.photo ? "Change" : "Photo"}
            <input type="file" data-photo accept=".png,.jpg,.jpeg,.gif,.webp,image/*" /></label>
          ${p.photo ? '<button type="button" class="linkish small" data-photo-remove>Remove</button>' : ""}
        </div>
        <label>Name<input data-k="name" value="${esc(p.name)}" maxlength="120" placeholder="e.g. Sam Patel" /></label>
        <label>Job title / role<input data-k="jobTitle" value="${esc(p.jobTitle)}" maxlength="120" placeholder="e.g. Office Supervisor" /></label>
        <label>Department<select data-k="department"><option value="">—</option>${deptOptions}</select></label>
        <label>Reports to<select data-k="reportsTo"><option value="">— Nobody (top level)</option>${bossOptions}</select></label>
        <label class="grow">What to ask them about<input data-k="responsibilities" value="${esc(p.responsibilities)}" maxlength="300" /></label>
        <label>Phone<input data-k="phone" value="${esc(p.phone)}" maxlength="60" /></label>
        <label>Email<input data-k="email" type="email" value="${esc(p.email)}" maxlength="200" /></label>
        <label class="inline who"><input type="checkbox" data-k="showInContacts" ${p.showInContacts ? "checked" : ""} /> Who to Ask</label>
        <button type="button" class="btn btn-small btn-danger" data-person-remove>Remove</button>
      </div>`;
    }).join("") || '<p class="empty">No people yet.</p>';
    renderOrgPreview();
  }

  function renderOrgPreview() {
    $("#org-preview").innerHTML = window.renderOrgChart(draft.people) ||
      '<p class="empty">Add people above to build the chart.</p>';
  }

  $("#section-rows").addEventListener("input", (e) => {
    const row = e.target.closest("[data-i]");
    if (row && e.target.dataset.k) draft.categories[row.dataset.i][e.target.dataset.k] = e.target.value;
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
  $("#add-section").addEventListener("click", () => {
    draft.categories.push({ id: "", name: "", icon: "📁", description: "" });
    renderSettings();
    const inputs = document.querySelectorAll('#section-rows [data-k="name"]');
    inputs[inputs.length - 1].focus();
  });

  function onPersonEdit(e) {
    const row = e.target.closest("[data-i]");
    const k = e.target.dataset.k;
    if (!row || !k) return;
    const p = draft.people[row.dataset.i];
    p[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (k === "name" || k === "jobTitle") {
      // Keep the "Reports to" dropdowns in step with the new name
      document.querySelectorAll(`#people-rows option[value="${CSS.escape(p.id)}"]`).forEach((o) => (o.textContent = personLabel(p)));
    }
    renderOrgPreview();
  }
  $("#departments").addEventListener("change", () => draft && renderPeople());
  $("#people-rows").addEventListener("input", onPersonEdit);
  $("#people-rows").addEventListener("change", onPersonEdit);
  $("#people-rows").addEventListener("click", (e) => {
    const row = e.target.closest("[data-i]");
    if (!row || !e.target.closest("[data-person-remove]")) return;
    const removed = draft.people.splice(Number(row.dataset.i), 1)[0];
    // Anyone who reported to them now reports to their manager
    draft.people.forEach((p) => { if (p.reportsTo === removed.id) p.reportsTo = removed.reportsTo || ""; });
    renderPeople();
  });
  $("#add-person").addEventListener("click", () => {
    draft.people.push({ id: tempId(), name: "", jobTitle: "", department: "", responsibilities: "",
      phone: "", email: "", reportsTo: "", showInContacts: false });
    renderPeople();
    const inputs = document.querySelectorAll('#people-rows [data-k="name"]');
    inputs[inputs.length - 1].focus();
  });

  document.querySelectorAll("[data-save-settings]").forEach((btn) => btn.addEventListener("click", async () => {
    const body = {
      section: btn.dataset.saveSettings || "",
      siteName: $("#siteName").value,
      tagline: $("#tagline").value,
      roles: $("#roles").value.split("\n").map((s) => s.trim()).filter(Boolean),
      departments: currentDepartments(),
      categories: draft.categories,
      people: draft.people,
      announcements: draft.announcements,
      settings: { requireLogin: $("#requireLogin").checked, reviewMonths: $("#reviewMonths").value },
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

  // ----- Person photos ---------------------------------------------------------
  $("#people-rows").addEventListener("change", async (e) => {
    const input = e.target.closest("[data-photo]");
    if (!input || !input.files[0]) return;
    const row = input.closest("[data-i]");
    const fd = new FormData();
    fd.append("photo", input.files[0]);
    try {
      const res = await api("POST", "/api/admin/photo", fd);
      draft.people[row.dataset.i].photo = res.photo;
      renderPeople();
      toast("Photo added — remember to save");
    } catch (err) { toast(err.message, true); }
  });
  $("#people-rows").addEventListener("click", (e) => {
    if (!e.target.closest("[data-photo-remove]")) return;
    draft.people[e.target.closest("[data-i]").dataset.i].photo = "";
    renderPeople();
  });

  // ----- Announcements ---------------------------------------------------------
  function renderAnnouncements() {
    $("#announcement-rows").innerHTML = draft.announcements.map((a, i) => `
      <div class="edit-row" data-i="${i}">
        <label class="grow">Message<input data-k="text" value="${esc(a.text)}" maxlength="500" placeholder="e.g. Stock count this Friday — no putaway after 2pm" /></label>
        <label>Style<select data-k="level">
          <option value="info" ${a.level === "info" ? "selected" : ""}>📣 Info</option>
          <option value="warning" ${a.level === "warning" ? "selected" : ""}>⚠️ Warning</option>
          <option value="success" ${a.level === "success" ? "selected" : ""}>✅ Good news</option>
        </select></label>
        <label>Show until<input type="date" data-k="until" value="${esc(a.until)}" /></label>
        <button type="button" class="btn btn-small btn-danger" data-ann-remove>Remove</button>
      </div>`).join("") || '<p class="empty">No announcements.</p>';
  }
  const onAnnEdit = (e) => {
    const row = e.target.closest("[data-i]");
    if (row && e.target.dataset.k) draft.announcements[row.dataset.i][e.target.dataset.k] = e.target.value;
  };
  $("#announcement-rows").addEventListener("input", onAnnEdit);
  $("#announcement-rows").addEventListener("change", onAnnEdit);
  $("#announcement-rows").addEventListener("click", (e) => {
    if (!e.target.closest("[data-ann-remove]")) return;
    draft.announcements.splice(Number(e.target.closest("[data-i]").dataset.i), 1);
    renderAnnouncements();
  });
  $("#add-announcement").addEventListener("click", () => {
    draft.announcements.push({ id: "", text: "", level: "info", until: "" });
    renderAnnouncements();
    const inputs = document.querySelectorAll('#announcement-rows [data-k="text"]');
    inputs[inputs.length - 1].focus();
  });

  // ----- Restore from backup -----------------------------------------------------
  $("#restore-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!confirm(`Restore from "${file.name}"?\n\nThis REPLACES all current content, documents and logins with the backup.`)) return;
    const fd = new FormData();
    fd.append("backup", file);
    toast("Restoring… please wait");
    try {
      const res = await api("POST", "/api/admin/restore", fd);
      alert(`Restore complete: ${res.files} file(s)${res.users ? " and staff logins" : ""} restored.` +
        (res.users ? "\n\nLogins were restored too, so you may need to sign in again." : ""));
      location.reload();
    } catch (err) { toast(err.message, true); }
  });

  // ----- Logo ------------------------------------------------------------------
  function renderLogo() {
    const has = Boolean(content.logo);
    $("#logo-preview").innerHTML = has
      ? `<img src="/files/${encodeURIComponent(content.logo)}" alt="Current logo" />`
      : '<span class="muted small">No logo</span>';
    $("#logo-remove").hidden = !has;
    const icon = document.querySelector('link[rel="icon"]');
    if (has && icon) icon.href = "/files/" + encodeURIComponent(content.logo);
  }

  $("#logo-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("logo", file);
    try {
      const res = await api("POST", "/api/admin/logo", fd);
      content.logo = res.logo;
      renderLogo();
      toast("Logo updated");
    } catch (err) {
      toast(err.message, true);
    } finally {
      e.target.value = "";
    }
  });

  $("#logo-remove").addEventListener("click", async () => {
    if (!confirm("Remove the logo?")) return;
    try {
      await api("DELETE", "/api/admin/logo");
      delete content.logo;
      renderLogo();
      toast("Logo removed");
    } catch (err) { toast(err.message, true); }
  });

  // ---------------------------------------------------------------------------
  // Access checklist (admin only)
  // ---------------------------------------------------------------------------
  const KINDS = {
    system: "💻 System", folder: "📁 Folder", email: "✉️ Email", hardware: "🔑 Hardware",
    training: "🎓 Training", other: "📌 Other",
  };
  const accessDialog = $("#access-dialog");
  const accessForm = $("#access-form");
  let editingAccess = null;

  const needs = (a, dept, role) =>
    (!dept || !a.departments || !a.departments.length || a.departments.includes(dept)) &&
    (!role || !a.roles || !a.roles.length || a.roles.includes(role));

  function scopeText(a) {
    const d = a.departments && a.departments.length ? a.departments.join(", ") : "All departments";
    const r = a.roles && a.roles.length ? a.roles.join(", ") : "all roles";
    return `${d} · ${r}`;
  }

  function renderAccess() {
    fillSelect($("#chk-dept"), content.departments, "Any department");
    fillSelect($("#chk-role"), content.roles, "Any role");
    const dept = $("#chk-dept").value;
    const role = $("#chk-role").value;
    const who = $("#chk-name").value.trim();
    const items = content.access.filter((a) => needs(a, dept, role));

    $("#access-checklist").innerHTML = `
      <div class="print-only print-heading">
        <h1>${esc(content.siteName || "")} — Access checklist</h1>
        <p><strong>Employee:</strong> ${esc(who) || "________________________"} &nbsp;
           <strong>Department:</strong> ${esc(dept) || "________________"} &nbsp;
           <strong>Role:</strong> ${esc(role) || "________________"} &nbsp;
           <strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
      </div>` + (items.length ? `
      <table class="access-table">
        <thead><tr><th class="tick">✓</th><th>Access needed</th><th>Location</th><th>How to request</th><th>Approver</th><th class="print-only">Date done</th></tr></thead>
        <tbody>${items.map((a) => `<tr>
          <td class="tick"><input type="checkbox" aria-label="Done: ${esc(a.name)}" /></td>
          <td><strong>${esc(a.name)}</strong><br><span class="kind">${KINDS[a.kind] || ""}</span>
            ${a.notes ? `<div class="muted small">${esc(a.notes)}</div>` : ""}</td>
          <td class="mono">${esc(a.location || "")}</td>
          <td>${esc(a.howToRequest || "")}</td>
          <td>${esc(a.approver || "")}</td>
          <td class="print-only"></td>
        </tr>`).join("")}</tbody>
      </table>
      <p class="muted small">${items.length} item${items.length === 1 ? "" : "s"}${dept || role ? " for " + esc([dept, role].filter(Boolean).join(" · ")) : " (everything)"}.</p>`
      : '<p class="empty">No access items match. Add some below.</p>');

    $("#access-list").innerHTML = content.access.length ? `<ul class="res-list">${content.access.map((a) => `
      <li>
        <div class="res-main">
          <div class="res-title"><span class="type">${KINDS[a.kind] || ""}</span> ${esc(a.name)}</div>
          <div class="res-meta muted small">🏢 ${esc(scopeText(a))}${a.location ? " · " + esc(a.location) : ""}</div>
        </div>
        <div class="res-actions">
          <button type="button" class="btn btn-small" data-access-edit="${esc(a.id)}">Edit</button>
          <button type="button" class="btn btn-small btn-danger" data-access-delete="${esc(a.id)}">Delete</button>
        </div>
      </li>`).join("")}</ul>` : '<p class="empty">No access items yet.</p>';
  }

  ["#chk-dept", "#chk-role"].forEach((sel) => $(sel).addEventListener("change", renderAccess));
  $("#chk-name").addEventListener("input", renderAccess);
  $("#print-access").addEventListener("click", () => {
    document.body.classList.add("printing-access");
    window.print();
    document.body.classList.remove("printing-access");
  });

  function openAccess(a) {
    editingAccess = a ? a.id : null;
    accessForm.reset();
    $("#access-error").hidden = true;
    $("#access-title").textContent = a ? "Edit access item" : "Add access item";
    accessForm.name.value = (a && a.name) || "";
    accessForm.kind.value = (a && a.kind) || "system";
    accessForm.location.value = (a && a.location) || "";
    accessForm.howToRequest.value = (a && a.howToRequest) || "";
    accessForm.approver.value = (a && a.approver) || "";
    accessForm.notes.value = (a && a.notes) || "";
    checkboxes($("#access-dept-checks"), "departments", content.departments, a && a.departments,
      "No departments set up yet.");
    checkboxes($("#access-role-checks"), "roles", content.roles, a && a.roles, "No roles set up yet.");
    accessDialog.showModal();
    accessForm.name.focus();
  }

  $("#new-access").addEventListener("click", () => openAccess(null));
  $("#cancel-access").addEventListener("click", () => accessDialog.close());
  $("#access-list").addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-access-edit]");
    if (edit) return openAccess(content.access.find((a) => a.id === edit.dataset.accessEdit));
    const del = e.target.closest("[data-access-delete]");
    if (del) {
      const a = content.access.find((x) => x.id === del.dataset.accessDelete);
      if (!a || !confirm(`Delete "${a.name}" from the access list?`)) return;
      try {
        await api("DELETE", "/api/admin/access/" + encodeURIComponent(a.id));
        toast("Deleted");
        await reload();
      } catch (err) { toast(err.message, true); }
    }
  });

  accessForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      name: accessForm.name.value,
      kind: accessForm.kind.value,
      location: accessForm.location.value,
      howToRequest: accessForm.howToRequest.value,
      approver: accessForm.approver.value,
      notes: accessForm.notes.value,
      departments: checked(accessForm, "departments"),
      roles: checked(accessForm, "roles"),
    };
    try {
      if (editingAccess) await api("PUT", "/api/admin/access/" + encodeURIComponent(editingAccess), body);
      else await api("POST", "/api/admin/access", body);
      accessDialog.close();
      toast("Saved");
      await reload();
    } catch (err) {
      $("#access-error").textContent = err.message;
      $("#access-error").hidden = false;
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    reload().then(() => {
      let tab = "dashboard";
      try { tab = sessionStorage.getItem("ntic:tab") || tab; } catch (e) { /* ignore */ }
      NTA.openTab(tab);
    }).catch((err) => toast("Couldn't load content: " + err.message, true));
  });
})();
