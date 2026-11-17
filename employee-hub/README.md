# Employee Hub

A shared hub for warehouse employees, shown on an iPad kiosk or opened on a phone by scanning a QR code. The home screen has big, glove-friendly tiles that open your **monday.com forms** (daily forklift check, tag-outs, PTO, gear requests…), live **board panels** read from your monday.com boards (forklifts out of service, today's checks…), and **quick links** to handbooks, schedules and other boards. Everything is set up from a password-protected admin area, in English and Spanish.

This is a rebuild of the original monday-hosted Employee Hub as a plain Node.js app so it can run on Railway like your other apps. Instead of custom forms that wrote to boards through monday's SDK, each tile is a monday.com **form link** that you assign in the admin area. The forms open inside the hub, and the kiosk returns to the home screen on its own afterwards.

- **Home** (`/`): greeting, tool tiles, quick links and board panels. Refreshes itself, so the kiosk never needs reloading.
- **Form page** (`/open/t/…`): a tile's form inside the hub with a "Back to hub" button. After a period with no taps it returns home.
- **QR code** (`/qr`): a printable code that opens the hub on a phone. A small one is also in the top bar.
- **Admin** (`/admin`): tiles, board panels, quick links and settings.

No database: settings are a JSON file on a Railway Volume. No build step.

---

## Deploying on Railway

This app lives in the `employee-hub` folder of the repository, so the Railway service needs to be pointed at that folder.

1. **Create the service.** In Railway, go to *New Project → Deploy from GitHub repo* and pick this repository (or add a new service to an existing project).
2. **Point it at this folder.** Service → *Settings*:
   - *Source → Root Directory*: `/employee-hub`
   - *Config as Code → Railway Config File*: `/employee-hub/railway.json` (this path is from the repository root, it does not follow the root directory)
   - Optional: *Source → Watch Paths*: `/employee-hub/**` so only changes to the hub redeploy it.
   Railway detects Node and runs `npm start`.
3. **Add a Volume.** Right-click the service → *Attach Volume* → mount path **`/data`**. Without it, your tiles, panels and settings are wiped on every redeploy.
4. **Set variables.** Service → *Variables*:

   | Variable | Required | What it does |
   |---|---|---|
   | `ADMIN_PASSWORD` | ✅ | Password for the admin area at `/admin`. Changing it signs every admin out. |
   | `MONDAY_API_TOKEN` | for board panels | A monday.com API token (see below). Tiles and quick links work without it. |
   | `SESSION_SECRET` | optional | Random string used to sign the admin login cookie. Generated and kept on the Volume if empty. |
   | `PUBLIC_URL` | optional | The hub's public address, used for the QR code. Defaults to the address the page is opened on; you can also set it in *Settings*. |
   | `MONDAY_CACHE_SECONDS` | optional | How long board data is reused before asking monday.com again (default 45). |

5. **Get a web address.** Service → *Settings → Networking → Generate Domain*, or add your own domain.
6. Open `https://<your-domain>/admin`, sign in, and paste your form links into the tiles.

### The monday.com API token

Board panels read your boards through monday's API, which needs a token:

1. In monday.com, click your avatar (bottom left) → **Developers** → **My access tokens** → *Show* / *Copy*.
2. Add it to the Railway service as `MONDAY_API_TOKEN` and redeploy.
3. In the hub's *Admin → Settings*, press **Test connection**. It shows which user the token belongs to; panels can read every board that user can see.

Use a token from a user with access to just the boards you need. The token stays on the server and is never sent to the kiosk.

---

## Setting up the hub

### Tiles (monday.com forms)

1. In monday.com, open the board's form (or create one with *WorkForms*). Click **Share** and copy the link, which looks like `https://forms.monday.com/forms/…?r=use1`.
2. In the hub's *Admin → Tiles*, edit the tile and paste the link. The admin area recognises form links and opens them inside the hub, switching to monday's embed address automatically.
3. Tiles without a link show as **Coming soon** on the kiosk. Switch a tile off to hide it entirely.

Anything else works too: a Google Form, a SharePoint page, a monday board or dashboard (those need a monday login, so choose *Open in a new tab*).

### Board panels

A panel is a live list from one board. For each panel you choose:

- **Board**: paste the board's link or ID, or pick from the list, then *Load board* to get its columns.
- **What each row shows**: the row title (the item name or any column) and up to six details.
- **Only show items where…**: conditions such as *Status is any of NEW, Working on it* or *Created date is today*. Status and dropdown values are picked from the board's own labels.
- **Highlight rows**: mark a row in red when any of the chosen columns has one of the chosen values, for example *Priority is Critical*, or *any inspection item is FAIL*. The matching column names are shown on the row ("Failed: Mast, Horn").
- **Order and limit**, the message to show when the list is empty, and an optional *Open board* button.

Press **Preview** to check the result against the live board before saving. Two ready-made examples are offered when you add a panel: *Out of service* and *Today's submissions*.

Panels refresh on the kiosk every minute (configurable). If monday.com is temporarily unreachable, the last good data is shown with a note.

> Everything a panel shows is visible to anyone who can open the hub. Pick columns accordingly, and don't show personal data.

### Quick links

Smaller cards under the tiles: handbooks, schedules, monday boards and dashboards, safety videos. Each can open inside the hub or in a new tab.

### Spanish

Every title and description you enter has an English and a Spanish box; Spanish falls back to English when empty. The kiosk shows an EN / ES switch (turn it off in *Settings* for English only). Values that come from boards (statuses, shifts, issue types…) can be translated under *Settings → Spanish names for board values*. The starter list covers the original hub's labels.

### iPad kiosk tips

- Open the hub in Safari and *Add to Home Screen*; launching it from there hides the browser bars.
- Turn on **Guided Access** (Settings → Accessibility) so people can't leave the hub.
- *Settings → Return to home after* controls how long a form stays open with no taps before the kiosk goes back to the home screen (default 5 minutes; the last 30 seconds show a warning that any tap cancels).

---

## Running locally

```bash
cd employee-hub
npm install
ADMIN_PASSWORD=secret123 MONDAY_API_TOKEN=... npm start
# → http://localhost:3000   admin at http://localhost:3000/admin
npm test                    # automated tests (uses a fake monday.com, no token needed)
```

Local data is stored in `employee-hub/storage` (git-ignored).

## What's on the Volume

```
/data/content.json    tiles, panels, quick links, settings, Spanish labels
/data/session.key     cookie signing key (if SESSION_SECRET isn't set)
```

Both are small; Railway's Volume backups cover them.

## Project layout

```
server.js                 Reads config from environment variables and starts the app
lib/app.js                Express app: kiosk pages, public API, admin login and admin API
lib/store.js              content.json: validation for tiles, panels, links and settings
lib/monday.js             monday.com API client: boards, columns, filtered items, caching
lib/links.js              Link clean-up; turns form share links into embed links
lib/auth.js               Admin session cookie, CSRF check, sign-in rate limiting
lib/qr.js                 QR code encoder (no dependencies)
public/                   Kiosk pages (index, open, qr) and shared CSS/JS; admin CSS/JS
views/                    Admin sign-in and admin pages
seed/content.json         Starter tiles and Spanish labels, copied in on the very first start
test/                     Automated tests (node --test) with a fake monday.com
```

## How board panels talk to monday.com

Panels use monday's GraphQL API (`items_page`). Filters are always applied on this server, so a panel is correct whatever monday returns. Where monday's own filter syntax is well defined (status labels, "today" on date columns, empty / not empty, text contains) the same filter is also sent to monday so fewer items come back, and results are sorted newest-first by creation log. If monday rejects a query, the hub retries without filters, then with the simplest column fields, so a syntax difference never blanks a panel. Each panel's data is cached for 45 seconds (`MONDAY_CACHE_SECONDS`), and up to 500 items are scanned per refresh.

## Security notes

- The kiosk pages are public, like the original hub. The admin area needs `ADMIN_PASSWORD`; after 10 wrong tries from one address, sign-in is locked for 15 minutes.
- The admin cookie is HttpOnly and signed. Every change made through the API requires a custom header, which blocks cross-site request forgery.
- The monday.com token and board filters stay on the server; the kiosk only receives the rows you chose to show.
- Pages send a Content-Security-Policy that allows only https pages to be embedded, and the hub itself can't be embedded elsewhere.
