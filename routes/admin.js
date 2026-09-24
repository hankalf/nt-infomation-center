"use strict";

const fsp = require("fs/promises");
const express = require("express");
const { ValidationError, cleanResource, cleanSettings, cleanAccess, newId, bool } = require("../lib/store");
const { publicUser } = require("../lib/users");
const { checkLinks } = require("../lib/linkcheck");
const { streamBackup, restoreBackup } = require("../lib/backup");
const { titleFromFilename } = require("../lib/uploads");

const MAX_VERSIONS = 10;
const notFound = (msg) => Object.assign(new ValidationError(msg), { status: 404 });

/** Does an item tagged with departments/roles apply to this person? (untagged = everyone) */
function appliesTo(item, person) {
  const d = item.departments || [];
  const r = item.roles || [];
  return (!d.length || d.includes(person.department)) && (!r.length || r.includes(person.role));
}

function adminRouter(ctx) {
  const { store, users, auth, audit, stats, fulltext, uploaders, config } = ctx;
  const router = express.Router();
  router.use(auth.csrf, auth.requireAdminApi);
  router.use(express.json({ limit: "2mb" }));

  const indexFile = (r) => {
    if (r && r.file) fulltext.index(r.id, r.file, store.uploadPath(r.file)).catch(() => {});
  };
  const findResource = (c, id) => {
    const i = c.resources.findIndex((r) => r.id === id);
    if (i < 0) throw notFound("That resource no longer exists.");
    return i;
  };

  // ---------------------------------------------------------------------------
  // Content
  // ---------------------------------------------------------------------------
  router.get("/content", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(store.get());
  });

  router.post("/resources", uploaders.doc.single("file"), async (req, res) => {
    try {
      const created = await store.update((c) => {
        const r = cleanResource(req.body, c);
        if (req.file) {
          r.file = req.file.filename;
          r.originalName = req.file.originalname.slice(0, 200);
          r.url = "/files/" + req.file.filename;
        }
        if (!r.url) throw new ValidationError("Upload a file or enter a web link.");
        const item = { id: newId(), ...r, rev: 1 };
        c.resources.push(item);
        return item;
      });
      indexFile(created);
      audit.log(req.user, "Added resource", created.title);
      res.status(201).json(created);
    } catch (err) {
      if (req.file) await store.removeUpload(req.file.filename);
      throw err;
    }
  });

  // Update. A new file replaces the current one and the old file is kept as a previous version.
  router.put("/resources/:id", uploaders.doc.single("file"), async (req, res) => {
    let dropped = [];
    try {
      const updated = await store.update((c) => {
        const i = findResource(c, req.params.id);
        const prev = c.resources[i];
        const r = cleanResource(req.body, c);
        let versions = (prev.versions || []).slice();
        let rev = prev.rev || 1;
        if (req.file) {
          r.file = req.file.filename;
          r.originalName = req.file.originalname.slice(0, 200);
          r.url = "/files/" + req.file.filename;
        } else if (req.body.keepFile === "true" && prev.file) {
          Object.assign(r, { file: prev.file, url: prev.url, originalName: prev.originalName });
        }
        if (!r.url) throw new ValidationError("Upload a file or enter a web link.");
        if (prev.file && prev.file !== r.file) {
          versions.unshift({ file: prev.file, originalName: prev.originalName || prev.file,
            replacedAt: new Date().toISOString(), replacedBy: req.user.name });
          rev++;
        }
        if (bool(req.body.bumpRev) && r.requiresAck) rev++;
        dropped = versions.slice(MAX_VERSIONS).map((v) => v.file);
        versions = versions.slice(0, MAX_VERSIONS);
        c.resources[i] = { id: prev.id, ...r, rev, ...(versions.length ? { versions } : {}) };
        return c.resources[i];
      });
      for (const f of dropped) await store.removeUpload(f);
      if (req.file) indexFile(updated);
      audit.log(req.user, req.file ? "Replaced file" : "Edited resource", updated.title);
      res.json(updated);
    } catch (err) {
      if (req.file) await store.removeUpload(req.file.filename);
      throw err;
    }
  });

  // Put a previous version back (the current file becomes a previous version).
  router.post("/resources/:id/restore", async (req, res) => {
    const file = String((req.body || {}).file || "");
    const updated = await store.update((c) => {
      const i = findResource(c, req.params.id);
      const r = c.resources[i];
      const v = (r.versions || []).find((x) => x.file === file);
      if (!v) throw notFound("That version no longer exists.");
      const versions = r.versions.filter((x) => x.file !== file);
      if (r.file) {
        versions.unshift({ file: r.file, originalName: r.originalName || r.file,
          replacedAt: new Date().toISOString(), replacedBy: req.user.name });
      }
      Object.assign(r, { file: v.file, originalName: v.originalName, url: "/files/" + v.file,
        versions: versions.slice(0, MAX_VERSIONS), rev: (r.rev || 1) + 1 });
      return r;
    });
    indexFile(updated);
    audit.log(req.user, "Restored previous version", `${updated.title} (${updated.originalName})`);
    res.json(updated);
  });

  router.delete("/resources/:id", async (req, res) => {
    const removed = await store.update((c) => {
      const i = c.resources.findIndex((r) => r.id === req.params.id);
      return i < 0 ? null : c.resources.splice(i, 1)[0];
    });
    if (removed) {
      for (const f of [removed.file, ...(removed.versions || []).map((v) => v.file)]) if (f) await store.removeUpload(f);
      await fulltext.remove(removed.id);
      stats.forget(removed.id);
      audit.log(req.user, "Deleted resource", removed.title);
    }
    res.json({ ok: true });
  });

  router.post("/resources/order", async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
    await store.update((c) => {
      const pos = new Map(ids.map((id, i) => [id, i]));
      c.resources.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
    });
    res.json({ ok: true });
  });

  // Several files at once; each becomes a resource titled from its file name.
  router.post("/resources/bulk", uploaders.bulk.array("files", 30), async (req, res) => {
    const files = req.files || [];
    try {
      if (!files.length) throw new ValidationError("Choose at least one file.");
      const created = await store.update((c) => files.map((f) => {
        const r = cleanResource({ ...req.body, title: titleFromFilename(f.originalname) }, c);
        const item = { id: newId(), ...r, file: f.filename, originalName: f.originalname.slice(0, 200),
          url: "/files/" + f.filename, rev: 1 };
        c.resources.push(item);
        return item;
      }));
      created.forEach(indexFile);
      audit.log(req.user, "Bulk uploaded", `${created.length} file(s): ${created.map((r) => r.title).join(", ")}`.slice(0, 500));
      res.status(201).json(created);
    } catch (err) {
      for (const f of files) await store.removeUpload(f.filename);
      throw err;
    }
  });

  router.post("/linkcheck", async (req, res) => {
    const results = await checkLinks(store.get().resources, { uploadExists: (n) => store.uploadExists(n) });
    audit.log(req.user, "Ran link check", `${results.filter((r) => !r.ok).length} problem(s)`);
    res.json(results);
  });

  // ---------------------------------------------------------------------------
  // Settings, logo, photos
  // ---------------------------------------------------------------------------
  router.put("/settings", async (req, res) => {
    const settings = await store.update((c) => {
      const s = cleanSettings(req.body || {}, c, { fileExists: (n) => store.uploadExists(n) });
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
    store.sweepUploads("photo-").catch(() => {});
    audit.log(req.user, "Updated settings", (req.body && req.body.section) || "");
    res.json(settings);
  });

  router.post("/logo", uploaders.logo.single("logo"), async (req, res) => {
    if (!req.file) throw new ValidationError("Choose an image to upload.");
    let old = null;
    try {
      await store.update((c) => { old = c.logo; c.logo = req.file.filename; });
    } catch (err) {
      await store.removeUpload(req.file.filename);
      throw err;
    }
    if (old) await store.removeUpload(old);
    audit.log(req.user, "Changed logo");
    res.json({ logo: req.file.filename });
  });

  router.delete("/logo", async (req, res) => {
    const old = await store.update((c) => { const prev = c.logo; delete c.logo; return prev; });
    if (old) await store.removeUpload(old);
    audit.log(req.user, "Removed logo");
    res.json({ ok: true });
  });

  // Uploaded now, attached to a person when the People list is saved.
  router.post("/photo", uploaders.photo.single("photo"), (req, res) => {
    if (!req.file) throw new ValidationError("Choose a photo to upload.");
    res.json({ photo: req.file.filename });
  });

  // ---------------------------------------------------------------------------
  // Access checklist items
  // ---------------------------------------------------------------------------
  router.post("/access", async (req, res) => {
    const item = await store.update((c) => {
      const a = { id: newId(), ...cleanAccess(req.body || {}, c) };
      c.access.push(a);
      return a;
    });
    audit.log(req.user, "Added access item", item.name);
    res.status(201).json(item);
  });

  router.put("/access/:id", async (req, res) => {
    const item = await store.update((c) => {
      const i = c.access.findIndex((a) => a.id === req.params.id);
      if (i < 0) throw notFound("That item no longer exists.");
      c.access[i] = { id: c.access[i].id, ...cleanAccess(req.body || {}, c) };
      return c.access[i];
    });
    audit.log(req.user, "Edited access item", item.name);
    res.json(item);
  });

  router.delete("/access/:id", async (req, res) => {
    const removed = await store.update((c) => {
      const a = c.access.find((x) => x.id === req.params.id);
      c.access = c.access.filter((x) => x.id !== req.params.id);
      return a;
    });
    if (removed) audit.log(req.user, "Deleted access item", removed.name);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Employees (staff logins)
  // ---------------------------------------------------------------------------
  router.get("/employees", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(users.all().map(publicUser));
  });

  router.post("/employees", async (req, res) => {
    const { user, password } = await users.create(req.body || {}, store.get());
    audit.log(req.user, "Created login", `${user.name} (${user.username})${user.isAdmin ? " — admin" : ""}`);
    res.status(201).json({ user: publicUser(user), password });
  });

  router.put("/employees/:id", async (req, res) => {
    const before = users.byId(req.params.id);
    const user = await users.update(req.params.id, req.body || {}, store.get(), req.user);
    const changes = [];
    if (before && before.active !== user.active) changes.push(user.active ? "re-enabled" : "disabled");
    if (before && before.isAdmin !== user.isAdmin) changes.push(user.isAdmin ? "made admin" : "admin removed");
    audit.log(req.user, "Updated employee", `${user.name}${changes.length ? " — " + changes.join(", ") : ""}`);
    res.json(publicUser(user));
  });

  router.post("/employees/:id/reset-password", async (req, res) => {
    const { user, password } = await users.resetPassword(req.params.id);
    audit.log(req.user, "Reset password", user.name);
    res.json({ user: publicUser(user), password });
  });

  router.delete("/employees/:id", async (req, res) => {
    const removed = await users.remove(req.params.id, req.user);
    if (removed) audit.log(req.user, "Deleted login", `${removed.name} (${removed.username})`);
    res.json({ ok: true });
  });

  router.put("/employees/:id/onboarding/:accessId", async (req, res) => {
    const item = store.get().access.find((a) => a.id === req.params.accessId);
    if (!item) throw notFound("That access item no longer exists.");
    const done = bool((req.body || {}).done);
    const user = await users.setOnboarding(req.params.id, item.id, done, req.user.name);
    audit.log(req.user, done ? "Access granted" : "Access un-ticked", `${item.name} → ${user.name}`);
    res.json(publicUser(user));
  });

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  router.get("/dashboard", async (req, res) => {
    const c = store.get();
    const now = Date.now();
    const months = c.settings.reviewMonths || 12;
    const dueAt = (r) => {
      const d = new Date(r.updated + "T00:00:00");
      d.setMonth(d.getMonth() + months);
      return d.getTime();
    };
    const brief = (r) => ({ id: r.id, title: r.title, owner: r.owner || "", updated: r.updated || "", category: r.category });
    const docs = c.resources.filter((r) => r.file || r.type === "sop");
    const overdue = docs.filter((r) => r.updated && dueAt(r) < now).map(brief);
    const dueSoon = docs.filter((r) => r.updated && dueAt(r) >= now && dueAt(r) < now + 30 * 86400000).map(brief);
    const noDate = docs.filter((r) => !r.updated).map(brief);

    const s = stats.get();
    const withViews = c.resources.map((r) => ({ ...brief(r), views: (s[r.id] || {}).count || 0, last: (s[r.id] || {}).last || "" }));
    const top = withViews.filter((r) => r.views).sort((a, b) => b.views - a.views).slice(0, 8);
    const ninety = now - 90 * 86400000;
    const unused = withViews.filter((r) => !r.last || new Date(r.last).getTime() < ninety).slice(0, 20);

    const staff = users.all().filter((u) => u.active);
    const reading = c.resources.filter((r) => r.requiresAck).map((r) => {
      const audience = staff.filter((u) => appliesTo(r, u));
      const outstanding = audience.filter((u) => !(u.acks && u.acks[r.id] && u.acks[r.id].rev === (r.rev || 1)));
      return { id: r.id, title: r.title, total: audience.length, read: audience.length - outstanding.length,
        outstanding: outstanding.map((u) => u.name) };
    });
    const onboarding = staff.filter((u) => !u.isAdmin || u.department || u.role).map((u) => {
      const items = c.access.filter((a) => appliesTo(a, u));
      const done = items.filter((a) => u.onboarding && u.onboarding[a.id]).length;
      return { id: u.id, name: u.name, startDate: u.startDate || "", done, total: items.length };
    }).filter((x) => x.done < x.total);

    res.json({
      counts: {
        resources: c.resources.length, files: c.resources.filter((r) => r.file).length,
        employees: staff.length, people: c.people.length, access: c.access.length,
      },
      reviewMonths: months, overdue, dueSoon, noDate, top, unused, reading, onboarding,
      pendingPasswords: staff.filter((u) => u.mustChangePassword).map((u) => u.name),
      activity: await audit.recent(10),
    });
  });

  // ---------------------------------------------------------------------------
  // Activity log
  // ---------------------------------------------------------------------------
  router.get("/activity", async (req, res) => {
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 500));
    res.json(await audit.recent(limit));
  });

  router.get("/activity.csv", async (req, res) => {
    const rows = await audit.recent(50000);
    const cell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
    const csv = ["When,User,Name,Action,Detail", ...rows.map((r) => [r.at, r.user, r.name, r.action, r.detail].map(cell).join(","))].join("\r\n");
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="activity-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send("﻿" + csv);
  });

  // ---------------------------------------------------------------------------
  // Backup & restore
  // ---------------------------------------------------------------------------
  router.get("/backup", async (req, res) => {
    await stats.flush();
    await audit.log(req.user, "Downloaded backup"); // written before the log is zipped
    const name = `nt-information-center-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    res.set("Content-Type", "application/zip");
    res.set("Content-Disposition", `attachment; filename="${name}"`);
    await streamBackup(config.dataDir, res);
  });

  router.post("/restore", uploaders.restore.single("backup"), async (req, res) => {
    if (!req.file) throw new ValidationError("Choose a backup .zip file.");
    ctx.restoring = true;
    try {
      const summary = await restoreBackup(config.dataDir, req.file.path, {
        maxBytes: config.maxRestoreMb * 1048576 * 3,
        validateUsers: (data) => {
          const list = (data && data.users) || [];
          if (!list.some((u) => u.isAdmin && u.active && u.passwordHash)) {
            throw new ValidationError("The backup's user list has no active admin — restoring it would lock everyone out.");
          }
        },
      });
      ctx.reload();
      audit.log(req.user, "Restored backup",
        `${summary.files} file(s)${summary.users ? ", including logins" : ""}. Previous data kept in ${summary.safetyCopy}`);
      res.json(summary);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw new ValidationError(err.message);
      throw err;
    } finally {
      ctx.restoring = false;
      await fsp.unlink(req.file.path).catch(() => {});
    }
  });

  return router;
}

module.exports = { adminRouter, appliesTo };
