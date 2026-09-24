"use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const { Store, ValidationError, cleanResource, cleanSettings, cleanAccess, newId, slug } = require("./lib/store");
const { createAuth } = require("./lib/auth");

// ---------------------------------------------------------------------------
// Config (set these as Railway service variables)
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(
  process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "storage"));
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 50;

if (!ADMIN_PASSWORD) {
  console.warn("⚠️  ADMIN_PASSWORD is not set — the admin page is disabled until you set it.");
}
if (process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATA_DIR) {
  console.warn("⚠️  No Railway Volume attached — uploads and edits will be LOST on every redeploy. " +
    "Add a Volume to this service (mount path /data).");
}

const store = new Store(DATA_DIR);
store.init();

const auth = createAuth({ password: ADMIN_PASSWORD, secret: process.env.SESSION_SECRET });

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------
const ALLOWED_EXT = new Set([
  "pdf", "doc", "docx", "dotx", "rtf", "odt", "txt",
  "xls", "xlsx", "xlsm", "xlsb", "xltm", "xltx", "xlam", "csv", "ods",
  "ppt", "pptx", "ppsx", "odp",
  "png", "jpg", "jpeg", "gif", "webp",
  "mp4", "mov", "webm",
  "zip", "msg", "eml", "vsdx", "bas",
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, store.uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(1).toLowerCase();
      const base = slug(path.basename(file.originalname, path.extname(file.originalname))) || "file";
      cb(null, `${base}-${newId().slice(0, 6)}.${ext}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (ALLOWED_EXT.has(ext)) return cb(null, true);
    cb(new ValidationError(`.${ext || "?"} files aren't allowed. Allowed: ${[...ALLOWED_EXT].join(", ")}`));
  },
});

