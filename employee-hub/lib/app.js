"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const { Store, ValidationError, validatePanel, COLLECTIONS } = require("./store");
const { createAuth } = require("./auth");
const { createMonday, MondayError } = require("./monday");
const { describeLink, normalizeUrl, boardIdFromUrl } = require("./links");
const { encodeQr, toSvg } = require("./qr");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const VIEWS = path.join(ROOT, "views");

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src https:",          // monday.com forms (and any other https page an admin chooses) open inside the hub
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * Build the Express app. `config`:
 *   dataDir, adminPassword, sessionSecret, mondayToken, mondayCacheSeconds, publicUrl
 *   (tests may also pass `fetchImpl` to fake monday.com)
 */
async function createApp(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(config.dataDir);
  store.init();
  const auth = createAuth({ dataDir: config.dataDir, secret: config.sessionSecret, adminPassword: config.adminPassword });
  const monday = createMonday({ token: config.mondayToken, cacheSeconds: config.mondayCacheSeconds, fetchImpl: config.fetchImpl || globalThis.fetch });
  const ctx = { config, store, auth, monday };

  const app = express();
  app.set("trust proxy", 1); // Railway terminates HTTPS in front of us
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": CSP,
    });
    next();
  });
  app.get("/healthz", (req, res) => res.send("ok"));
  app.use(auth.attach);

  const page = (res, file) => { res.set("Cache-Control", "no-store"); res.sendFile(file); };
  const publicUrl = (req) => store.get().settings.publicUrl || config.publicUrl || `${req.protocol}://${req.get("host")}`;

  // ---------------------------------------------------------------------------
  // Kiosk pages (no login: the hub is for everyone who scans the code)
  // ---------------------------------------------------------------------------
  app.get(["/", "/index.html"], (req, res) => page(res, path.join(PUBLIC, "index.html")));
  app.get(["/open/t/:id", "/open/l/:id"], (req, res) => page(res, path.join(PUBLIC, "open.html")));
  app.get("/qr", (req, res) => page(res, path.join(PUBLIC, "qr.html")));

  app.get("/qr.svg", (req, res) => {
    const target = publicUrl(req);
    let svg;
    try {
      svg = toSvg(encodeQr(target), { title: `QR code linking to ${target}` });
    } catch (e) {
      return res.status(422).type("text/plain").send("The hub address is too long to turn into a QR code.");
    }
    res.set("Cache-Control", "no-cache");
    res.type("image/svg+xml").send(svg);
  });

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  app.get("/api/hub", (req, res) => {
    res.set("Cache-Control", "no-cache");
    res.json({ ...store.publicView(), mondayConnected: monday.configured, publicUrl: publicUrl(req) });
  });

  app.get("/api/panels/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const panel = store.find("panels", req.params.id);
    if (!panel || !panel.active) return res.status(404).json({ error: "That panel no longer exists." });
    if (!monday.configured) return res.status(503).json({ error: "monday.com is not connected yet.", code: "not_configured" });
    const data = await monday.getPanelRows(panel, { timeZone: store.get().settings.timeZone });
    res.json({ id: panel.id, rows: data.rows, fetchedAt: data.fetchedAt, stale: data.stale, error: data.error || null });
  });

  // ---------------------------------------------------------------------------
  // Admin sign in / out
  // ---------------------------------------------------------------------------
  app.get("/admin/login", (req, res) => {
    if (req.isAdmin) return res.redirect("/admin");
    page(res, path.join(VIEWS, "login.html"));
  });

  app.post("/admin/login", express.urlencoded({ extended: false, limit: "10kb" }), (req, res) => {
    if (!auth.enabled) return res.redirect("/admin/login?error=disabled");
    if (auth.tooManyAttempts(req.ip)) return res.redirect("/admin/login?error=locked");
    const password = String((req.body && req.body.password) || "");
    if (!auth.checkPassword(password)) {
      auth.recordFailure(req.ip);
      console.warn(`Failed admin sign-in from ${req.ip}`);
      return res.redirect("/admin/login?error=wrong");
    }
    auth.recordSuccess(req.ip);
    auth.issue(res, req);
    res.redirect("/admin");
  });

  app.post("/admin/logout", (req, res) => {
    auth.clear(res);
    res.redirect("/admin/login?signedout=1");
  });

  app.get("/admin", (req, res) => {
    if (!req.isAdmin) return res.redirect("/admin/login");
    page(res, path.join(VIEWS, "admin.html"));
  });

  // ---------------------------------------------------------------------------
  // Admin API
  // ---------------------------------------------------------------------------
  const api = express.Router();
  api.use(auth.requireAdminApi, auth.csrf, express.json({ limit: "200kb" }));

  api.get("/content", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ ...store.get(), monday: { configured: monday.configured }, publicUrl: publicUrl(req), adminEnabled: auth.enabled });
  });

  api.put("/settings", async (req, res) => res.json(await store.saveSettings(req.body)));
  api.put("/option-labels", async (req, res) => res.json(await store.saveOptionLabels(req.body)));

  api.param("collection", (req, res, next, value) => {
    if (!COLLECTIONS.includes(value)) return res.status(404).json({ error: "Unknown collection." });
    next();
  });
  api.post("/:collection", async (req, res) => res.status(201).json(await store.add(req.params.collection, req.body)));
  api.put("/:collection/order", async (req, res) => {
    await store.reorder(req.params.collection, req.body && req.body.ids);
    res.json({ ok: true });
  });
  api.put("/:collection/:id", async (req, res) => {
    const item = await store.edit(req.params.collection, req.params.id, req.body);
    if (req.params.collection === "panels") monday.forget(item.id);
    res.json(item);
  });
  api.delete("/:collection/:id", async (req, res) => {
    await store.remove(req.params.collection, req.params.id);
    monday.forget(req.params.id);
    res.json({ ok: true });
  });

  // What is this link? Lets the admin page say "monday.com form — opens inside the hub" as you paste.
  api.get("/link-info", (req, res) => {
    let url;
    try { url = normalizeUrl(req.query.url); } catch (e) { return res.json({ ok: false, error: e.message }); }
    res.json({ ok: true, url, ...describeLink(url) });
  });

  api.get("/monday/status", async (req, res) => {
    if (!monday.configured) return res.json({ configured: false, ok: false, error: "MONDAY_API_TOKEN is not set on the service." });
    try {
      const me = await monday.me();
      res.json({ configured: true, ok: true, user: me && me.name, account: me && me.account ? me.account.name : "", slug: me && me.account ? me.account.slug : "" });
    } catch (e) {
      if (!(e instanceof MondayError)) throw e;
      res.json({ configured: true, ok: false, error: e.message, code: e.code });
    }
  });

  api.get("/monday/boards", async (req, res) => res.json(await monday.listBoards()));

  api.get("/monday/boards/:id", async (req, res) => {
    const id = boardIdFromUrl(req.params.id);
    if (!id) throw new ValidationError("Paste a board link (…monday.com/boards/123456) or a board ID.");
    res.json(await monday.getBoard(id, { fresh: req.query.fresh === "1" }));
  });

  // Try a panel's settings against the live board without saving.
  api.post("/panels/preview", async (req, res) => {
    const panel = validatePanel({ ...(req.body || {}), title: req.body && req.body.title ? req.body.title : "Preview" });
    const data = await monday.queryPanel(panel, { timeZone: store.get().settings.timeZone });
    res.json({ rows: data.rows, board: data.board, fetchedAt: Date.now() });
  });

  app.use("/api/admin", api);

  // Static assets (CSS/JS). HTML pages are served through the routes above.
  app.use(express.static(PUBLIC, { index: false, extensions: [] }));

  // ---------------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------------
  app.use((req, res) => {
    if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
    res.status(404).type("text/plain").send("Not found");
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError) return res.status(err.status || 400).json({ error: err.message });
    if (err instanceof MondayError) return res.status(err.status || 502).json({ error: err.message, code: err.code });
    if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "The request body was not valid JSON." });
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "The request was too large." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return { app, ctx };
}

module.exports = { createApp };
