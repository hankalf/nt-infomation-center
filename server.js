"use strict";

const path = require("path");
const { createApp } = require("./lib/app");

// Config (set these as Railway service variables — see README)
const config = {
  port: Number(process.env.PORT) || 3000,
  dataDir: path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "storage")),
  adminPassword: process.env.ADMIN_PASSWORD || "",
  resetAdminPassword: process.env.RESET_ADMIN_PASSWORD === "true",
  sessionSecret: process.env.SESSION_SECRET || "",
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 50,
  maxRestoreMb: Number(process.env.MAX_RESTORE_MB) || 2048,
};

if (process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATA_DIR) {
  console.warn("⚠️  No Railway Volume attached — uploads, edits and logins will be LOST on every redeploy. " +
    "Add a Volume to this service (mount path /data).");
}

createApp(config).then(({ app, ctx }) => {
  const server = app.listen(config.port, () => {
    console.log(`NT Information Center running on http://localhost:${config.port}`);
    console.log(`Data folder: ${config.dataDir}`);
  });
  const shutdown = () => {
    ctx.stats.flush().finally(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}).catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
