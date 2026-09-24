"use strict";

/**
 * Checks every resource link. Uploaded files are checked on disk; web links
 * are requested with a short timeout. mailto: and file:// links can't be
 * checked from the server and are reported as "skipped".
 */
async function checkLinks(resources, { uploadExists, timeoutMs = 8000, concurrency = 5 } = {}) {
  const results = [];
  const queue = resources.slice();

  async function check(r) {
    const url = String(r.url || "");
    if (r.file || url.startsWith("/files/")) {
      const name = r.file || decodeURIComponent(url.slice(7));
      return uploadExists(name) ? { ok: true, status: "file" } : { ok: false, status: "missing file" };
    }
    if (!/^https?:\/\//i.test(url)) return { ok: true, skipped: true, status: "not checked" };
    const attempt = async (method) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(url, { method, redirect: "follow", signal: ctrl.signal,
          headers: { "User-Agent": "NT-Information-Center link checker" } });
      } finally {
        clearTimeout(t);
      }
    };
    try {
      let res = await attempt("HEAD");
      // Some sites don't support HEAD; try a normal GET before calling it broken.
      if (res.status >= 400) res = await attempt("GET");
      // 401/403 usually means "needs a login" (e.g. an intranet system) — the link itself is fine.
      if ([401, 403].includes(res.status)) return { ok: true, status: `${res.status} (login required)` };
      return { ok: res.status < 400, status: String(res.status) };
    } catch (err) {
      return { ok: false, status: err.name === "AbortError" ? "timed out" : "unreachable" };
    }
  }

  async function worker() {
    while (queue.length) {
      const r = queue.shift();
      results.push({ id: r.id, title: r.title, url: r.url, ...(await check(r)) });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

module.exports = { checkLinks };
