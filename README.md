# NT Information Center

A one-stop website for the warehouse office. It collects SOPs, PDFs, Word documents, Excel trackers, macros, websites and contacts in one place, so a new starter can find everything about their role and the processes they follow.

- **Public site** (`/`): open to everyone. It has search, plus **Department**, **Role** and type filters, a New Starter checklist, Quick Links, favourites, a "Who to Ask" contacts panel and an **Org Chart**.
- **Admin** (`/admin`): password protected. Admins can upload documents, add website links, edit or delete resources and change their order. They also manage sections, roles, departments, people, the org chart, the logo, and a private **Access Checklist** of the systems and folders each role needs. Changes go live straight away.

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
  - Pick the section and tick which **departments** and **roles** it's for. Leave them unticked if it's for everyone. You can also add it to the **New Starter checklist** or **Quick Links**.
  - **Edit** changes any details or replaces the file. The old file is deleted automatically.
  - **▲ ▼** changes the order within a section. The New Starter checklist follows this order too.
- **Sections, Roles & Departments**: add, rename, reorder or remove sections, and edit the lists of roles and departments. A section can't be removed while it still contains resources. When you remove a role or department, it is also cleared from everything that used it.
- **People & Site**
  - **Logo**: upload a PNG, JPG, SVG or WebP (up to 5 MB). It appears in the site header and as the browser tab icon.
  - **Site name** and **tagline**.
  - **People**: name, job title / role, department, what to ask them about, phone, email and **Reports to**. The org chart is built from "Reports to". Tick **Who to Ask** to also list someone as a key contact. A live preview of the chart is shown below the list. If a "Reports to" setting would create a loop, you'll get an error when you save.
- **Access Checklist** (admins only, never shown on the public site)
  - **Access items**: each system, shared folder, mailbox, key fob or licence, with its location, how to request it and who approves it. Tag each one with the departments and roles that need it, or leave both empty if everyone needs it.
  - **New starter access checklist**: pick a department and role (and type the employee's name) to get the full list for that person. Tick items off as access is granted, or click **🖨️ Print** for a sign-off sheet with a "Date done" column.

On the public site, choosing a **Department** filters resources and "Who to Ask" and highlights that department in the org chart.

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
/data/content.json   ← every resource, section, role, department, person and access item
/data/uploads/       ← uploaded files
```
Railway supports Volume backups under the service's *Backups* tab. It's worth turning these on.

## Project layout

```
server.js            Express server: public API, file serving, admin API
lib/store.js         Reads and writes content.json, validation (incl. org-chart loop checks)
lib/auth.js          Admin password login (signed HttpOnly cookie, rate-limited)
public/              Public site (index.html) and shared assets (orgchart.js is used by both pages)
views/               Admin pages (only served by the server; login required for admin.html)
seed/                Example content copied in on the very first start
railway.json         Railway deploy settings (start command, health check)
```

## Security notes

- A single shared admin password. Anyone who has it can edit content. Share it only with admins.
- Login attempts are limited to 10 per 15 minutes per IP address. Sessions last 12 hours.
- The access checklist (system names, folder paths) is only served by the admin API. It is never included in the public content.
- The public site and all uploaded documents can be seen by **anyone with the link**. Don't upload confidential material unless the site is kept private. For example, don't share the Railway domain publicly, or put it behind your company's SSO or VPN.
