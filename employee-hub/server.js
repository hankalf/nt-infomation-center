"use strict";

const path = require("path");
const { createApp } = require("./lib/app");

// Config (set these as Railway service variables — see README)
const config = {
  port: Number(process.env.PORT) || 3000,
  dataDir: path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "storage")),
  adminPassword: process.env.ADMIN_PASSWORD || "",
  sessionSecret: process.env.SESSION_SECRET || "",
  mondayToken: process.env.MONDAY_API_TOKEN || "",
  mondayCacheSeconds: Number(process.env.MONDAY_CACHE_SECONDS) || 45,
  publicUrl: process.env.PUBLIC_URL || "",
};

if (process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATA_DIR) {
  console.warn("⚠️  No Railway Volume attached — tiles, panels and links will be LOST on every redeploy. " +
    "Add a Volume to this service (mount path /data).");
}
if (!config.adminPassword) console.warn("⚠️  ADMIN_PASSWORD is not set — the admin area is disabled until it is.");
if (!config.mondayToken) console.warn("ℹ️  MONDAY_API_TOKEN is not set — board panels will show as unavailable until it is.");

createApp(config).then(({ app }) => {
  const server = app.listen(config.port, () => {
    console.log(`Employee Hub running on http://localhost:${config.port}`);
    console.log(`Data folder: ${config.dataDir}`);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}).catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
