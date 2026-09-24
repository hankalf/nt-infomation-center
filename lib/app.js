"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { Store, ValidationError } = require("./store");
const { Users, hashPassword, verifyPassword, publicUser } = require("./users");
const { createAuth } = require("./auth");
const { Audit } = require("./audit");
const { Stats } = require("./stats");
const { FullText } = require("./fulltext");
const { createUploaders } = require("./uploads");
const { adminRouter, appliesTo } = require("../routes/admin");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const VIEWS = path.join(ROOT, "views");

/**
 * Build the Express app. `config`:
 *   dataDir, adminPassword, resetAdminPassword, sessionSecret, maxUploadMb, maxRestoreMb
 */
async function createApp(config) {
  const dataDir = config.dataDir;
  const tmpDir = path.join(dataDir, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  const store = new Store(dataDir);
  const users = new Users(dataDir);
  const stats = new Stats(dataDir);
  const fulltext = new FullText(dataDir);
  const audit = new Audit(dataDir);

  const ctx = {
    config, store, users, stats, fulltext, audit, restoring: false,
    uploaders: createUploaders({ uploadsDir: store.uploadsDir, tmpDir,
      maxUploadMb: config.maxUploadMb, maxRestoreMb: config.maxRestoreMb }),
    reload() {
      store.init();
      users.load();
      stats.load();
      fulltext.load();
      fulltext.catchUp(store.get().resources, (f) => store.uploadPath(f)).catch((e) => console.warn(e.message));
    },
  };
  ctx.reload();
  await users.bootstrap({ adminPassword: config.adminPassword, reset: config.resetAdminPassword });
  ctx.auth = createAuth({ users, dataDir, secret: config.sessionSecret });
  const dummyHash = await hashPassword("not-a-real-password");
  const { auth } = ctx;

  const app = express();
  app.set("trust proxy", 1); // Railway terminates HTTPS in front of us
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" });
    next();
  });
  app.get("/healthz", (req, res) => res.send("ok"));
  app.use(auth.attach);

  // Hold writes while a backup is being restored.
  app.use((req, res, next) => {
    if (ctx.restoring && req.method !== "GET") return res.status(503).json({ error: "A backup is being restored — try again in a moment." });
    next();
  });

  const requireLogin = () => store.get().settings.requireLogin;
  const safeNext = (n) => (typeof n === "string" && /^\/(?!\/)[\w\-./?=&#%]*$/.test(n) ? n : "/");
  const page = (res, file) => { res.set("Cache-Control", "no-store"); res.sendFile(path.join(VIEWS, file)); };

  /** For pages: send people to sign in (or to choose a password) first. */
  function gatePage(req, res, next) {
    if (req.user && req.user.mustChangePassword) return res.redirect("/account?welcome=1");
    if (!req.user && requireLogin()) return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
    next();
  }
  /** For APIs and files behind the site login. */
  function gateApi(req, res, next) {
    if (!requireLogin() && !req.user) return next();
    return auth.requireUserApi(req, res, next);
  }

  // ---------------------------------------------------------------------------
  // Sign in / out
  // ---------------------------------------------------------------------------
  app.get("/login", (req, res) => {
    if (req.user && !req.user.mustChangePassword) return res.redirect(safeNext(req.query.next));
    page(res, "login.html");
  });

  app.post("/login", express.urlencoded({ extended: false, limit: "10kb" }), async (req, res) => {
    const username = String((req.body && req.body.username) || "").trim().toLowerCase().slice(0, 60);
    const password = String((req.body && req.body.password) || "");
    const next = safeNext(req.body && req.body.next);
    const back = (code) => res.redirect(`/login?error=${code}&next=${encodeURIComponent(next)}&u=${encodeURIComponent(username)}`);
    if (auth.tooManyAttempts(req.ip, username)) return back("locked");
    const user = users.byUsername(username);
    // Check a password even for unknown usernames so response times don't reveal which usernames exist.
    const ok = (await verifyPassword(password, user ? user.passwordHash : dummyHash)) && user && user.active;
    if (!ok) {
      auth.recordFailure(req.ip, username);
      audit.log(null, "Failed sign-in", `${username || "(blank)"} from ${req.ip}`);
      return back(user && !user.active ? "disabled" : "wrong");
    }
    auth.recordSuccess(req.ip, username);
    await users.recordLogin(user.id);
    auth.issue(res, req, user);
    audit.log(user, "Signed in");
    res.redirect(user.mustChangePassword ? "/account?welcome=1" : next);
  });

  app.post("/logout", (req, res) => {
    auth.clear(res);
    res.redirect("/login?signedout=1");
  });

  // ---------------------------------------------------------------------------
  // Pages
  // ---------------------------------------------------------------------------
  app.get(["/", "/index.html"], gatePage, (req, res) => page(res, "../public/index.html"));

  app.get("/account", (req, res) => {
    if (!req.user) return res.redirect("/login?next=/account");
    page(res, "account.html");
  });

  app.get("/admin", (req, res) => {
    if (!req.user) return res.redirect("/login?next=/admin");
    if (req.user.mustChangePassword) return res.redirect("/account?welcome=1");
    if (!req.user.isAdmin) return res.status(403).send(
      '<!doctype html><meta name="viewport" content="width=device-width"><title>Admins only</title>' +
      '<body style="font-family:system-ui;padding:40px"><h1>Admins only</h1>' +
      '<p>Your account doesn\'t have admin access. <a href="/">Back to the Information Center</a></p>');
    page(res, "admin.html");
  });

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  // Name and logo for the sign-in page (no login needed).
  app.get("/api/public-info", (req, res) => {
    const c = store.get();
    res.json({ siteName: c.siteName, tagline: c.tagline, logo: c.logo || "" });
  });

  app.get("/api/content", gateApi, (req, res) => {
    res.set("Cache-Control", "no-cache");
    const { access, ...c } = store.get(); // the access checklist is admin-only
    const today = new Date().toISOString().slice(0, 10);
    res.json({
      ...c,
      resources: c.resources.map(({ versions, ...r }) => r),
      announcements: c.announcements.filter((a) => !a.until || a.until >= today),
    });
  });

  app.get("/api/me", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ user: req.user ? publicUser(req.user) : null, requireLogin: requireLogin() });
  });

  // The signed-in employee's own access checklist status (read only).
  app.get("/api/me/access", auth.requireUserApi, (req, res) => {
    const u = req.user;
    res.json(store.get().access.filter((a) => appliesTo(a, u)).map((a) => ({
      id: a.id, name: a.name, kind: a.kind, howToRequest: a.howToRequest || "",
      done: Boolean(u.onboarding && u.onboarding[a.id]), doneAt: u.onboarding && u.onboarding[a.id] ? u.onboarding[a.id].at : "",
    })));
  });

  app.post("/api/me/ack/:id", auth.csrf, auth.requireUserApi, async (req, res) => {
    const r = store.get().resources.find((x) => x.id === req.params.id);
    if (!r || !r.requiresAck) throw Object.assign(new ValidationError("That document doesn't need a read confirmation."), { status: 404 });
    await users.setAck(req.user.id, r.id, r.rev || 1);
    audit.log(req.user, "Confirmed read", r.title);
    res.json({ ok: true, rev: r.rev || 1 });
  });

  app.post("/api/me/password", auth.csrf, express.json({ limit: "10kb" }), async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Please sign in again." });
    const user = await users.changePassword(req.user.id, req.body.current, req.body.next);
    auth.issue(res, req, user); // other devices are signed out; keep this one signed in
    audit.log(user, "Changed password");
    res.json({ ok: true });
  });

  app.get("/api/search", gateApi, (req, res) => {
    res.json(fulltext.search(String(req.query.q || "").slice(0, 200)));
  });

  // Open a resource (counts the view, then redirects to the file or website).
  app.get("/go/:id", (req, res, next) => {
    if (!req.user && requireLogin()) return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
    next();
  }, (req, res) => {
    const r = store.get().resources.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).send("That resource no longer exists.");
    stats.record(r.id);
    res.redirect(r.url);
  });

  app.get("/files/:name", (req, res) => {
    const name = req.params.name;
    // The logo is always public so the sign-in page can show it.
    if (requireLogin() && !req.user && name !== store.get().logo) return res.status(401).send("Please sign in.");
    const p = store.uploadPath(name);
    if (!p) return res.status(404).send("Not found");
    const ext = path.extname(p).slice(1).toLowerCase();
    const inline = ["pdf", "svg", "png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "mov", "txt"].includes(ext);
    res.set("Content-Security-Policy", "sandbox");
    res.set("Cache-Control", "private, max-age=3600");
    const opts = { dotfiles: "deny", cacheControl: false };
    const r = store.get().resources.find((x) => x.file === name);
    const downloadName = (r && r.originalName) || name;
    if (inline) return res.sendFile(p, opts, (err) => err && !res.headersSent && res.status(404).send("Not found"));
    res.download(p, downloadName, opts, (err) => err && !res.headersSent && res.status(404).send("Not found"));
  });

  app.use("/api/admin", adminRouter(ctx));

  // Static assets (CSS/JS). index.html is only served through the gated route above.
  app.use(express.static(PUBLIC, { index: false }));

  // ---------------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------------
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError) return res.status(err.status || 400).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      const max = /\/(logo|photo)$/.test(req.path) ? 5 : req.path.endsWith("/restore") ? config.maxRestoreMb : config.maxUploadMb;
      const msg = err.code === "LIMIT_FILE_SIZE" ? `File is too big (max ${max} MB).`
        : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? "Too many files at once (max 30)." : err.message;
      return res.status(400).json({ error: msg });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return { app, ctx };
}

module.exports = { createApp };