const LOGO_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, store.uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(1).toLowerCase();
      cb(null, `logo-${newId().slice(0, 6)}.${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    if (LOGO_EXT.has(ext)) return cb(null, true);
    cb(new ValidationError("The logo must be an image: PNG, JPG, GIF, WebP or SVG."));
  },
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.set("trust proxy", 1); // Railway terminates HTTPS in front of us
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
  });
  next();
});

app.get("/healthz", (req, res) => res.send("ok"));

// ----- Public ---------------------------------------------------------------
app.get("/api/content", (req, res) => {
  res.set("Cache-Control", "no-cache");
  // The access checklist (system names, folder paths) is admin-only.
  const { access, ...publicContent } = store.get();
  res.json(publicContent);
});

app.get("/files/:name", (req, res) => {
  const p = store.uploadPath(req.params.name);
  if (!p) return res.status(404).send("Not found");
  const ext = path.extname(p).slice(1).toLowerCase();
  const inline = ["pdf", "svg", "png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "mov", "txt"].includes(ext);
  res.set("Content-Security-Policy", "sandbox");
  const opts = { maxAge: "1h", dotfiles: "deny" };
  if (inline) return res.sendFile(p, opts, (err) => err && !res.headersSent && res.status(404).send("Not found"));
  res.download(p, req.params.name, opts, (err) => err && !res.headersSent && res.status(404).send("Not found"));
});

// ----- Admin pages ----------------------------------------------------------
const PUBLIC = path.join(__dirname, "public");
const VIEWS = path.join(__dirname, "views");

app.get("/admin", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(VIEWS, auth.isAuthed(req) ? "admin.html" : "login.html"));
});

app.post("/admin/login", express.urlencoded({ extended: false, limit: "10kb" }), (req, res) => {
  const ip = req.ip;
  if (!ADMIN_PASSWORD) return res.redirect("/admin?error=disabled");
  if (auth.tooManyAttempts(ip)) return res.redirect("/admin?error=locked");
  if (!auth.checkPassword(req.body && req.body.password)) {
    auth.recordFailure(ip);
    return res.redirect("/admin?error=wrong");
  }
  auth.recordSuccess(ip);
  auth.issue(res, req);
  res.redirect("/admin");
});

app.post("/admin/logout", (req, res) => {
  auth.clear(res);
  res.redirect("/");
});

// ----- Admin API ------------------------------------------------------------
const admin = express.Router();
admin.use(auth.requireAdmin);
admin.use(express.json({ limit: "1mb" }));

// Create a resource (multipart form: fields + optional "file")
admin.post("/resources", upload.single("file"), async (req, res) => {
  try {
    const created = await store.update((c) => {
      const r = cleanResource(req.body, c);
      if (req.file) {
        r.file = req.file.filename;
        r.url = "/files/" + req.file.filename;
      }
      if (!r.url) throw new ValidationError("Upload a file or enter a web link.");
      const item = { id: newId(), ...r };
      c.resources.push(item);
      return item;
    });
    res.status(201).json(created);
  } catch (err) {
    if (req.file) await store.removeUpload(req.file.filename);
    throw err;
  }
});

// Update a resource. If a new file is uploaded it replaces the old one.
admin.put("/resources/:id", upload.single("file"), async (req, res) => {
  let oldFile = null;
  try {
    const updated = await store.update((c) => {
      const i = c.resources.findIndex((r) => r.id === req.params.id);
      if (i < 0) throw Object.assign(new ValidationError("That resource no longer exists."), { status: 404 });
      const prev = c.resources[i];
      const r = cleanResource(req.body, c);
      if (req.file) {
        r.file = req.file.filename;
        r.url = "/files/" + req.file.filename;
      } else if (req.body.keepFile === "true" && prev.file) {
        r.file = prev.file;
        r.url = prev.url;
      }
      if (!r.url) throw new ValidationError("Upload a file or enter a web link.");
      if (prev.file && prev.file !== r.file) oldFile = prev.file;
      c.resources[i] = { id: prev.id, ...r };
      return c.resources[i];
    });
    if (oldFile) await store.removeUpload(oldFile);
    res.json(updated);
  } catch (err) {
    if (req.file) await store.removeUpload(req.file.filename);
    throw err;
  }
});

admin.delete("/resources/:id", async (req, res) => {
  const removed = await store.update((c) => {
    const i = c.resources.findIndex((r) => r.id === req.params.id);
    if (i < 0) return null;
    return c.resources.splice(i, 1)[0];
  });
  if (removed && removed.file) await store.removeUpload(removed.file);
  res.json({ ok: true });
});

// Reorder: body { ids: [...] } in the new order
admin.post("/resources/order", async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
  await store.update((c) => {
    const pos = new Map(ids.map((id, i) => [id, i]));
    c.resources.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  });
  res.json({ ok: true });
});

admin.put("/settings", async (req, res) => {
  const settings = await store.update((c) => {
    const s = cleanSettings(req.body || {}, c);
    Object.assign(c, s);
    // Drop role / department tags that no longer exist
    [...c.resources, ...c.access].forEach((item) => {
      for (const [key, allowed] of [["roles", s.roles], ["departments", s.departments]]) {
        if (!item[key]) continue;
        item[key] = item[key].filter((x) => allowed.includes(x));
        if (!item[key].length) delete item[key];
      }
    });
    return s;
  });
  res.json(settings);
});

admin.get("/content", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(store.get());
});

// ----- Access checklist items (admin only) -----
admin.post("/access", async (req, res) => {
  const item = await store.update((c) => {
    const a = { id: newId(), ...cleanAccess(req.body || {}, c) };
    c.access.push(a);
    return a;
  });
  res.status(201).json(item);
});

admin.put("/access/:id", async (req, res) => {
  const item = await store.update((c) => {
    const i = c.access.findIndex((a) => a.id === req.params.id);
    if (i < 0) throw Object.assign(new ValidationError("That item no longer exists."), { status: 404 });
    c.access[i] = { id: c.access[i].id, ...cleanAccess(req.body || {}, c) };
    return c.access[i];
  });
  res.json(item);
});

admin.delete("/access/:id", async (req, res) => {
  await store.update((c) => {
    c.access = c.access.filter((a) => a.id !== req.params.id);
  });
  res.json({ ok: true });
});

// Logo: upload replaces the current one; DELETE removes it.
admin.post("/logo", logoUpload.single("logo"), async (req, res) => {
  if (!req.file) throw new ValidationError("Choose an image to upload.");
  let old = null;
  try {
    await store.update((c) => {
      old = c.logo;
      c.logo = req.file.filename;
    });
  } catch (err) {
    await store.removeUpload(req.file.filename);
    throw err;
  }
  if (old) await store.removeUpload(old);
  res.json({ logo: req.file.filename });
});

admin.delete("/logo", async (req, res) => {
  const old = await store.update((c) => {
    const prev = c.logo;
    delete c.logo;
    return prev;
  });
  if (old) await store.removeUpload(old);
  res.json({ ok: true });
});

app.use("/api/admin", admin);

// ----- Static front end -----------------------------------------------------
app.use(express.static(PUBLIC, { index: "index.html", extensions: ["html"] }));

// ----- Errors ---------------------------------------------------------------
app.use((err, req, res, next) => {
  if (err instanceof ValidationError) return res.status(err.status || 400).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    const max = req.path.endsWith("/logo") ? 5 : MAX_UPLOAD_MB;
    const msg = err.code === "LIMIT_FILE_SIZE" ? `File is too big (max ${max} MB).` : err.message;
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  console.log(`NT Information Center running on http://localhost:${PORT}`);
  console.log(`Data folder: ${DATA_DIR}`);
});
