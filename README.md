# NT Information Center

A one-stop page for the warehouse office. It collects SOPs, PDFs, Word documents, Excel trackers, macros, websites and contacts in one place, so a new starter can find everything about their role and the processes they follow.

## Features

- **Search**: search by title, description, tags, owner or role. Press `/` to jump to the search box.
- **Filter by type**: SOP, PDF, Word, Excel, Macro, PowerPoint, Website, Video, Form.
- **"My role" filter**: shows only what's relevant to a role, such as Transport Planner. The choice is remembered.
- **New Starter Checklist**: a tick-off list with a progress bar. Progress is saved in the browser.
- **Quick Links**: the everyday links people use most, pinned to the top.
- **Favourites**: anyone can tap ♡ on a card to keep their own shortlist.
- **Who to Ask**: key contacts for a new employee.
- **+ Add resource**: a form that writes the entry for you, ready to paste into the content file.
- Works on desktop and mobile, supports dark mode, and prints cleanly.

No install, no database and no build step. It's plain HTML, CSS and JavaScript.

## Folder layout

```
index.html              ← the page
data/resources.js       ← ALL the content (the only file you normally edit)
files/
  sops/                 ← SOP documents
  forms/                ← forms & templates (Word, PDF)
  spreadsheets/         ← Excel trackers & macro workbooks (.xlsx / .xlsm)
  guides/               ← welcome packs, how-tos, training material
assets/                 ← styling and page logic (no need to touch)
```

## Adding content

### A document (PDF, Word, Excel, macro, PowerPoint…)
1. Copy the file into the right folder under `files/`, e.g. `files/sops/SOP-Despatch.pdf`.
2. Open the site, click **+ Add resource**, fill in the form and click **Copy entry**.
3. Open `data/resources.js` and paste the entry inside the `resources: [ … ]` list.
4. Save and refresh the page.

### A website or online system
Do the same, but put the full web address in the link box (e.g. `https://wms.mycompany.com`). You don't need to copy a file.

### Sections, roles and contacts
These live at the top of `data/resources.js`: `categories`, `roles` and `contacts`. Add, rename or remove them there.

The type (PDF, Word, Excel, Macro…) is worked out from the file extension. For example, `.xlsm` shows as a **Macro** with a reminder to click *Enable Content*. Set `type: "sop"` to label a document as an SOP.

> The sample entries and files (Welcome Guide, Goods In SOP, Handover Template, Discrepancy Tracker) are **examples**. Replace them with your own. The WMS and Carrier links point to `example.com` placeholders.

## Hosting it

Pick whichever suits your office:

| Option | How |
|---|---|
| **Shared network drive** | Copy the whole folder to the shared drive. People open `index.html` in their browser, and you can bookmark it or pin it as the browser home page. |
| **GitHub Pages** | Repo → *Settings → Pages* → deploy from the `main` branch. You get a web link anyone can open. ⚠️ Only use this if the documents aren't confidential, or if your GitHub plan supports private Pages. |
| **SharePoint / intranet** | Upload the folder to a document library or an internal web server. |

### Linking to files that stay on a network drive
If you don't want to copy a file into `files/`, you can link to it where it already is:
`url: "file://///SERVER/Share/Warehouse/SOPs/Picking.pdf"`
These links only work when the page is also opened from the network drive. Browsers block `file://` links from pages served over `https://`.

## Notes
- Favourites, checklist progress and the chosen role are stored **per browser**. They are not shared between people.
- If the page shows "Couldn't load content", there's a typo in `data/resources.js`. It's usually a missing comma or bracket. Press F12 to see the line number.
