# NT Information Center

A one-stop website for the warehouse office. It collects SOPs, PDFs, Word documents, Excel trackers, macros, websites, contacts and an org chart in one place, so a new starter can find everything about their role and processes. Each member of staff has their own login.

- **Home page** (`/`): for signed-in staff. It has search (including the text *inside* PDFs and Office documents), Department, Role and type filters, announcements, required reading, a New Starter checklist, Quick Links, favourites, "Who to Ask" and an org chart.
- **My account** (`/account`): change password, see your details, required reading status and which systems and folders have been set up for you.
- **Admin** (`/admin`): for admins only. See [Using the admin area](#using-the-admin-area).

Built with Node.js and Express. Everything is stored in JSON files plus an uploads folder, so no database is needed.

---

## Deploying on Railway

1. **Create the service.** In Railway, go to *New Project → Deploy from GitHub repo* and pick this repository. Railway detects Node and runs `npm start`.
2. **Add a Volume.** This step matters: without a Volume, uploads, edits and logins are wiped on every redeploy.
   Right-click the service → *Attach Volume* → mount path **`/data`**. The app finds it automatically.
3. **Set variables.** Go to the service → *Variables*:

   | Variable | Required | What it does |
   |---|---|---|
   | `ADMIN_PASSWORD` | ✅ first time | Password for the built-in **`admin`** account, which is created on first start. After that you can change it from *My account*. |
   | `RESET_ADMIN_PASSWORD` | emergency only | Set to `true` and redeploy to reset the `admin` account's password back to `ADMIN_PASSWORD` if you're locked out. **Remove it again afterwards.** |
   | `SESSION_SECRET` | optional | A random string used to sign login cookies. If it isn't set, one is generated and kept on the Volume. |
   | `MAX_UPLOAD_MB` | optional | Maximum size per uploaded document (default 50). |
   | `MAX_RESTORE_MB` | optional | Maximum size of a backup zip you can restore (default 2048). |

4. **Get a web address.** Go to the service → *Settings → Networking → Generate Domain*, or add your own domain.
5. Go to `https://<your-domain>/login`, sign in as **`admin`**, then open **Admin → Employees** and add everyone's logins.

On the first start the app loads some example content: documents, people, departments and access items. Edit or delete it from the admin area.

> **Upgrading from the previous version?** Your content, uploads and people are kept. The first time the new version starts, it creates the `admin` login from `ADMIN_PASSWORD`, and your existing contacts are converted to People automatically.

---

## Using the admin area

| Tab | What it's for |
|---|---|
| 📊 **Dashboard** | What needs attention: documents **overdue for review**, **required reading** that hasn't been confirmed (and by whom), **onboarding** still in progress, staff who haven't set their password yet, the **most and least opened** resources, a **broken link check**, and recent activity. |
| 📄 **Resources** | Add, edit, reorder or delete documents and links. **⇪ Bulk upload** adds up to 30 files at once. Replacing a file keeps the old one under **Previous versions**, and you can restore it. Tick **"Staff must confirm they've read it"** to make a document required reading. |
| 🪪 **Employees** | Staff logins. **Add employee** gives you a temporary password to hand over (with a printable welcome slip). The person must choose their own password when they first sign in. **Onboarding** is a saved checklist of that person's system and folder access. Tick items as IT sets them up, and it records who ticked each one and when. **New password** issues a new temporary password. Untick *Account active* to block someone without losing their history. |
| 🔑 **Access** | The master list of systems, shared folders, mailboxes, key fobs and licences, tagged by department and role. It also has a quick printable checklist for any department and role. Only admins can see it. |
| 🏢 **Org Chart** | People, photos, job titles, departments and "Reports to", with a live preview. Tick *Who to Ask* to list someone as a key contact. |
| 🗂️ **Sections & Roles** | Sections, departments and roles. |
| ⚙️ **Site & Backup** | Logo, site name, tagline, **announcements** (banners with an optional end date), whether staff must sign in, how often documents should be reviewed, and **backup and restore**. |
| 🕘 **Activity** | Every sign-in, failed sign-in and admin change: who did what, and when. You can filter it and download it as CSV. |

### Logins and passwords
- **Two account types:** *Staff* can use the site. *Admin* can also use the admin area. There's always at least one active admin, and you can't remove your own admin access.
- **Forgotten passwords:** an admin clicks **New password** on the Employees tab. The old password stops working straight away.
- **Sessions:** people are signed out after 12 hours. Changing or resetting a password signs out that person's other sessions.
- **Brute-force protection:** after 10 wrong passwords, that username is locked for 15 minutes.

### Signing in with Microsoft 365 (future option)
Staff could sign in with their work Microsoft accounts instead of site passwords. That needs your IT team to:
1. Create an **App registration** in the **Microsoft Entra admin center**.
2. Add the redirect URI `https://<your-domain>/auth/callback`.
3. Provide the **Tenant ID**, **Client ID** and a **Client secret**, and optionally a staff group to limit access to.

With those, it's a small addition to this app. Until then, admins create logins under **Employees**.

---

## Backups

**Admin → Site & Backup → Download backup** gives you a zip containing everything: documents, content, people, logins, onboarding records, activity and stats. Store it somewhere safe, because it contains staff login data (passwords are stored hashed, never as plain text).

**Restore from backup** replaces everything with the zip's contents. The data from just before the restore is kept on the server in a `before-restore-<date>` folder (the last two are kept).

It's also worth turning on Railway's own Volume backups (service → *Backups*).

What's on the Volume:
```
/data/content.json    resources, sections, roles, departments, people, access items, announcements, settings
/data/users.json      staff logins, onboarding records, read confirmations
/data/uploads/        uploaded files (including previous versions, logo and photos)
/data/activity.log    activity log (rotates at 5 MB)
/data/stats.json      how often each resource is opened
/data/fulltext.json   text extracted from documents for search (rebuilt automatically)
/data/session.key     cookie signing key (if SESSION_SECRET isn't set)
```

---

## Running locally

```bash
npm install
ADMIN_PASSWORD=secret123 npm start
# → http://localhost:3000   (sign in as "admin")
npm test                    # automated tests
```

Local data is stored in `./storage` (git-ignored). GitHub Actions runs `npm test` on every push.

## Project layout

```
server.js              Reads config from environment variables and starts the app
lib/app.js             Express app: sign-in, pages, public API, file serving
routes/admin.js        Admin API (resources, employees, settings, dashboard, backup…)
lib/store.js           Site content + validation
lib/users.js           Staff accounts (scrypt-hashed passwords, temporary passwords)
lib/auth.js            Signed session cookies, CSRF check, sign-in rate limiting
lib/audit.js           Activity log
lib/stats.js           Resource open counts
lib/fulltext.js        Text extraction from PDF/Word/Excel/PowerPoint for search
lib/linkcheck.js       Broken link checker
lib/backup.js          Backup zip / restore
lib/uploads.js         Upload rules (allowed file types, size limits)
public/                Home page and shared CSS/JS (admin-*.js power the admin area)
views/                 Sign-in, account and admin pages
seed/                  Example content copied in on the very first start
test/                  Automated tests (node --test)
```

## Security notes

- Passwords are hashed with scrypt. Temporary passwords are shown once and must be changed on first sign-in.
- Login cookies are HttpOnly and signed. Every change made through the API requires a custom header, which blocks cross-site request forgery.
- The access checklist (system names, folder paths) is admin-only and never sent to regular staff, except each person's own list, which appears on their *My account* page.
- Uploaded files are served with a sandboxing Content-Security-Policy, and HTML and script files can't be uploaded.
- If you turn off "Staff must sign in", the site and all documents can be seen by **anyone with the web address**.
