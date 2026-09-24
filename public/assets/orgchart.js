/* Renders an org chart from a flat list of people with `reportsTo` ids.
 * Shared by the public site and the admin preview. */
(function () {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function initials(p) {
    const words = String(p.name || p.jobTitle || "?").trim().split(/\s+/);
    return ((words[0] || "")[0] + ((words.length > 1 ? words[words.length - 1][0] : "") || "")).toUpperCase();
  }

  /**
   * @param {Array} people
   * @param {Object} [opts]
   * @param {string} [opts.department] highlight people in this department (others are dimmed)
   */
  function renderOrgChart(people, opts) {
    opts = opts || {};
    const list = (people || []).filter((p) => p && (p.name || p.jobTitle));
    if (!list.length) return "";
    const ids = new Set(list.map((p) => p.id));
    const children = new Map();
    const roots = [];
    list.forEach((p) => {
      if (p.reportsTo && p.reportsTo !== p.id && ids.has(p.reportsTo)) {
        if (!children.has(p.reportsTo)) children.set(p.reportsTo, []);
        children.get(p.reportsTo).push(p);
      } else {
        roots.push(p);
      }
    });

    const dept = opts.department || "";
    const visited = new Set();

    function node(p) {
      if (visited.has(p.id)) return ""; // guard against bad data loops
      visited.add(p.id);
      const kids = children.get(p.id) || [];
      const dim = dept && p.department !== dept;
      const contact = [
        p.phone ? `<span>☎️ ${esc(p.phone)}</span>` : "",
        p.email ? `<a href="mailto:${esc(p.email)}">✉️ ${esc(p.email)}</a>` : "",
      ].join("");
      return `<li>
        <div class="org-node${dim ? " dim" : ""}" tabindex="0">
          ${p.photo
            ? `<img class="org-avatar" src="/files/${encodeURIComponent(p.photo)}" alt="" loading="lazy" />`
            : `<span class="org-avatar" aria-hidden="true">${esc(initials(p))}</span>`}
          <span class="org-text">
            <strong>${esc(p.name || p.jobTitle)}</strong>
            ${p.name && p.jobTitle ? `<span class="org-title">${esc(p.jobTitle)}</span>` : ""}
            ${p.department ? `<span class="org-dept">${esc(p.department)}</span>` : ""}
          </span>
          ${p.responsibilities || contact ? `<span class="org-more">
            ${p.responsibilities ? `<span>${esc(p.responsibilities)}</span>` : ""}${contact}</span>` : ""}
        </div>
        ${kids.length ? `<ul>${kids.map(node).join("")}</ul>` : ""}
      </li>`;
    }

    // People with nobody above them and nobody below them go in a separate row.
    const tree = roots.filter((p) => children.has(p.id));
    const loose = roots.filter((p) => !children.has(p.id));
    let html = "";
    if (tree.length) html += `<div class="org-scroll"><ul class="org-tree">${tree.map(node).join("")}</ul></div>`;
    if (loose.length) {
      html += `<div class="org-loose">${tree.length ? '<p class="muted small">Also:</p>' : ""}
        <ul class="org-tree flat">${loose.map(node).join("")}</ul></div>`;
    }
    return html;
  }

  /**
   * Make the chart fit its container's width: if it's wider than the space,
   * scale it down (never below 45%) instead of scrolling sideways.
   * Small screens use the stacked list layout, so no scaling there.
   */
  function fitOrgChart(container) {
    if (!container) return;
    container.querySelectorAll(".org-scroll > .org-tree").forEach((tree) => {
      if (!tree.parentElement.clientWidth) return; // hidden right now; fit again when shown
      tree.style.zoom = "";
      tree.style.width = "";
      if (window.innerWidth <= 700) return;
      tree.style.width = "max-content";
      const needed = tree.scrollWidth;
      const available = tree.parentElement.clientWidth;
      if (needed > available) {
        tree.style.zoom = Math.max(0.45, available / needed);
      } else {
        tree.style.width = ""; // room to spare: stretch branches across the full width
      }
    });
  }

  let resizeTimer;
  const watched = new Set();
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => watched.forEach(fitOrgChart), 100);
  });

  window.renderOrgChart = renderOrgChart;
  window.fitOrgChart = (container) => {
    watched.add(container);
    fitOrgChart(container);
  };
})();
