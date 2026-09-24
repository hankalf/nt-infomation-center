"use strict";

const crypto = require("crypto");

const COOKIE = "ntic_admin";
const SESSION_HOURS = 12;

/**
 * Minimal single-password admin auth using an HMAC-signed, HttpOnly cookie.
 * The signing key is derived from SESSION_SECRET (or the admin password), so
 * changing ADMIN_PASSWORD signs everybody out.
 */
function createAuth({ password, secret }) {
  const key = crypto.createHash("sha256")
    .update("ntic-session:" + (secret || "") + ":" + (password || ""))
    .digest();

  const sign = (data) => crypto.createHmac("sha256", key).update(data).digest("base64url");

  function safeEqual(a, b) {
    const ha = crypto.createHash("sha256").update(String(a)).digest();
    const hb = crypto.createHash("sha256").update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  function checkPassword(input) {
    return Boolean(password) && safeEqual(input || "", password);
  }

  function issue(res, req) {
    const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
    const payload = String(expires);
    res.cookie(COOKIE, payload + "." + sign(payload), {
      httpOnly: true,
      sameSite: "strict",
      secure: req.secure,
      maxAge: SESSION_HOURS * 3600 * 1000,
      path: "/",
    });
  }

  function clear(res) {
    res.clearCookie(COOKIE, { path: "/" });
  }

  function readCookie(req) {
    const header = req.headers.cookie || "";
    for (const part of header.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === COOKIE) return decodeURIComponent(v.join("="));
    }
    return "";
  }

  function isAuthed(req) {
    if (!password) return false;
    const token = readCookie(req);
    const [payload, sig] = token.split(".");
    if (!payload || !sig || !safeEqual(sig, sign(payload))) return false;
    return Number(payload) > Date.now();
  }

  /** Guard for admin API routes. Also requires a custom header as CSRF defence. */
  function requireAdmin(req, res, next) {
    if (!isAuthed(req)) return res.status(401).json({ error: "Please sign in again." });
    if (req.method !== "GET" && req.get("X-Requested-With") !== "ntic-admin") {
      return res.status(403).json({ error: "Bad request origin." });
    }
    next();
  }

  // Simple in-memory brute-force protection: 10 failed attempts per IP per 15 minutes.
  const attempts = new Map();
  const WINDOW = 15 * 60 * 1000;
  function tooManyAttempts(ip) {
    const now = Date.now();
    const a = attempts.get(ip);
    if (!a || now - a.first > WINDOW) return false;
    return a.count >= 10;
  }
  function recordFailure(ip) {
    const now = Date.now();
    const a = attempts.get(ip);
    if (!a || now - a.first > WINDOW) attempts.set(ip, { first: now, count: 1 });
    else a.count++;
    if (attempts.size > 5000) attempts.clear();
  }
  function recordSuccess(ip) {
    attempts.delete(ip);
  }

  return { checkPassword, issue, clear, isAuthed, requireAdmin, tooManyAttempts, recordFailure, recordSuccess };
}

module.exports = { createAuth };
