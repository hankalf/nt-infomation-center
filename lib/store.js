"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const SEED_DIR = path.join(__dirname, "..", "seed");

const TYPES = ["sop", "pdf", "word", "excel", "macro", "powerpoint", "website", "video", "form", "image", "other"];

/**
 * Content is kept in a single JSON file (content.json) inside DATA_DIR, with
 * uploaded documents in DATA_DIR/uploads. On Railway, DATA_DIR should be a
 * mounted Volume so both survive redeploys.
 */
class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.contentPath = path.join(dataDir, "content.json");
    this.uploadsDir = path.join(dataDir, "uploads");
    this.content = null;
    this.queue = Promise.resolve();
  }

  init() {
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    if (!fs.existsSync(this.contentPath)) {
      // First run: copy the example content and files in.
      fs.copyFileSync(path.join(SEED_DIR, "content.json"), this.contentPath);
      const seedFiles = path.join(SEED_DIR, "files");
      for (const name of fs.readdirSync(seedFiles)) {
        const dest = path.join(this.uploadsDir, name);
        if (!fs.existsSync(dest)) fs.copyFileSync(path.join(seedFiles, name), dest);
      }
      console.log(`Seeded example content into ${this.dataDir}`);
    }
    this.content = JSON.parse(fs.readFileSync(this.contentPath, "utf8"));
    this.content.resources = this.content.resources || [];
    this.content.categories = this.content.categories || [];
    this.content.roles = this.content.roles || [];
    this.content.contacts = this.content.contacts || [];
  }

  get() {
    return this.content;
  }

  /** Apply a change and persist it. Writes are serialised and atomic. */
  update(mutator) {
    const run = async () => {
      const draft = structuredClone(this.content);
      const result = await mutator(draft);
      const tmp = this.contentPath + "." + process.pid + ".tmp";
      await fsp.writeFile(tmp, JSON.stringify(draft, null, 2) + "\n");
      await fsp.rename(tmp, this.contentPath);
      this.content = draft;
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  uploadPath(name) {
    // Only ever resolve plain file names inside the uploads folder.
    if (!name || name !== path.basename(name) || name.startsWith(".")) return null;
    return path.join(this.uploadsDir, name);
  }

  async removeUpload(name) {
    const p = this.uploadPath(name);
    if (!p) return;
    const stillUsed = this.content.resources.some((r) => r.file === name);
    if (stillUsed) return;
    await fsp.unlink(p).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

class ValidationError extends Error {}

function str(v, max = 500) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

function list(v, max = 50) {
  if (v == null || v === "") return [];
  const arr = Array.isArray(v) ? v : String(v).split(",");
  return [...new Set(arr.map((x) => str(x, 100)).filter(Boolean))].slice(0, max);
}

function bool(v) {
  return v === true || v === "true" || v === "on" || v === "1";
}

function safeUrl(v) {
  const url = str(v, 2000);
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (/^(https?:|mailto:|file:)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    throw new ValidationError("Links must start with http://, https://, mailto: or file://");
  }
  // Bare domain like "wms.company.com" — assume https.
  return "https://" + url;
}

function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function newId() {
  return crypto.randomBytes(6).toString("hex");
}

/** Build a clean resource object from submitted form fields. */
function cleanResource(body, content) {
  const title = str(body.title, 200);
  if (!title) throw new ValidationError("Title is required.");
  const category = str(body.category, 60);
  if (!content.categories.some((c) => c.id === category)) {
    throw new ValidationError("Please choose a valid section.");
  }
  const type = str(body.type, 20);
  if (type && !TYPES.includes(type)) throw new ValidationError("Unknown type.");
  const roles = list(body.roles).filter((r) => content.roles.includes(r));
  const updated = str(body.updated, 10);
  if (updated && !/^\d{4}-\d{2}-\d{2}$/.test(updated)) throw new ValidationError("Date must be YYYY-MM-DD.");

  const r = {
    title,
    description: str(body.description, 1000),
    url: safeUrl(body.url),
    type,
    category,
    roles,
    tags: list(body.tags),
    owner: str(body.owner, 120),
    updated,
    newStarter: bool(body.newStarter),
    pinned: bool(body.pinned),
  };
  // Drop empty optional fields to keep the JSON tidy
  for (const k of Object.keys(r)) {
    if (r[k] === "" || r[k] === false || (Array.isArray(r[k]) && !r[k].length)) delete r[k];
  }
  return r;
}

function cleanSettings(body, content) {
  const siteName = str(body.siteName, 120) || "Information Center";
  const tagline = str(body.tagline, 300);
  const roles = list(body.roles, 100);

  const seen = new Set();
  const categories = (Array.isArray(body.categories) ? body.categories : []).map((c) => {
    const name = str(c && c.name, 80);
    if (!name) throw new ValidationError("Every section needs a name.");
    let id = str(c.id, 60) || slug(name) || newId();
    while (seen.has(id)) id = id + "-" + newId().slice(0, 3);
    seen.add(id);
    return { id, name, icon: str(c.icon, 16), description: str(c.description, 300) };
  });
  if (!categories.length) throw new ValidationError("You need at least one section.");

  const contacts = (Array.isArray(body.contacts) ? body.contacts : [])
    .map((c) => ({
      name: str(c && c.name, 120),
      role: str(c && c.role, 200),
      phone: str(c && c.phone, 60),
      email: str(c && c.email, 200),
    }))
    .filter((c) => c.name);

  const inUse = new Set(content.resources.map((r) => r.category));
  const missing = [...inUse].filter((id) => !seen.has(id));
  if (missing.length) {
    const names = content.categories.filter((c) => missing.includes(c.id)).map((c) => c.name);
    throw new ValidationError(
      `Can't remove section(s) still holding resources: ${names.join(", ")}. Move or delete those resources first.`);
  }

  return { siteName, tagline, roles, categories, contacts };
}

module.exports = { Store, ValidationError, cleanResource, cleanSettings, newId, slug, TYPES };
