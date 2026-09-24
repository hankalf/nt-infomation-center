# NT Information Center

A one-stop website for the warehouse office. It collects SOPs, PDFs, Word documents, Excel trackers, macros, websites and contacts in one place, so a new starter can find everything about their role and the processes they follow.

- **Public site** (`/`): open to everyone. It has search, type and role filters, a New Starter checklist, Quick Links, favourites and a "Who to Ask" contacts panel.
- **Admin** (`/admin`): password protected. Admins can upload documents, add website links, edit or delete resources, change their order, and manage sections, roles, contacts and the site name. Changes go live straight away.

Built with Node.js and Express. Content is kept in a JSON file and uploads are stored on disk, so no database is needed.

---

## Deploying on Railway

1. **Create the service.** In Railway, go to *New Project → Deploy from GitHub repo* and pick this repository. Railway detects Node and runs `npm start`.
2. **Add a Volume.** This step matters: without a Volume, uploads and edits are wiped on every redeploy.
   Right-click the service → *Attach Volume* → mount path **`/data`**.
   The app finds the volume automatically through `RAILWAY_VOLUME_MOUNT_PATH`.
3. **Set variables.** Go to the service → *Variables*:
   | Variable | Required | What it does |
   |---|---|---|
   | `ADMIN_PASSWORD` | ✅ | Password for `/admin`. Use something long. Changing it signs everyone out. |
   | `SESSION_SECRET` | optional | An extra random string used to sign the login cookie. |
   | `MAX_UPLOAD_MB` | optional | Maximum upload size in MB (default 50). |
4. **Get a web address.** Go to the service → *Settings → Networking → Generate Domain*, or add your own domain.
5. Open `https://<your-domain>/admin`, sign in, and start adding material.

On the first start, the app loads some example content (a welcome guide, an SOP, a handover template, a tracker and a few links). Edit or delete these from the admin page.

---

## Using the admin page

- **Resources tab**
  - **+ Add resource** → choose **Upload a file** (PDF, Word, Excel, `.xlsm` macro, PowerPoint, images, video…) or **Link to a website**.
  - Pick the section, tick which roles it's for (tick none if it's for everyone), and optionally add it to the **New Starter checklist** or **Quick Links**.
  - **Edit** changes any details or replaces the file. The old file is deleted automatically.
  - **▲ ▼** changes the order within a section. The New Starter checklist follows this order too.
- **Sections & Roles**: add, rename, reorder or remove sections, and edit the list of roles. A section can't be removed while it still contains resources.
- **Contacts & Site**: the "Who to Ask" contacts, the site name and the tagline.

Allowed upload types: pdf, doc/docx/dotx/rtf/odt/txt, xls/xlsx/xlsm/xlsb/xltm/xltx/xlam/csv/ods, ppt/pptx/ppsx/odp, png/jpg/gif/webp, mp4/mov/webm, zip, msg/eml, vsdx, bas.
PDFs, images and videos open in the browser. Office files and macros download.

---

## Running locally

```bash
npm install
ADMIN_PASSWORD=secret npm start
# → http://localhost:3000   and   http://localhost:3000/admin
```

Local data is stored in `./storage` (git-ignored).

## Backups

All content lives in the Volume:
```
/data/content.json   ← every resource, section, role and contact
/data/uploads/       ← uploaded files
```
Railway supports Volume backups under the service's *Backups* tab. It's worth turning these on.

## Project layout

```
server.js            Express server: public API, file serving, admin API
lib/store.js         Reads and writes content.json, validation
lib/auth.js          Admin password login (signed HttpOnly cookie, rate-limited)
public/              Public site (index.html) and shared assets
views/               Admin pages (only served by the server; login required for admin.html)
seed/                Example content copied in on the very first start
railway.json         Railway deploy settings (start command, health check)
```

## Security notes

- A single shared admin password. Anyone who has it can edit content. Share it only with admins.
- Login attempts are limited to 10 per 15 minutes per IP address. Sessions last 12 hours.
- The public site and all uploaded documents can be seen by **anyone with the link**. Don't upload confidential material unless the site is kept private. For example, don't share the Railway domain publicly, or put it behind your company's SSO or VPN.
