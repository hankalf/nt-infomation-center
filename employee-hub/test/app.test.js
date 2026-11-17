"use strict";

// End-to-end tests against a real server on a random port with a throwaway data folder.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp } = require("../lib/app");
const { createFakeMonday } = require("./fake-monday");

const ADMIN_PASSWORD = "hub-test-pass";
let server, base, dataDir, fake;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-test-"));
  fake = createFakeMonday();
  const origLog = console.log;
  console.log = () => {};
  const { app } = await createApp({ dataDir, adminPassword: ADMIN_PASSWORD, sessionSecret: "", mondayToken: "tok", mondayCacheSeconds: 45, publicUrl: "", fetchImpl: fake.fetchImpl });
  console.log = origLog;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** A tiny browser: keeps the admin cookie and sends the CSRF header on API writes. */
function client() {
  let cookie = "";
  async function request(method, url, { json, form, headers = {} } = {}) {
    const h = { ...headers };
    if (cookie) h.Cookie = cookie;
    if (url.startsWith("/api/") && method !== "GET" && !("X-Requested-With" in h)) h["X-Requested-With"] = "hub";
    let body;
    if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
    const res = await fetch(base + url, { method, headers: h, body, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set && set.includes("hub_admin=")) {
      const m = /hub_admin=([^;]*)/.exec(set);
      cookie = m[1] ? "hub_admin=" + m[1] : "";
    }
    return res;
  }
  return { request, get: (u, o) => request("GET", u, o), post: (u, o) => request("POST", u, o), put: (u, o) => request("PUT", u, o), del: (u, o) => request("DELETE", u, o) };
}

async function signIn() {
  const c = client();
  const res = await c.post("/admin/login", { form: { password: ADMIN_PASSWORD } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/admin");
  return c;
}

test("health check and kiosk pages are public", async () => {
  assert.equal((await fetch(base + "/healthz")).status, 200);
  for (const p of ["/", "/qr", "/open/t/abc", "/open/l/abc"]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get("content-type"), /text\/html/);
    assert.match(r.headers.get("content-security-policy"), /frame-src https:/);
    assert.equal(r.headers.get("x-frame-options"), "DENY");
  }
  const svg = await fetch(base + "/qr.svg");
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(await svg.text(), /127\.0\.0\.1/);
  assert.equal((await fetch(base + "/nope")).status, 404);
  assert.equal((await fetch(base + "/api/nope")).status, 404);
});

test("the public hub view has the seeded tiles and hides board details", async () => {
  const hub = await (await fetch(base + "/api/hub")).json();
  assert.equal(hub.tiles.length, 4);
  assert.equal(hub.tiles[0].id, "checklist");
  assert.equal(hub.tiles[0].kind, "none");
  assert.equal(hub.mondayConnected, true);
  assert.match(hub.publicUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.deepEqual(hub.settings.languages, ["en", "es"]);
  assert.equal(hub.optionLabels.es.NEW, "NUEVO");
  assert.ok(!("boardId" in (hub.panels[0] || {})));
});

test("admin area needs the password; wrong passwords are counted", async () => {
  const c = client();
  assert.equal((await c.get("/admin")).status, 302);
  assert.equal((await c.get("/api/admin/content")).status, 401);
  const bad = await c.post("/admin/login", { form: { password: "nope" } });
  assert.equal(bad.headers.get("location"), "/admin/login?error=wrong");
  assert.equal((await c.get("/api/admin/content")).status, 401);
  const ok = await signIn();
  assert.equal((await ok.get("/admin")).status, 200);
  const content = await (await ok.get("/api/admin/content")).json();
  assert.equal(content.tiles.length, 4);
  assert.equal(content.monday.configured, true);
  // Writes need the CSRF header
  const noHeader = await ok.post("/api/admin/tiles", { json: { title: "x" }, headers: { "X-Requested-With": "" } });
  assert.equal(noHeader.status, 403);
  // Sign out
  const out = await ok.post("/admin/logout");
  assert.equal(out.status, 302);
  assert.equal((await ok.get("/api/admin/content")).status, 401);
});

test("tiles: add, edit, reorder, delete, with validation", async () => {
  const c = await signIn();
  let r = await c.post("/api/admin/tiles", { json: { title: { en: "Visitor sign-in", es: "Registro de visitantes" }, url: "forms.monday.com/forms/abc123?r=use1", icon: "📝", open: "embed" } });
  assert.equal(r.status, 201);
  const tile = await r.json();
  assert.equal(tile.url, "https://forms.monday.com/forms/abc123?r=use1");
  r = await c.post("/api/admin/tiles", { json: { title: "", url: "x" } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Title/);
  r = await c.put(`/api/admin/tiles/${tile.id}`, { json: { url: "javascript:alert(1)" } });
  assert.equal(r.status, 400);
  r = await c.put(`/api/admin/tiles/${tile.id}`, { json: { active: false } });
  assert.equal((await r.json()).active, false);

  let hub = await (await fetch(base + "/api/hub")).json();
  assert.ok(!hub.tiles.some((t) => t.id === tile.id), "inactive tiles are hidden from the kiosk");
  await c.put(`/api/admin/tiles/${tile.id}`, { json: { active: true } });
  hub = await (await fetch(base + "/api/hub")).json();
  const shown = hub.tiles.find((t) => t.id === tile.id);
  assert.equal(shown.kind, "form");
  assert.equal(shown.embedUrl, "https://forms.monday.com/forms/embed/abc123?r=use1");

  r = await c.put("/api/admin/tiles/order", { json: { ids: [tile.id, "pto"] } });
  assert.equal(r.status, 200);
  hub = await (await fetch(base + "/api/hub")).json();
  assert.deepEqual(hub.tiles.slice(0, 2).map((t) => t.id), [tile.id, "pto"]);

  assert.equal((await c.del(`/api/admin/tiles/${tile.id}`)).status, 200);
  assert.equal((await c.del(`/api/admin/tiles/${tile.id}`)).status, 404);
  assert.equal((await c.post("/api/admin/widgets", { json: {} })).status, 404);
});

test("link info describes what was pasted", async () => {
  const c = await signIn();
  let info = await (await c.get("/api/admin/link-info?url=" + encodeURIComponent("https://forms.monday.com/forms/zzz?r=use1"))).json();
  assert.equal(info.kind, "form");
  info = await (await c.get("/api/admin/link-info?url=nope")).json();
  assert.equal(info.ok, false);
});

test("monday status, board list and board details", async () => {
  const c = await signIn();
  const st = await (await c.get("/api/admin/monday/status")).json();
  assert.equal(st.ok, true);
  assert.equal(st.user, "Pat Lead");
  const boards = await (await c.get("/api/admin/monday/boards")).json();
  assert.deepEqual(boards.map((b) => b.name), ["Forklift Down", "PTO Requests"]); // subitem boards hidden
  const board = await (await c.get("/api/admin/monday/boards/" + encodeURIComponent("https://acme.monday.com/boards/111/views/9"))).json();
  assert.equal(board.name, "Forklift Down");
  assert.deepEqual(board.columns.find((col) => col.id === "status").labels.map((l) => l.label), ["Working on it", "Done", "Stuck", "NEW", "Pending Repair"]);
  assert.deepEqual(board.columns.find((col) => col.id === "lift").labels.map((l) => l.label), ["LINDE #1 - CLAMP", "LINDE #2 - DOCK"]);
  const missing = await c.get("/api/admin/monday/boards/999");
  assert.equal(missing.status, 404);
  assert.equal((await c.get("/api/admin/monday/boards/not-a-board")).status, 400);
});

test("panels: preview, save, kiosk reads rows, delete", async () => {
  const c = await signIn();
  const def = {
    title: { en: "Out of service", es: "Fuera de servicio" }, boardId: "111", boardName: "Forklift Down", columns: ["lift", "priority"],
    filters: [{ columnId: "status", op: "any_of", values: ["NEW", "Working on it", "Pending Repair"] }],
    highlight: { columns: ["priority"], values: ["Critical ⚠️️"], label: { en: "Critical", es: "Crítica" } }, limit: 12,
  };
  let r = await c.post("/api/admin/panels/preview", { json: def });
  assert.equal(r.status, 200);
  const preview = await r.json();
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0].flagged, true);

  r = await c.post("/api/admin/panels", { json: def });
  assert.equal(r.status, 201);
  const panel = await r.json();

  const hub = await (await fetch(base + "/api/hub")).json();
  const pub = hub.panels.find((p) => p.id === panel.id);
  assert.ok(pub);
  assert.equal(pub.boardId, undefined);
  assert.equal(pub.highlightLabel.es, "Crítica");

  r = await fetch(base + `/api/panels/${panel.id}`);
  assert.equal(r.status, 200);
  const rows = await r.json();
  assert.equal(rows.rows.length, 2);
  assert.equal(rows.stale, false);
  assert.equal(rows.rows[0].title, "Horn not working");

  // Editing the panel invalidates its cache: a filter for "today" on the date column leaves one row
  r = await c.put(`/api/admin/panels/${panel.id}`, { json: { filters: [{ columnId: "date4", op: "today", values: [] }] } });
  assert.equal(r.status, 200);
  const rows2 = await (await fetch(base + `/api/panels/${panel.id}`)).json();
  assert.equal(rows2.rows.length, 1);

  // Hidden panels aren't served to the kiosk
  await c.put(`/api/admin/panels/${panel.id}`, { json: { active: false } });
  assert.equal((await fetch(base + `/api/panels/${panel.id}`)).status, 404);
  assert.equal((await c.del(`/api/admin/panels/${panel.id}`)).status, 200);

  r = await c.post("/api/admin/panels", { json: { title: "x", boardId: "nope" } });
  assert.equal(r.status, 400);
});

test("settings and translations", async () => {
  const c = await signIn();
  let r = await c.put("/api/admin/settings", { json: { hubName: { en: "NT Hub", es: "Portal NT" }, languages: ["en"], idleReturnSeconds: 120, publicUrl: "hub.example.com", timeZone: "America/Chicago" } });
  assert.equal(r.status, 200);
  const s = await r.json();
  assert.deepEqual(s.languages, ["en"]);
  assert.equal(s.publicUrl, "https://hub.example.com/");
  const svg = await (await fetch(base + "/qr.svg")).text();
  assert.match(svg, /hub\.example\.com/);
  r = await c.put("/api/admin/settings", { json: { timeZone: "Nowhere/Land" } });
  assert.equal(r.status, 400);
  r = await c.put("/api/admin/option-labels", { json: { es: { Done: "Listo", "": "x" } } });
  assert.deepEqual((await r.json()).es, { Done: "Listo" });
  const hub = await (await fetch(base + "/api/hub")).json();
  assert.equal(hub.settings.hubName.en, "NT Hub");
  assert.equal(hub.optionLabels.es.Done, "Listo");
  // Restore for other tests
  await c.put("/api/admin/settings", { json: { languages: ["en", "es"], publicUrl: "" } });
});

test("bad JSON and a kiosk without a monday token are handled", async () => {
  const c = await signIn();
  const r = await c.post("/api/admin/tiles", { headers: { "Content-Type": "application/json" }, json: undefined });
  assert.equal(r.status, 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-test2-"));
  const { app } = await createApp({ dataDir: dir, adminPassword: "", sessionSecret: "", mondayToken: "", mondayCacheSeconds: 45, publicUrl: "https://hub.example" });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const b = `http://127.0.0.1:${srv.address().port}`;
  const hub = await (await fetch(b + "/api/hub")).json();
  assert.equal(hub.mondayConnected, false);
  assert.equal(hub.publicUrl, "https://hub.example");
  const login = await fetch(b + "/admin/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "password=anything", redirect: "manual" });
  assert.equal(login.headers.get("location"), "/admin/login?error=disabled");
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
