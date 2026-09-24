/*
 * ============================================================================
 *  NT INFORMATION CENTER — CONTENT FILE
 * ============================================================================
 *  This is the ONLY file you need to edit to add, change or remove content.
 *
 *  To add a document (PDF, Word, Excel, macro, PowerPoint...):
 *    1. Copy the file into the matching folder under /files
 *       e.g. files/sops/Goods-In-Receiving.pdf
 *    2. Add an entry to the `resources` list below with
 *       url: "files/sops/Goods-In-Receiving.pdf"
 *
 *  To add a website or online tool: just add an entry with the full web
 *  address, e.g. url: "https://wms.yourcompany.com"
 *
 *  Tip: open the site and click "+ Add resource" — it builds the entry for
 *  you so you only have to paste it in here.
 *
 *  Fields for each resource:
 *    title        (required) Name shown on the card
 *    url          (required) Link to the file or website
 *    category     (required) One of the category ids listed below
 *    type         (optional) pdf | word | excel | macro | powerpoint | sop |
 *                            website | video | form | image | other
 *                 If left out it is worked out from the file extension.
 *    description  (optional) One or two lines explaining what it is for
 *    roles        (optional) Which roles it applies to, e.g. ["Supervisor"]
 *                 Leave empty or out if it applies to everyone.
 *    tags         (optional) Extra search words, e.g. ["forklift", "MHE"]
 *    owner        (optional) Who to ask about it / who keeps it up to date
 *    updated      (optional) Last reviewed date, "YYYY-MM-DD"
 *    newStarter   (optional) true = appears on the "New Starter" checklist
 *    pinned       (optional) true = appears in "Quick Links" at the top
 *
 *  Watch the commas! Every entry is wrapped in { } and followed by a comma.
 * ============================================================================
 */

