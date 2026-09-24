"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const archiver = require("archiver");
const yauzl = require("yauzl");

const DATA_FILES = ["content.json", "users.json", "stats.json", "activity.log"];

/** Stream a zip of all site data (content, accounts, stats, activity, uploads) to `res`. */
function streamBackup(dataDir, res) {
  const zip = archiver("zip", { zlib: { level: 6 } });
  zip.on("warning", (err) => console.warn("Backup warning:", err.message));
  zip.on("error", (err) => { console.error("Backup failed:", err); res.destroy(err); });
  zip.pipe(res);
  zip.append(JSON.stringify({ app: "nt-information-center", createdAt: new Date().toISOString() }, null, 2),
    { name: "backup-info.json" });
  for (const f of DATA_FILES) {
    const p = path.join(dataDir, f);
    if (fs.existsSync(p)) zip.file(p, { name: f });
  }
  const uploads = path.join(dataDir, "uploads");
  if (fs.existsSync(uploads)) {
    for (const name of fs.readdirSync(uploads)) {
      const p = path.join(uploads, name);
      if (!name.startsWith(".") && fs.statSync(p).isFile()) zip.file(p, { name: "uploads/" + name });
    }
  }
  return zip.finalize();
}

/** Only these paths are ever written from a backup zip. */
function allowedEntry(name) {
  if (DATA_FILES.includes(name)) return name;
  const m = /^uploads\/([^/\\]+)$/.exec(name);
  if (m && m[1] === path.basename(m[1]) && !m[1].startsWith(".")) return name;
  return null;
}

function extractZip(zipPath, destDir, maxBytes) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err) return reject(new Error("That file isn't a valid backup zip."));
      let total = 0;
      const written = [];
      zip.on("error", reject);
      zip.on("end", () => resolve(written));
      zip.on("entry", (entry) => {
        const name = allowedEntry(entry.fileName);
        if (!name || /\/$/.test(entry.fileName)) return zip.readEntry();
        total += entry.uncompressedSize;
        if (total > maxBytes) {
          zip.close();
          return reject(new Error("The backup is too big to restore."));
        }
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const out = path.join(destDir, name);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          const ws = fs.createWriteStream(out);
          stream.pipe(ws);
          ws.on("finish", () => { written.push(name); zip.readEntry(); });
          ws.on("error", reject);
        });
      });
      zip.readEntry();
    });
  });
}

/**
 * Restore from a backup zip. The current data is moved to DATA_DIR/before-restore-<time>
 * first, so a bad restore can be undone by hand. Returns a summary.
 */
async function restoreBackup(dataDir, zipPath, { maxBytes, validateUsers }) {
  const staging = path.join(dataDir, "restore-staging");
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });
  try {
    const written = await extractZip(zipPath, staging, maxBytes);
    if (!written.includes("content.json")) throw new Error("That zip doesn't contain content.json — is it a backup from this site?");
    const content = JSON.parse(await fsp.readFile(path.join(staging, "content.json"), "utf8"));
    if (!content || !Array.isArray(content.resources)) throw new Error("content.json in the backup isn't valid.");
    const hasUsers = written.includes("users.json");
    if (hasUsers) validateUsers(JSON.parse(await fsp.readFile(path.join(staging, "users.json"), "utf8")));

    // Keep what's there now
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safety = path.join(dataDir, "before-restore-" + stamp);
    await fsp.mkdir(safety);
    for (const f of [...DATA_FILES, "uploads"]) {
      const src = path.join(dataDir, f);
      const fromBackup = f === "uploads" || written.includes(f);
      if (fs.existsSync(src) && fromBackup) await fsp.rename(src, path.join(safety, f));
    }
    for (const f of DATA_FILES) {
      if (written.includes(f)) await fsp.rename(path.join(staging, f), path.join(dataDir, f));
    }
    const up = path.join(staging, "uploads");
    if (fs.existsSync(up)) await fsp.rename(up, path.join(dataDir, "uploads"));
    else await fsp.mkdir(path.join(dataDir, "uploads"), { recursive: true });

    // Only keep the two most recent safety copies
    const old = (await fsp.readdir(dataDir)).filter((n) => n.startsWith("before-restore-")).sort().reverse();
    for (const n of old.slice(2)) await fsp.rm(path.join(dataDir, n), { recursive: true, force: true });

    return {
      files: written.filter((n) => n.startsWith("uploads/")).length,
      users: hasUsers,
      safetyCopy: path.basename(safety),
    };
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

module.exports = { streamBackup, restoreBackup };
