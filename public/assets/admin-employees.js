/* Admin → Employees: staff logins, temporary passwords and saved onboarding records. */
(function () {
  "use strict";

  const A = window.NTA;
  const { $, esc, api, toast, fmtDate, appliesTo } = A;
  const KINDS = { system: "💻", folder: "📁", email: "✉️", hardware: "🔑", training: "🎓", other: "📌" };

  let employees = [];
  let me = null;
  let editing = null;
  let onboardingFor = null;

  async function loadEmployees() {
    employees = await api("GET", "/api/admin/employees");
    render();
  }

  function accessFor(u) {
    return A.content.access.filter((a) => appliesTo(a, u));
  }
  function readingFor(u) {
    return A.content.resources.filter((r) => r.requiresAck && appliesTo(r, u));
  }
  const hasRead = (u, r) => Boolean(u.acks && u.acks[r.id] && u.acks[r.id].rev === (r.rev || 1));

  function render() {
    const c = A.content;
    A.fillSelect($("#emp-dept"), c.departments, "All departments");
    const q = $("#emp-search").value.trim().toLowerCase();
    const dept = $("#emp-dept").value;
    const showDisabled = $("#emp-show-disabled").checked;
    const list = employees.filter((u) =>
      (showDisabled || u.active) && (!dept || u.department === dept) &&
      (!q || [u.name, u.username, u.jobTitle, u.department, u.role, u.email].join(" ").toLowerCase().includes(q)));

    $("#employee-list").innerHTML = list.length ? `<table class="emp-table">
      <thead><tr><th>Name</th><th>Department / role</th><th>Started</th><th>Access set up</th><th>Required reading</th><th>Last sign-in</th><th></th></tr></thead>
      <tbody>${list.map((u) => {
        const acc = accessFor(u);
        const accDone = acc.filter((a) => u.onboarding && u.onboarding[a.id]).length;
        const rd = readingFor(u);
        const rdDone = rd.filter((r) => hasRead(u, r)).length;
        const badges = [
          u.isAdmin ? '<span class="badge-pill admin">Admin</span>' : "",
          !u.active ? '<span class="badge-pill off">Disabled</span>' : "",
          u.active && u.mustChangePassword ? '<span class="badge-pill warn" title="Hasn\'t chosen their own password yet">Temp password</span>' : "",
        ].join("");
        return `<tr class="${u.active ? "" : "inactive"}">
          <td><strong>${esc(u.name)}</strong> ${badges}<br><span class="muted small">${esc(u.username)}${u.jobTitle ? " · " + esc(u.jobTitle) : ""}</span></td>
          <td>${esc(u.department || "—")}<br><span class="muted small">${esc(u.role || "")}</span></td>
          <td>${esc(fmtDate(u.startDate)) || "—"}</td>
          <td>${acc.length ? progress(accDone, acc.length) : '<span class="muted small">—</span>'}</td>
          <td>${rd.length ? progress(rdDone, rd.length) : '<span class="muted small">—</span>'}</td>
          <td class="small">${u.lastLoginAt ? esc(fmtDate(u.lastLoginAt)) : '<span class="muted">Never</span>'}</td>
          <td class="emp-actions"><div>
            <button type="button" class="btn btn-small" data-onboard="${esc(u.id)}">Onboarding</button>
            <button type="button" class="btn btn-small btn-ghost" data-edit-emp="${esc(u.id)}">Edit</button>
            <button type="button" class="btn btn-small btn-ghost" data-reset="${esc(u.id)}">New password</button>
            <button type="button" class="btn btn-small btn-danger" data-delete-emp="${esc(u.id)}" ${me && me.id === u.id ? "disabled" : ""}>Delete</button>
          </div></td>
        </tr>`;
      }).join("")}</tbody></table>` : '<p class="empty">No employees match.</p>';
  }

  function progress(done, total) {
    const pct = Math.round((100 * done) / total);
    return `<div class="mini-progress" title="${done} of ${total}"><span style="width:${pct}%"></span></div>
      <span class="small ${done === total ? "ok" : "muted"}">${done}/${total}</span>`;
  }

  // ---------------------------------------------------------------------------
  // Add / edit
  // ---------------------------------------------------------------------------
  const dialog = $("#employee-dialog");
  const form = $("#employee-form");
  let usernameTouched = false;

  function openEmployee(u) {
    editing = u ? u.id : null;
    usernameTouched = Boolean(u);
    form.reset();
    $("#employee-error").hidden = true;
    $("#employee-title").textContent = u ? `Edit ${u.name}` : "Add employee";
    const c = A.content;
    form.department.innerHTML = '<option value="">—</option>' + c.departments.map((d) => `<option>${esc(d)}</option>`).join("");
    form.role.innerHTML = '<option value="">—</option>' + c.roles.map((r) => `<option>${esc(r)}</option>`).join("");
    for (const k of ["name", "username", "jobTitle", "email", "department", "role", "startDate", "notes"]) form[k].value = (u && u[k]) || "";
    form.isAdmin.checked = Boolean(u && u.isAdmin);
    form.active.checked = !u || u.active;
    $("#active-field").hidden = !u;
    if (!u) form.startDate.value = new Date().toISOString().slice(0, 10);
    dialog.showModal();
    form.name.focus();
  }

  form.name.addEventListener("input", () => {
    if (usernameTouched) return;
    const parts = form.name.value.trim().toLowerCase().normalize("NFKD").replace(/[^a-z\s-]/g, "").split(/\s+/).filter(Boolean);
    form.username.value = parts.length > 1 ? `${parts[0]}.${parts[parts.length - 1]}` : parts[0] || "";
  });
  form.username.addEventListener("input", () => { usernameTouched = true; });
  $("#cancel-employee").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {};
    for (const k of ["name", "username", "jobTitle", "email", "department", "role", "startDate", "notes"]) body[k] = form[k].value;
    body.isAdmin = form.isAdmin.checked;
    if (editing) body.active = form.active.checked;
    try {
      if (editing) {
        await api("PUT", "/api/admin/employees/" + encodeURIComponent(editing), body);
        dialog.close();
        toast("Saved");
      } else {
        const res = await api("POST", "/api/admin/employees", body);
        dialog.close();
        showPassword(res.user, res.password, true);
      }
      await loadEmployees();
    } catch (err) {
      $("#employee-error").textContent = err.message;
      $("#employee-error").hidden = false;
    }
  });

  // ---------------------------------------------------------------------------
  // Temporary password slip
  // ---------------------------------------------------------------------------
  const pwDialog = $("#password-dialog");
  let slipText = "";

  function showPassword(u, password, isNew) {
    const site = A.content.siteName || "Information Center";
    slipText = `${site}\nWebsite: ${location.origin}\nUsername: ${u.username}\nTemporary password: ${password}\n` +
      "You'll be asked to choose your own password the first time you sign in.";
    $("#password-slip").innerHTML = `
      <h2 class="no-print">${isNew ? "✅ Login created" : "🔑 Password reset"} for ${esc(u.name)}</h2>
      <p class="muted small no-print">Give these details to ${esc(u.name.split(" ")[0])}. The password is only shown <strong>once</strong>. They'll choose their own when they first sign in.</p>
      <div class="slip">
        <h3>Welcome to ${esc(site)}${isNew ? "" : ""}</h3>
        <dl>
          <dt>Website</dt><dd>${esc(location.origin)}</dd>
          <dt>Username</dt><dd class="mono">${esc(u.username)}</dd>
          <dt>Temporary password</dt><dd class="mono big">${esc(password)}</dd>
        </dl>
        <p class="small">You'll be asked to choose your own password the first time you sign in.</p>
      </div>`;
    pwDialog.showModal();
  }
  $("#copy-password").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(slipText); toast("Copied"); } catch (e) { toast("Couldn't copy — select the text instead", true); }
  });
  $("#print-password").addEventListener("click", () => printOnly("printing-slip"));
  $("#close-password").addEventListener("click", () => pwDialog.close());

  function printOnly(cls) {
    document.body.classList.add(cls);
    window.print();
    document.body.classList.remove(cls);
  }

  // ---------------------------------------------------------------------------
  // Onboarding record (saved access checklist + required reading)
  // ---------------------------------------------------------------------------
  const obDialog = $("#onboarding-dialog");

  function renderOnboarding() {
    const u = employees.find((x) => x.id === onboardingFor);
    if (!u) return obDialog.close();
    const acc = accessFor(u);
    const rd = readingFor(u);
    const done = acc.filter((a) => u.onboarding && u.onboarding[a.id]).length;
    $("#onboarding-body").innerHTML = `
      <div class="panel-head">
        <div>
          <h2>Onboarding: ${esc(u.name)}</h2>
          <p class="muted small">${esc([u.jobTitle, u.department, u.role].filter(Boolean).join(" · ") || "No department or role set")}
            ${u.startDate ? " · Started " + esc(fmtDate(u.startDate)) : ""}</p>
        </div>
        <div class="big-progress">${done}/${acc.length} access set up</div>
      </div>
      <h3>🔑 System &amp; folder access</h3>
      ${acc.length ? `<table class="access-table">
        <thead><tr><th class="tick">✓</th><th>Access needed</th><th>Location</th><th>How to request</th><th>Done</th></tr></thead>
        <tbody>${acc.map((a) => {
          const rec = u.onboarding && u.onboarding[a.id];
          return `<tr>
            <td class="tick"><input type="checkbox" data-grant="${esc(a.id)}" ${rec ? "checked" : ""} aria-label="${esc(a.name)} set up" /></td>
            <td><strong>${KINDS[a.kind] || ""} ${esc(a.name)}</strong>${a.notes ? `<div class="muted small">${esc(a.notes)}</div>` : ""}</td>
            <td class="mono">${esc(a.location || "")}</td>
            <td>${esc(a.howToRequest || "")}${a.approver ? `<div class="muted small">Approver: ${esc(a.approver)}</div>` : ""}</td>
            <td class="small">${rec ? `${esc(fmtDate(rec.at))}<br><span class="muted">${esc(rec.by || "")}</span>` : ""}</td>
          </tr>`;
        }).join("")}</tbody></table>`
        : '<p class="empty">No access items apply. Set their department and role, or add items in the Access Checklist tab.</p>'}
      <h3>📌 Required reading</h3>
      ${rd.length ? `<ul class="status-list">${rd.map((r) => {
        const a = u.acks && u.acks[r.id];
        const ok = hasRead(u, r);
        return `<li><span>${ok ? "✅" : "⬜"}</span> <strong>${esc(r.title)}</strong>
          <span class="muted small">${ok ? "Read " + esc(fmtDate(a.at)) : a ? "Read an older version" : "Not read yet"}</span></li>`;
      }).join("")}</ul>` : '<p class="empty">No required reading applies to this person.</p>'}
      <p class="print-only sign-off">Completed by: ______________________ &nbsp; Date: ____________</p>`;
  }

  $("#onboarding-body").addEventListener("change", async (e) => {
    const box = e.target.closest("[data-grant]");
    if (!box) return;
    box.disabled = true;
    try {
      const updated = await api("PUT",
        `/api/admin/employees/${encodeURIComponent(onboardingFor)}/onboarding/${encodeURIComponent(box.dataset.grant)}`,
        { done: box.checked });
      employees = employees.map((x) => (x.id === updated.id ? updated : x));
      renderOnboarding();
      render();
    } catch (err) {
      box.checked = !box.checked;
      box.disabled = false;
      toast(err.message, true);
    }
  });
  $("#print-onboarding").addEventListener("click", () => printOnly("printing-onboarding"));
  $("#close-onboarding").addEventListener("click", () => obDialog.close());

  // ---------------------------------------------------------------------------
  // List actions
  // ---------------------------------------------------------------------------
  $("#new-employee").addEventListener("click", () => openEmployee(null));
  ["#emp-search", "#emp-dept", "#emp-show-disabled"].forEach((s) => $(s).addEventListener("input", render));
  $("#emp-dept").addEventListener("change", render);

  $("#employee-list").addEventListener("click", async (e) => {
    const find = (attr) => {
      const el = e.target.closest(`[${attr}]`);
      return el && employees.find((u) => u.id === el.getAttribute(attr));
    };
    let u;
    if ((u = find("data-edit-emp"))) return openEmployee(u);
    if ((u = find("data-onboard"))) {
      onboardingFor = u.id;
      renderOnboarding();
      return obDialog.showModal();
    }
    if ((u = find("data-reset"))) {
      if (!confirm(`Give ${u.name} a new temporary password? Their current password will stop working.`)) return;
      try {
        const res = await api("POST", `/api/admin/employees/${encodeURIComponent(u.id)}/reset-password`);
        showPassword(res.user, res.password, false);
        await loadEmployees();
      } catch (err) { toast(err.message, true); }
      return;
    }
    if ((u = find("data-delete-emp"))) {
      if (!confirm(`Delete ${u.name}'s login? Their onboarding and reading records will be removed too.\n\nTip: to keep the history, edit them and untick "Account active" instead.`)) return;
      try {
        await api("DELETE", "/api/admin/employees/" + encodeURIComponent(u.id));
        toast("Deleted");
        await loadEmployees();
      } catch (err) { toast(err.message, true); }
    }
  });

  A.onTab.employees = [() => loadEmployees().catch((err) => toast(err.message, true))];
  A.onReload.push(() => { if (employees.length) render(); });
  A.employees = () => employees;

  fetch("/api/me").then((r) => r.json()).then((d) => {
    me = d.user;
    if (me) $("#admin-who").textContent = me.name;
  }).catch(() => {});
})();
