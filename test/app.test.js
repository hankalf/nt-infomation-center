"use strict";

// End-to-end tests against a real server on a random port with a throwaway data folder.
// Run with: npm test

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");
const { createApp } = require("../lib/app");

const ADMIN_PASSWORD = "admin-test-pass";
const SEED = path.join(__dirname, "..", "seed", "files");
let server;
let base;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ntic-test-"));
  const origLog = console.log;
  console.log = () => {}; // keep test output tidy
  const { app } = await createApp({
    dataDir, adminPassword: ADMIN_PASSWORD, resetAdminPassword: false, sessionSecret: "",
    maxUploadMb: 5, maxRestoreMb: 50,
  });
  console.log = origLog;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** A tiny browser: keeps the session cookie and sends the CSRF header on API writes. */
function client() {
  let cookie = "";
  async function request(method, url, { json, form, body, headers = {} } = {}) {
    const h = { ...headers };
    if (cookie) h.Cookie = cookie;
    if (url.startsWith("/api/") && method !== "GET" && !("X-Requested-With" in h)) h["X-Requested-With"] = "ntic";
    let payload = body;
    if (json !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(json); }
    if (form) { h["Content-Type"] = "application/x-www-form-urlencoded"; payload = new URLSearchParams(form).toString(); }
    const res = await fetch(base + url, { method, headers: h, body: payload, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set && set.includes("ntic_session=")) {
      const m = /ntic_session=([^;]*)/.exec(set);
      cookie = m[1] ? "ntic_session=" + m[1] : "";
    }
    return res;
  }
  return {
    request,
    get: (u, o) => request("GET", u, o),
    post: (u, o) => request("POST", u, o),
    put: (u, o) => request("PUT", u, o),
    del: (u, o) => request("DELETE", u, o),
    async login(username, password) {
      const res = await request("POST", "/login", { form: { username, password, next: "/" } });
      return res.headers.get("location");
    },
    async json(method, url, opts) {
      const res = await request(method, url, opts);
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || res.status), { status: res.status, data });
      return data;
    },
  };
}

function fileForm(fields, files) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [field, filePath, name] of files) {
    fd.append(field, new Blob([fs.readFileSync(filePath)]), name || path.basename(filePath));
  }
  return fd;
}

let admin;
async function adminClient() {
  if (admin) return admin;
  admin = client();
  assert.equal(await admin.login("admin", ADMIN_PASSWORD), "/");
  return admin;
}

// ---------------------------------------------------------------------------

test("the site requires sign-in by default", async () => {
  const anon = client();
  const page = await anon.get("/");
  assert.equal(page.status, 302);
  assert.match(page.headers.get("location"), /^\/login/);
  assert.equal((await anon.get("/api/content")).status, 401);
  assert.equal((await anon.get("/files/Welcome-Guide.pdf")).status, 401);
  assert.equal((await anon.get("/index.html")).status, 302, "index.html must not bypass the login");
  assert.equal((await anon.get("/api/public-info")).status, 200);
});

test("wrong passwords are rejected and logged", async () => {
  const c = client();
  assert.match(await c.login("admin", "nope"), /error=wrong/);
  const a = await adminClient();
  const log = await a.json("GET", "/api/admin/activity");
  assert.ok(log.some((e) => e.action === "Failed sign-in" && e.detail.startsWith("admin")));
});

