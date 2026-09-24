(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "show" + (isError ? " error" : "");
    setTimeout(() => (t.className = ""), 3000);
  }

  function appliesTo(item, u) {
    const d = item.departments || [];
    const r = item.roles || [];
    return (!d.length || d.includes(u.department)) && (!r.length || r.includes(u.role));
  }

  async function load() {
    const me = await (await fetch("/api/me", { cache: "no-store" })).json();
    const u = me.user;
    if (!u) return (location.href = "/login?next=/account");
    $("#who").textContent = `${u.name} · ${u.username}`;
    const forced = u.mustChangePassword;
    $("#welcome").hidden = !forced;
    $("#after-pw").hidden = forced;
    $("#home-link").hidden = forced;
    if (forced) return;

    const rows = [
      ["Name", u.name], ["Username", u.username], ["Job title", u.jobTitle], ["Department", u.department],
      ["Role", u.role], ["Email", u.email], ["Start date", u.startDate && fmtDate(u.startDate + "T00:00:00")],
      ["Account type", u.isAdmin ? "Admin" : "Staff"],
    ].filter(([, v]) => v);
    $("#details").innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");

    const [content, access] = await Promise.all([
      fetch("/api/content").then((r) => r.json()),
      fetch("/api/me/access").then((r) => r.json()),
    ]);

    const reading = (content.resources || []).filter((r) => r.requiresAck && appliesTo(r, u));
    $("#reading-panel").hidden = !reading.length;
    $("#reading").innerHTML = reading.map((r) => {
      const ack = u.acks && u.acks[r.id];
      const ok = ack && ack.rev === (r.rev || 1);
      return `<li class="${ok ? "done" : ""}"><span>${ok ? "✅" : "⬜"}</span>
        <a href="/go/${encodeURIComponent(r.id)}" target="_blank" rel="noopener">${esc(r.title)}</a>
        <span class="muted small">${ok ? "Read " + fmtDate(ack.at) : ack ? "Updated since you read it" : "Not read yet"}</span></li>`;
    }).join("");

    $("#access-panel").hidden = !access.length;
    $("#access").innerHTML = access.map((a) => `<li class="${a.done ? "done" : ""}"><span>${a.done ? "✅" : "⏳"}</span>
      <strong>${esc(a.name)}</strong>
      <span class="muted small">${a.done ? "Set up " + fmtDate(a.doneAt) : "Being arranged" + (a.howToRequest ? " — " + esc(a.howToRequest) : "")}</span></li>`).join("");
  }

  $("#pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $("#pw-error");
    err.hidden = true;
    if (f.next.value !== f.confirm.value) {
      err.textContent = "The new passwords don't match.";
      err.hidden = false;
      return;
    }
    const res = await fetch("/api/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "ntic" },
      body: JSON.stringify({ current: f.current.value, next: f.next.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      err.textContent = data.error || "Couldn't change your password.";
      err.hidden = false;
      return;
    }
    f.reset();
    if (new URLSearchParams(location.search).get("welcome")) {
      location.href = "/";
      return;
    }
    toast("Password changed");
    load();
  });

  load().catch(() => toast("Couldn't load your account.", true));
})();
