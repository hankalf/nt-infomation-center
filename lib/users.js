"use strict";

const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const { JsonFile } = require("./jsonfile");
const { ValidationError, newId, str, bool } = require("./store");

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

// Easy-to-read words for temporary passwords handed out on hire.
const WORDS = [
  "Pallet", "Forklift", "Crate", "Dock", "Bay", "Aisle", "Racking", "Carton", "Tote", "Label",
  "Scanner", "Trolley", "Shelf", "Cargo", "Parcel", "Freight", "Loader", "Ramp", "Depot", "Stock",
  "Order", "Route", "Truck", "Trailer", "Wrap", "Tape", "Box", "Bin", "Picker", "Packer",
  "Amber", "Blue", "Green", "Orange", "Silver", "Copper", "Maple", "Cedar", "River", "Harbor",
  "Summit", "Falcon", "Otter", "Badger", "Comet", "Rocket", "Anchor", "Beacon", "Compass", "Lantern",
  "Pioneer", "Ranger", "Voyager", "Harvest", "Meadow", "Canyon", "Glacier", "Thunder", "Sunrise", "Horizon",
  "Granite", "Timber", "Willow", "Juniper",
];

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

async function verifyPassword(password, stored) {
  if (!stored || typeof password !== "string") return false;
  const [algo, N, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length,
    { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(expected, actual);
}

function tempPassword() {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${pick()}-${pick()}-${crypto.randomInt(1000, 10000)}`;
}

function checkNewPassword(pw) {
  if (typeof pw !== "string" || pw.length < 8) throw new ValidationError("Password must be at least 8 characters.");
  if (pw.length > 200) throw new ValidationError("Password is too long.");
}

function cleanUsername(v) {
  const u = str(v, 40).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(u)) {
    throw new ValidationError("Username must be 2–40 characters: letters, numbers, dots, dashes or underscores.");
  }
  return u;
}

/** Strip secrets before sending a user to the browser. */
function publicUser(u) {
  if (!u) return null;
  const { passwordHash, sessionVersion, ...rest } = u;
  return rest;
}

/**
 * Staff accounts live in users.json (separate from site content so backups of
 * content alone never leak password hashes).
 */
class Users {
  constructor(dataDir) {
    this.file = new JsonFile(path.join(dataDir, "users.json"), { users: [] });
  }

  load() {
    const d = this.file.load();
    d.users = d.users || [];
    return d;
  }

  all() {
    return this.file.get().users;
  }

  byId(id) {
    return this.all().find((u) => u.id === id) || null;
  }

  byUsername(username) {
    const u = String(username || "").trim().toLowerCase();
    return this.all().find((x) => x.username === u) || null;
  }

  activeAdmins(users = this.all()) {
    return users.filter((u) => u.isAdmin && u.active);
  }

  /**
   * Make sure there's always a way in. Creates the "admin" account from
   * ADMIN_PASSWORD on first start (or when RESET_ADMIN_PASSWORD=true).
   */
  async bootstrap({ adminPassword, reset }) {
    const hasAdmin = this.activeAdmins().length > 0;
    if (hasAdmin && !reset) return null;
    if (reset && !adminPassword) {
      console.warn("⚠️  RESET_ADMIN_PASSWORD is set but ADMIN_PASSWORD is empty — nothing reset.");
      return null;
    }
    const password = adminPassword || tempPassword();
    const passwordHash = await hashPassword(password);
    await this.file.update((d) => {
      let admin = d.users.find((u) => u.username === "admin");
      if (!admin) {
        admin = { id: newId(), username: "admin", name: "Administrator", createdAt: new Date().toISOString(),
          onboarding: {}, acks: {}, sessionVersion: 1 };
        d.users.push(admin);
      }
      Object.assign(admin, {
        isAdmin: true, active: true, passwordHash,
        mustChangePassword: !adminPassword,
        sessionVersion: (admin.sessionVersion || 0) + 1,
      });
    });
    if (adminPassword) {
      console.log(reset ? "🔑 Admin password reset from ADMIN_PASSWORD (username: admin)."
        : "🔑 Created admin account (username: admin, password: ADMIN_PASSWORD).");
    } else {
      console.log(`🔑 Created admin account — username: admin   temporary password: ${password}`);
      console.log("   Set ADMIN_PASSWORD in your service variables to choose your own.");
    }
    return password;
  }

  /** Validate employee profile fields. */
  cleanProfile(body, content, existing) {
    const name = str(body.name, 120);
    if (!name) throw new ValidationError("Name is required.");
    const username = cleanUsername(body.username || (existing && existing.username));
    const clash = this.byUsername(username);
    if (clash && (!existing || clash.id !== existing.id)) throw new ValidationError(`Username "${username}" is already taken.`);
    const email = str(body.email, 200);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError("That email address doesn't look right.");
    const startDate = str(body.startDate, 10);
    if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new ValidationError("Start date must be YYYY-MM-DD.");
    const department = str(body.department, 100);
    const role = str(body.role, 100);
    return {
      name,
      username,
      email,
      jobTitle: str(body.jobTitle, 120),
      department: content.departments.includes(department) ? department : "",
      role: content.roles.includes(role) ? role : "",
      startDate,
      isAdmin: bool(body.isAdmin),
      notes: str(body.notes, 1000),
    };
  }

  async create(body, content) {
    const profile = this.cleanProfile(body, content, null);
    const password = tempPassword();
    const user = {
      id: newId(),
      ...profile,
      active: true,
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      sessionVersion: 1,
      createdAt: new Date().toISOString(),
      onboarding: {},
      acks: {},
    };
    await this.file.update((d) => { d.users.push(user); });
    return { user, password };
  }

  async update(id, body, content, actingUser) {
    return this.file.update((d) => {
      const u = d.users.find((x) => x.id === id);
      if (!u) throw Object.assign(new ValidationError("That employee no longer exists."), { status: 404 });
      const profile = this.cleanProfile(body, content, u);
      const active = body.active === undefined ? u.active : bool(body.active);
      if (actingUser && u.id === actingUser.id && (!profile.isAdmin || !active)) {
        throw new ValidationError("You can't remove your own admin access or disable your own account.");
      }
      const next = { ...u, ...profile, active };
      const others = d.users.filter((x) => x.id !== id);
      if (!this.activeAdmins([...others, next]).length) throw new ValidationError("There must be at least one active admin.");
      // Signing out a disabled user straight away
      if (u.active && !active) next.sessionVersion = (u.sessionVersion || 1) + 1;
      Object.assign(u, next);
      return u;
    });
  }

  async remove(id, actingUser) {
    return this.file.update((d) => {
      const u = d.users.find((x) => x.id === id);
      if (!u) return null;
      if (actingUser && u.id === actingUser.id) throw new ValidationError("You can't delete your own account.");
      const rest = d.users.filter((x) => x.id !== id);
      if (!this.activeAdmins(rest).length) throw new ValidationError("There must be at least one active admin.");
      d.users = rest;
      return u;
    });
  }

  /** Give the user a new temporary password (signs them out everywhere). */
  async resetPassword(id) {
    const password = tempPassword();
    const passwordHash = await hashPassword(password);
    const user = await this.file.update((d) => {
      const u = d.users.find((x) => x.id === id);
      if (!u) throw Object.assign(new ValidationError("That employee no longer exists."), { status: 404 });
      Object.assign(u, { passwordHash, mustChangePassword: true, sessionVersion: (u.sessionVersion || 1) + 1 });
      return u;
    });
    return { user, password };
  }

  /** The user choosing their own password. Returns the updated user (new session version). */
  async changePassword(id, current, next) {
    checkNewPassword(next);
    const u = this.byId(id);
    if (!u || !(await verifyPassword(current || "", u.passwordHash))) {
      throw new ValidationError("Your current password isn't right.");
    }
    if (current === next) throw new ValidationError("Choose a new password that's different from the current one.");
    const passwordHash = await hashPassword(next);
    return this.file.update((d) => {
      const x = d.users.find((y) => y.id === id);
      Object.assign(x, { passwordHash, mustChangePassword: false, sessionVersion: (x.sessionVersion || 1) + 1 });
      return x;
    });
  }

  async recordLogin(id) {
    return this.file.update((d) => {
      const u = d.users.find((x) => x.id === id);
      if (u) u.lastLoginAt = new Date().toISOString();
    });
  }

  async setAck(id, resourceId, rev) {
    return this.file.update((d) => {
      const u = d.users.find((x) => x.id === id);
      if (!u) return;
      u.acks = u.acks || {};
      u.acks[resourceId] = { at: new Date().toISOString(), rev };
    });
  }

  async setOnboarding(id, accessId, done, by) {
    return this.file.update((d) => {
      const u = d.users.find((x) => x.id === id);
      if (!u) throw Object.assign(new ValidationError("That employee no longer exists."), { status: 404 });
      u.onboarding = u.onboarding || {};
      if (done) u.onboarding[accessId] = { at: new Date().toISOString(), by };
      else delete u.onboarding[accessId];
      return u;
    });
  }
}

module.exports = { Users, hashPassword, verifyPassword, tempPassword, publicUser, checkNewPassword };
