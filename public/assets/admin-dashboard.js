/* Admin → Dashboard and Activity log. */
(function () {
  "use strict";

  const A = window.NTA;
  const { $, esc, api, toast, fmtDate } = A;

  const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined,
    { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  function list(items, fn, empty) {
    return items.length ? `<ul class="dash-list">${items.map(fn).join("")}</ul>` : `<p class="empty">${empty}</p>`;
  }
  const editLink = (r) => `<button type="button" class="linkish" data-edit-res="${esc(r.id)}">${esc(r.title)}</button>`;

  async function renderDashboard() {
    const d = await api("GET", "/api/admin/dashboard");
    const c = d.counts;
    $("#dash-counts").innerHTML = [
      ["📄", c.resources, "resources", "resources"],
      ["📎", c.files, "uploaded files", "resources"],
      ["🪪", c.employees, "staff logins", "employees"],
      ["🏢", c.people, "people in org chart", "contacts"],
      ["🔑", c.access, "access items", "access"],
    ].map(([icon, n, label, tab]) => `<button type="button" class="stat" data-goto="${tab}">
      <span class="stat-icon">${icon}</span><strong>${n}</strong><span>${label}</span></button>`).join("");

    const reviewCount = d.overdue.length + d.noDate.length;
    $("#dash-review").innerHTML = `
      <h2>🗓️ Document reviews ${reviewCount ? `<span class="count warn">${reviewCount}</span>` : '<span class="count ok">✓</span>'}</h2>
      <p class="muted small">Documents should be reviewed every ${d.reviewMonths} months (change this under Site &amp; Backup).</p>
      ${d.overdue.length ? `<h3>Overdue</h3>${list(d.overdue, (r) => `<li>${editLink(r)}
        <span class="muted small">last reviewed ${esc(fmtDate(r.updated))}${r.owner ? " · " + esc(r.owner) : ""}</span></li>`, "")}` : ""}
      ${d.dueSoon.length ? `<h3>Due in the next 30 days</h3>${list(d.dueSoon, (r) => `<li>${editLink(r)}
        <span class="muted small">last reviewed ${esc(fmtDate(r.updated))}${r.owner ? " · " + esc(r.owner) : ""}</span></li>`, "")}` : ""}
      ${d.noDate.length ? `<h3>No review date</h3>${list(d.noDate, (r) => `<li>${editLink(r)}</li>`, "")}` : ""}
      ${!d.overdue.length && !d.dueSoon.length && !d.noDate.length ? '<p class="empty">All documents are up to date. 👍</p>' : ""}`;

    $("#dash-reading").innerHTML = `
      <h2>📌 Required reading</h2>
      ${list(d.reading, (r) => `<li>
        <div class="reading-row">${editLink(r)}
          <span class="small ${r.read === r.total ? "ok" : "muted"}">${r.read}/${r.total} read</span></div>
        <div class="mini-progress wide"><span style="width:${r.total ? Math.round(100 * r.read / r.total) : 100}%"></span></div>
        ${r.outstanding.length ? `<div class="muted small">Waiting on: ${esc(r.outstanding.slice(0, 12).join(", "))}${r.outstanding.length > 12 ? ` +${r.outstanding.length - 12} more` : ""}</div>` : ""}
      </li>`, 'Nothing marked as required reading yet. Tick "Staff must confirm they\'ve read it" on a resource.')}`;

    $("#dash-onboarding").innerHTML = `
      <h2>🪪 Onboarding in progress</h2>
      ${list(d.onboarding, (u) => `<li><div class="reading-row"><strong>${esc(u.name)}</strong>
        <span class="small muted">${u.done}/${u.total} access set up${u.startDate ? " · started " + esc(fmtDate(u.startDate)) : ""}</span></div>
        <div class="mini-progress wide"><span style="width:${Math.round(100 * u.done / u.total)}%"></span></div></li>`,
        "Everyone has all the access they need. 👍")}
      ${d.pendingPasswords.length ? `<p class="muted small">Haven't signed in and set a password yet: ${esc(d.pendingPasswords.join(", "))}</p>` : ""}
      <button type="button" class="btn btn-small btn-ghost" data-goto="employees">Go to Employees →</button>`;

    $("#dash-usage").innerHTML = `
      <h2>📈 Most opened</h2>
      ${list(d.top, (r) => `<li><div class="reading-row">${editLink(r)}<span class="small muted">${r.views} open${r.views === 1 ? "" : "s"}</span></div></li>`,
        "No views recorded yet.")}
      <h3>Not opened in 90 days</h3>
      ${list(d.unused.slice(0, 8), (r) => `<li>${editLink(r)}</li>`, "Everything has been used recently.")}
      ${d.unused.length > 8 ? `<p class="muted small">…and ${d.unused.length - 8} more. Worth checking whether they're still needed.</p>` : ""}`;

    $("#dash-activity").innerHTML = `
      <h2>🕘 Recent activity</h2>
      ${list(d.activity, (a) => `<li class="small"><strong>${esc(a.name)}</strong> ${esc(a.action.toLowerCase())}
        ${a.detail ? `<span class="muted">— ${esc(a.detail)}</span>` : ""}<br><span class="muted">${esc(fmtWhen(a.at))}</span></li>`,
        "No activity yet.")}
      <button type="button" class="btn btn-small btn-ghost" data-goto="activity">Full activity log →</button>`;
  }

  $("#tab-dashboard").addEventListener("click", (e) => {
    const go = e.target.closest("[data-goto]");
    if (go) return A.openTab(go.dataset.goto);
    const ed = e.target.closest("[data-edit-res]");
    if (ed) A.editResource(ed.dataset.editRes);
  });

  $("#run-linkcheck").addEventListener("click", async () => {
    const btn = $("#run-linkcheck");
    btn.disabled = true;
    btn.textContent = "Checking…";
    $("#linkcheck-results").innerHTML = '<p class="muted small">This can take up to a minute…</p>';
    try {
      const results = await api("POST", "/api/admin/linkcheck");
      const bad = results.filter((r) => !r.ok);
      const skipped = results.filter((r) => r.skipped).length;
      $("#linkcheck-results").innerHTML = (bad.length
        ? `<ul class="dash-list">${bad.map((r) => `<li>❌ ${editLink(r)} <span class="muted small">${esc(r.status)} · ${esc(r.url)}</span></li>`).join("")}</ul>`
        : `<p class="ok">✅ All ${results.length - skipped} links work.</p>`) +
        (skipped ? `<p class="muted small">${skipped} network-drive or email link(s) can't be checked from the server.</p>` : "");
    } catch (err) {
      toast(err.message, true);
      $("#linkcheck-results").innerHTML = "";
    } finally {
      btn.disabled = false;
      btn.textContent = "Run check";
    }
  });

  // ---------------------------------------------------------------------------
  // Activity log
  // ---------------------------------------------------------------------------
  let activity = [];
  async function loadActivity() {
    activity = await api("GET", "/api/admin/activity?limit=2000");
    renderActivity();
  }
  function renderActivity() {
    const q = $("#activity-search").value.trim().toLowerCase();
    const rows = activity.filter((a) => !q || [a.name, a.user, a.action, a.detail].join(" ").toLowerCase().includes(q)).slice(0, 500);
    $("#activity-list").innerHTML = rows.length ? `<table class="activity-table">
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
      <tbody>${rows.map((a) => `<tr class="${a.action === "Failed sign-in" ? "warn-row" : ""}">
        <td class="nowrap">${esc(fmtWhen(a.at))}</td>
        <td>${esc(a.name)}<br><span class="muted small">${esc(a.user)}</span></td>
        <td>${esc(a.action)}</td>
        <td class="small">${esc(a.detail)}</td></tr>`).join("")}</tbody></table>
      ${rows.length === 500 ? '<p class="muted small">Showing the latest 500 matches. Download the CSV for everything.</p>' : ""}`
      : '<p class="empty">No activity matches.</p>';
  }
  $("#activity-search").addEventListener("input", renderActivity);

  A.onTab.dashboard = [() => renderDashboard().catch((err) => toast(err.message, true))];
  A.onTab.activity = [() => loadActivity().catch((err) => toast(err.message, true))];
})();