window.NT_CONTENT = {
  siteName: "NT Information Center",
  tagline: "Everything you need for your role in the warehouse office — in one place.",

  // Roles people can filter by ("Show me what's relevant to...")
  roles: [
    "Warehouse Administrator",
    "Inventory Controller",
    "Transport Planner",
    "Team Leader",
    "Supervisor",
    "Customer Service",
  ],

  // Sections of the site. `id` is what you put in each resource's `category`.
  categories: [
    { id: "start",     name: "Start Here",              icon: "🚀", description: "Induction, welcome pack and first-week essentials." },
    { id: "sops",      name: "SOPs & Processes",        icon: "📋", description: "Standard Operating Procedures for every warehouse process." },
    { id: "safety",    name: "Health & Safety",         icon: "🦺", description: "Risk assessments, safe systems of work and emergency info." },
    { id: "systems",   name: "Systems & Websites",      icon: "💻", description: "WMS, carrier portals, HR system and other online tools." },
    { id: "tools",     name: "Spreadsheets & Macros",   icon: "📊", description: "Excel trackers, reports and macro-enabled tools." },
    { id: "forms",     name: "Forms & Templates",       icon: "📝", description: "Blank forms, checklists and document templates." },
    { id: "hr",        name: "HR & People",             icon: "👥", description: "Policies, holiday requests, rotas and training." },
    { id: "reference", name: "Reference & Training",    icon: "📚", description: "Guides, videos, glossaries and how-tos." },
  ],

  // People a new starter should know about
  contacts: [
    { name: "Warehouse Manager",   role: "Site lead / escalations",        phone: "ext. 100", email: "manager@example.com" },
    { name: "Office Supervisor",   role: "Day-to-day office questions",    phone: "ext. 101", email: "office@example.com" },
    { name: "IT Helpdesk",         role: "Logins, printers, PC problems",  phone: "ext. 200", email: "it@example.com" },
    { name: "H&S Lead",            role: "Accidents, near misses, PPE",    phone: "ext. 300", email: "safety@example.com" },
  ],

  resources: [
    // ----- START HERE --------------------------------------------------------
    {
      title: "Welcome to the Warehouse Office",
      description: "Read this first: site layout, working hours, who's who and what to expect in week one.",
      url: "files/guides/Welcome-Guide.pdf",
      category: "start",
      tags: ["induction", "welcome", "site map", "hours"],
      owner: "Office Supervisor",
      updated: "2026-09-01",
      newStarter: true,
      pinned: true,
    },
    {
      title: "Goods In — Receiving SOP (example)",
      description: "Step-by-step: booking in a delivery, checking against the ASN, and putting away.",
      url: "files/sops/SOP-Goods-In-Receiving.pdf",
      type: "sop",
      category: "sops",
      roles: ["Warehouse Administrator", "Inventory Controller", "Team Leader"],
      tags: ["receiving", "inbound", "ASN", "putaway", "delivery"],
      owner: "Inbound Team Leader",
      updated: "2026-08-15",
      newStarter: true,
      pinned: true,
    },
    {
      title: "Daily Handover Template",
      description: "Word template for the end-of-shift handover to the next team.",
      url: "files/forms/Daily-Handover-Template.docx",
      category: "forms",
      tags: ["handover", "shift", "template"],
      roles: ["Team Leader", "Supervisor"],
      owner: "Office Supervisor",
      updated: "2026-07-20",
      newStarter: true,
    },
    {
      title: "Stock Discrepancy Tracker",
      description: "Log and track stock discrepancies found during picking and cycle counts.",
      url: "files/spreadsheets/Stock-Discrepancy-Tracker.xlsx",
      category: "tools",
      roles: ["Inventory Controller", "Supervisor"],
      tags: ["stock", "discrepancy", "cycle count", "variance"],
      owner: "Inventory Controller",
      updated: "2026-09-10",
      pinned: true,
    },

    // ----- EXAMPLES: replace these with your own ----------------------------
    // Uncomment and edit once you've added the files to the /files folder.
    //
    // {
    //   title: "Despatch Label Macro",
    //   description: "Macro-enabled workbook that prints despatch labels. Click 'Enable Content' when it opens.",
    //   url: "files/spreadsheets/Despatch-Labels.xlsm",
    //   category: "tools",
    //   roles: ["Transport Planner"],
    //   tags: ["labels", "despatch", "outbound"],
    // },

    // ----- SAFETY ------------------------------------------------------------
    {
      title: "HSE — Warehousing & Storage Guidance",
      description: "UK Health & Safety Executive guidance for warehouses (racking, vehicles, manual handling).",
      url: "https://www.hse.gov.uk/logistics/",
      category: "safety",
      tags: ["hse", "health and safety", "racking", "manual handling"],
      newStarter: true,
    },
    {
      title: "HSE — Lift Trucks (Forklifts)",
      description: "Rules and training requirements for forklift / MHE operation.",
      url: "https://www.hse.gov.uk/workplacetransport/lift-trucks/",
      category: "safety",
      roles: ["Team Leader", "Supervisor"],
      tags: ["forklift", "MHE", "FLT", "training"],
    },

    // ----- SYSTEMS & WEBSITES (replace with your real links) ----------------
    {
      title: "Warehouse Management System (WMS)",
      description: "Replace this link with your WMS login page.",
      url: "https://example.com/wms",
      category: "systems",
      tags: ["wms", "login", "stock", "orders"],
      owner: "IT Helpdesk",
      newStarter: true,
      pinned: true,
    },
    {
      title: "Carrier Tracking Portal",
      description: "Replace with your carrier's booking / tracking portal.",
      url: "https://example.com/carrier",
      category: "systems",
      roles: ["Transport Planner", "Customer Service"],
      tags: ["carrier", "tracking", "courier", "collection", "booking"],
    },

    // ----- REFERENCE ---------------------------------------------------------
    {
      title: "Microsoft — Enable macros in Excel",
      description: "How to safely enable macros when a macro workbook shows a security warning.",
      url: "https://support.microsoft.com/office/enable-or-disable-macros-in-microsoft-365-files-12b036fd-d140-4e74-b45e-16fed1a7e5c6",
      category: "reference",
      tags: ["excel", "macro", "vba", "security warning", "help"],
    },
  ],
};
