"use strict";

/**
 * Link helpers. Tiles and quick links point at monday.com forms, monday boards,
 * or any other website. We normalise what admins paste and work out whether a
 * link can be shown inside the hub (in an iframe) or must open in a new tab.
 */

const MAX_URL = 2000;

/** Clean up a pasted address. Adds https:// when missing. Throws on anything that isn't a web address. */
function normalizeUrl(input, { allowEmpty = false } = {}) {
  let s = String(input == null ? "" : input).trim();
  if (!s) {
    if (allowEmpty) return "";
    throw new Error("Please enter a link.");
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch (e) { throw new Error("That link doesn't look like a web address."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Links must start with http:// or https://");
  if (!u.hostname.includes(".") && u.hostname !== "localhost") throw new Error("That link doesn't look like a web address.");
  if (u.href.length > MAX_URL) throw new Error(`Links can be at most ${MAX_URL} characters.`);
  return u.href;
}

const FORM_RE = /^\/forms\/(embed\/)?([A-Za-z0-9_-]+)\/?$/;
const VIEW_RE = /^\/(embed\/)?(\d+-[A-Za-z0-9_-]+)\/?$/;

/**
 * What kind of link is this, and which address should go in an iframe?
 *   form          monday.com WorkForm share link  → embeddable (we switch to the /forms/embed/ address)
 *   public-board  monday.com "share board publicly" link (view.monday.com) → embeddable
 *   monday        a board/dashboard/doc inside a monday account → needs a monday login, open in a new tab
 *   web           anything else → may or may not allow embedding; the admin decides
 */
function describeLink(url) {
  let u;
  try { u = new URL(url); } catch (e) { return { kind: "web", embedUrl: url, host: "" }; }
  const host = u.hostname.toLowerCase();
  if (host === "forms.monday.com") {
    const m = FORM_RE.exec(u.pathname);
    if (m) {
      const embed = new URL(u.href);
      embed.pathname = `/forms/embed/${m[2]}`;
      return { kind: "form", embedUrl: embed.href, host, formId: m[2] };
    }
  }
  if (host === "view.monday.com") {
    const m = VIEW_RE.exec(u.pathname);
    if (m) {
      const embed = new URL(u.href);
      embed.pathname = `/embed/${m[2]}`;
      return { kind: "public-board", embedUrl: embed.href, host };
    }
  }
  if (host === "monday.com" || host.endsWith(".monday.com")) {
    return { kind: "monday", embedUrl: u.href, host, boardId: boardIdFromUrl(u.href) };
  }
  return { kind: "web", embedUrl: u.href, host };
}

/** "https://acme.monday.com/boards/1234567890/views/55" → "1234567890". Also accepts a bare number. */
function boardIdFromUrl(input) {
  const s = String(input || "").trim();
  if (/^\d{3,20}$/.test(s)) return s;
  const m = /\/boards\/(\d+)/.exec(s);
  return m ? m[1] : "";
}

module.exports = { normalizeUrl, describeLink, boardIdFromUrl, MAX_URL };