test("admin can create an employee who must choose a password", async () => {
  const a = await adminClient();
  const { user, password } = await a.json("POST", "/api/admin/employees", {
    json: { name: "Sam Patel", username: "sam.patel", department: "Transport", role: "Transport Planner" },
  });
  assert.equal(user.passwordHash, undefined, "hash must never be sent to the browser");
  assert.match(password, /^[A-Za-z]+-[A-Za-z]+-\d{4}$/);

  const sam = client();
  assert.equal(await sam.login("sam.patel", password), "/account?welcome=1");
  // Can't use the site until the password is changed
  assert.equal((await sam.get("/api/content")).status, 403);
  await assert.rejects(sam.json("POST", "/api/me/password", { json: { current: password, next: "short" } }), /at least 8/);
  await sam.json("POST", "/api/me/password", { json: { current: password, next: "sams-new-password" } });
  assert.equal((await sam.get("/api/content")).status, 200);
  // Employees can't reach admin
  assert.equal((await sam.get("/api/admin/content")).status, 403);
  assert.equal((await sam.get("/admin")).status, 403);

  // Password reset signs them out and issues a new temporary password
  const reset = await a.json("POST", `/api/admin/employees/${user.id}/reset-password`);
  assert.equal((await sam.get("/api/content")).status, 401);
  assert.equal(await client().login("sam.patel", reset.password), "/account?welcome=1");
});

test("disabling an employee blocks sign-in; can't remove the last admin", async () => {
  const a = await adminClient();
  const { user, password } = await a.json("POST", "/api/admin/employees", { json: { name: "Temp Worker", username: "temp.worker" } });
  await a.json("PUT", `/api/admin/employees/${user.id}`, { json: { ...user, active: false } });
  assert.match(await client().login("temp.worker", password), /error=disabled/);

  const me = (await a.json("GET", "/api/me")).user;
  await assert.rejects(a.json("PUT", `/api/admin/employees/${me.id}`, { json: { ...me, isAdmin: false } }), /own admin/);
  await assert.rejects(a.json("DELETE", `/api/admin/employees/${me.id}`), /own account/);
  await assert.rejects(a.json("POST", "/api/admin/employees", { json: { name: "Dup", username: "sam.patel" } }), /already taken/);
});

test("API writes need the CSRF header", async () => {
  const a = await adminClient();
  const res = await a.request("POST", "/api/admin/access", {
    json: { name: "x" }, headers: { "X-Requested-With": "nope" },
  });
  assert.equal(res.status, 403);
});

test("access checklist is admin-only and onboarding is saved per employee", async () => {
  const a = await adminClient();
  const content = await a.json("GET", "/api/admin/content");
  assert.ok(content.access.length > 0);
  const { user, password } = await a.json("POST", "/api/admin/employees", {
    json: { name: "Casey Green", username: "casey.green", department: "Inventory", role: "Inventory Controller" },
  });
  const casey = client();
  await casey.login("casey.green", password);
  await casey.json("POST", "/api/me/password", { json: { current: password, next: "casey-password-1" } });

  const pub = await casey.json("GET", "/api/content");
  assert.equal(pub.access, undefined, "access list must not be in public content");

  const mine = await casey.json("GET", "/api/me/access");
  assert.ok(mine.some((x) => x.name === "Stock Control shared folder"), "department-specific item applies");
  assert.ok(!mine.some((x) => x.name === "Transport shared mailbox"), "other department's item does not");

  const item = mine.find((x) => x.name === "Stock Control shared folder");
  await a.json("PUT", `/api/admin/employees/${user.id}/onboarding/${item.id}`, { json: { done: true } });
  const after = await casey.json("GET", "/api/me/access");
  assert.equal(after.find((x) => x.id === item.id).done, true);
});

test("uploading, replacing and restoring a document keeps versions", async () => {
  const a = await adminClient();
  const created = await a.json("POST", "/api/admin/resources", {
    body: fileForm({ title: "Picking SOP", category: "sops", type: "sop" }, [["file", path.join(SEED, "SOP-Goods-In-Receiving.pdf")]]),
  });
  assert.equal(created.rev, 1);
  const firstFile = created.file;

  const replaced = await a.json("PUT", `/api/admin/resources/${created.id}`, {
    body: fileForm({ title: "Picking SOP", category: "sops", type: "sop" }, [["file", path.join(SEED, "Welcome-Guide.pdf")]]),
  });
  assert.equal(replaced.rev, 2);
  assert.equal(replaced.versions[0].file, firstFile);
  assert.ok(fs.existsSync(path.join(dataDir, "uploads", firstFile)), "old version kept on disk");

  const restored = await a.json("POST", `/api/admin/resources/${created.id}/restore`, { json: { file: firstFile } });
  assert.equal(restored.file, firstFile);
  assert.equal(restored.versions[0].file, replaced.file);

  await a.json("DELETE", `/api/admin/resources/${created.id}`);
  assert.ok(!fs.existsSync(path.join(dataDir, "uploads", firstFile)), "files removed with the resource");
  assert.ok(!fs.existsSync(path.join(dataDir, "uploads", replaced.file)));
});

