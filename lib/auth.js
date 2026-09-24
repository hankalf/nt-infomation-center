"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const COOKIE = "ntic_session";
const SESSION_HOURS = 12;

/** A signing key that survives restarts: SESSION_SECRET, or one generated once and kept in DATA_DIR. */
function loadSecret(dataDir, envSecret) {
  if (envSecret) return envSecret;
  const file = path.join(dataDir, "session.key");
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return fs.readFileSync(file, "utf8").trim();
}

/**
 * Cookie sessions for staff accounts. The cookie holds the user id, the
 * user's session version and an expiry, signed with HMAC. Bumping a user's
 * sessionVersion (password change/reset, account disabled) signs them out
 * everywhere.
 */
function createAuth({ users, dataDir, secret }) {
  const key = crypto.createHash("sha256").update("ntic-session:" + loadSecret(dataDir, secret)).digest();
  const sign = (data) => crypto.createHmac("sha256", key).update(data).digest("base64url");

  function safeEqual(a, b) {
    const ha = crypto.createHash("sha256").update(String(a)).digest();
    const hb = crypto.createHash("sha256").update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  function issue(res, req, user) {
    const payload = Buffer.from(JSON.stringify({
      u: user.id, v: user.sessionVersion || 1, e: Date.now() + SESSION_HOURS * 3600 * 1000,
    })).toString("base64url");
    res.cookie(COOKIE, payload + "." + sign(payload), {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      maxAge: SESSION_HOURS * 3600 * 1000,
      path: "/",
    });
  }

  function clear(res) {
    res.clearCookie(COOKIE, { path: "/" });
    res.clearCookie("ntic_admin", { path: "/" }); // cookie from the older single-password version
  }

  function readCookie(req) {
    for (const part of (req.headers.cookie || "").split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === COOKIE) return decodeURIComponent(v.join("="));
    }
    return "";
  }

  function currentUser(req) {
    const [payload, sig] = readCookie(req).split(".");
    if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
    let data;
    try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch (e) { return null; }
    if (!data || data.e < Date.now()) return null;
    const user = users.byId(data.u);
    if (!user || !user.active || (user.sessionVersion || 1) !== data.v) return null;
    return user;
  }

  /** Attach req.user on every request. */
  function attach(req, res, next) {
    req.user = currentUser(req);
    next();
  }

  // API calls that change things must carry this header; browsers won't send it cross-site.
  function csrf(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD" && req.get("X-Requested-With") !== "ntic") {
      return res.status(403).json({ error: "Bad request origin." });
    }
    next();
  }

  function requireUserApi(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Please sign in again." });
    if (req.user.mustChangePassword) return res.status(403).json({ error: "Please choose a new password first.", mustChangePassword: true });
    next();
  }

  function requireAdminApi(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "Please sign in again." });
    if (!req.user.isAdmin) return res.status(403).json({ error: "Admins only." });
    if (req.user.mustChangePassword) return res.status(403).json({ error: "Please choose a new password first.", mustChangePassword: true });
    next();
  }

  // Brute-force protection: per IP and per username, within a 15 minute window.
  const WINDOW = 15 * 60 * 1000;
  const buckets = new Map();
  function hits(key) {
    const b = buckets.get(key);
    if (!b || Date.now() - b.first > WINDOW) return 0;
    return b.count;
  }
  function tooManyAttempts(ip, username) {
    return hits("ip:" + ip) >= 30 || hits("user:" + String(username || "").toLowerCase()) >= 10;
  }
  function recordFailure(ip, username) {
    for (const key of ["ip:" + ip, "user:" + String(username || "").toLowerCase()]) {
      const b = buckets.get(key);
      if (!b || Date.now() - b.first > WINDOW) buckets.set(key, { first: Date.now(), count: 1 });
      else b.count++;
    }
    if (buckets.size > 10000) buckets.clear();
  }
  function recordSuccess(ip, username) {
    buckets.delete("user:" + String(username || "").toLowerCase());
  }

  return { issue, clear, attach, csrf, requireUserApi, requireAdminApi, tooManyAttempts, recordFailure, recordSuccess };
}

module.exports = { createAuth };