test("disallowed file types and unsafe links are rejected", async () => {
  const a = await adminClient();
  await assert.rejects(a.json("POST", "/api/admin/resources", {
    body: fileForm({ title: "Bad", category: "sops" }, [["file", __filename, "evil.html"]]),
  }), /aren't allowed/);
  await assert.rejects(a.json("POST", "/api/admin/resources", {
    body: fileForm({ title: "Bad", category: "sops", url: "javascript:alert(1)" }, []),
  }), /Links must start/);
});

test("bulk upload creates one resource per file", async () => {
  const a = await adminClient();
  const created = await a.json("POST", "/api/admin/resources/bulk", {
    body: fileForm({ category: "forms", departments: "Inbound" }, [
      ["files", path.join(SEED, "Daily-Handover-Template.docx")],
      ["files", path.join(SEED, "Stock-Discrepancy-Tracker.xlsx")],
    ]),
  });
  assert.deepEqual(created.map((r) => r.title), ["Daily Handover Template", "Stock Discrepancy Tracker"]);
  assert.deepEqual(created[0].departments, ["Inbound"]);
});

test("search finds words inside PDFs and Word documents", async () => {
  const a = await adminClient();
  // Indexing happens in the background after upload; give it a moment
  let hits = [];
  for (let i = 0; i < 40 && !hits.length; i++) {
    hits = await a.json("GET", "/api/search?q=" + encodeURIComponent("inspect pallets"));
    if (!hits.length) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(hits.length > 0, "PDF text is searchable");
  let docx = [];
  for (let i = 0; i < 40 && !docx.length; i++) {
    docx = await a.json("GET", "/api/search?q=" + encodeURIComponent("actions for next shift"));
    if (!docx.length) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(docx.length > 0, "Word text is searchable");
});

test("required reading: confirm, then re-confirm after a new version", async () => {
  const a = await adminClient();
  const r = await a.json("POST", "/api/admin/resources", {
    body: fileForm({ title: "Fire Safety", category: "safety", requiresAck: "true" }, [["file", path.join(SEED, "Welcome-Guide.pdf")]]),
  });
  const { password } = await a.json("POST", "/api/admin/employees", { json: { name: "Reader One", username: "reader.one" } });
  const u = client();
  await u.login("reader.one", password);
  await u.json("POST", "/api/me/password", { json: { current: password, next: "reader-pass-1" } });
  await u.json("POST", `/api/me/ack/${r.id}`);
  let me = (await u.json("GET", "/api/me")).user;
  assert.equal(me.acks[r.id].rev, 1);

  let dash = await a.json("GET", "/api/admin/dashboard");
  let row = dash.reading.find((x) => x.id === r.id);
  assert.ok(!row.outstanding.includes("Reader One"));

  await a.json("PUT", `/api/admin/resources/${r.id}`, {
    body: fileForm({ title: "Fire Safety", category: "safety", requiresAck: "true" }, [["file", path.join(SEED, "SOP-Goods-In-Receiving.pdf")]]),
  });
  dash = await a.json("GET", "/api/admin/dashboard");
  row = dash.reading.find((x) => x.id === r.id);
  assert.ok(row.outstanding.includes("Reader One"), "new version needs confirming again");
});

test("org chart loops are rejected; removed departments are cleared", async () => {
  const a = await adminClient();
  const c = await a.json("GET", "/api/admin/content");
  const people = c.people.map((p) => ({ ...p }));
  people.find((p) => p.id === "p-gm").reportsTo = "p-ic"; // manager reports to someone below them
  const body = { siteName: c.siteName, tagline: c.tagline, roles: c.roles, departments: c.departments,
    categories: c.categories, people, announcements: [], settings: c.settings };
  await assert.rejects(a.json("PUT", "/api/admin/settings", { json: body }), /loop/);

  body.people = c.people;
  body.departments = c.departments.filter((d) => d !== "Transport");
  await a.json("PUT", "/api/admin/settings", { json: body });
  const after = await a.json("GET", "/api/admin/content");
  assert.equal(after.people.find((p) => p.id === "p-tp").department, "");
  assert.ok(!after.access.some((x) => (x.departments || []).includes("Transport")));
});

test("announcements past their end date are hidden", async () => {
  const a = await adminClient();
  const c = await a.json("GET", "/api/admin/content");
  await a.json("PUT", "/api/admin/settings", { json: { ...c, announcements: [
    { text: "Current notice", level: "info", until: "" },
    { text: "Old notice", level: "warning", until: "2000-01-01" },
  ] } });
  const pub = await a.json("GET", "/api/content");
  assert.deepEqual(pub.announcements.map((x) => x.text), ["Current notice"]);
});

test("opening a resource via /go counts a view", async () => {
  const a = await adminClient();
  const c = await a.json("GET", "/api/content");
  const r = c.resources[0];
  const res = await a.get("/go/" + r.id);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), r.url);
  const dash = await a.json("GET", "/api/admin/dashboard");
  assert.ok(dash.top.some((x) => x.id === r.id && x.views >= 1));
});

test("backup downloads a zip that restores cleanly", async () => {
  const a = await adminClient();
  const res = await a.get("/api/admin/backup");
  assert.equal(res.status, 200);
  const zipBuf = Buffer.from(await res.arrayBuffer());
  const names = new AdmZip(zipBuf).getEntries().map((e) => e.entryName);
  assert.ok(names.includes("content.json") && names.includes("users.json"));
  assert.ok(names.some((n) => n.startsWith("uploads/")));

  // Change something, then restore and check it's back
  const before = await a.json("GET", "/api/admin/content");
  await a.json("PUT", "/api/admin/settings", { json: { ...before, siteName: "Changed Name" } });
  const fd = new FormData();
  fd.append("backup", new Blob([zipBuf]), "backup.zip");
  const restored = await a.json("POST", "/api/admin/restore", { body: fd });
  assert.ok(restored.files > 0);
  const c = await (await adminClient()).json("GET", "/api/admin/content");
  assert.equal(c.siteName, before.siteName);
  assert.ok(fs.readdirSync(dataDir).some((n) => n.startsWith("before-restore-")), "safety copy kept");
});

test("a zip that isn't a backup is refused", async () => {
  const a = await adminClient();
  const zip = new AdmZip();
  zip.addFile("../../evil.txt", Buffer.from("x"));
  zip.addFile("hello.txt", Buffer.from("x"));
  const fd = new FormData();
  fd.append("backup", new Blob([zip.toBuffer()]), "bad.zip");
  await assert.rejects(a.json("POST", "/api/admin/restore", { body: fd }), /content\.json/);
  assert.ok(!fs.existsSync(path.join(dataDir, "..", "evil.txt")));
});

test("every admin change is in the activity log", async () => {
  const a = await adminClient();
  const log = await a.json("GET", "/api/admin/activity");
  const actions = new Set(log.map((e) => e.action));
  for (const act of ["Signed in", "Created login", "Reset password", "Added resource", "Replaced file",
    "Restored previous version", "Deleted resource", "Bulk uploaded", "Updated settings", "Access granted",
    "Confirmed read", "Changed password", "Downloaded backup", "Restored backup"]) {
    assert.ok(actions.has(act), `missing "${act}" in activity log`);
  }
  const csv = await a.get("/api/admin/activity.csv");
  assert.match(csv.headers.get("content-type"), /text\/csv/);
});
