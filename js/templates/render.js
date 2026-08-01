import { h, frag, clear } from "../lib/dom.js";
import { PAGE_SIZES, MARGINS, TEMPLATES, BULLETS, fontChoice } from "../schema.js";
import { formatDateRange, formatLocation } from "./format.js";

const DPI = 96;

// one renderer for every template. Templates are pure CSS, so switching one can never drop
// content, which is the whole point of keeping the markup uniform
// pagination is measured, not guessed: the document is laid out once in a hidden host at true
// page width, block heights are read back, and blocks are then distributed across real page
// elements. The preview therefore breaks in the same places the printed PDF does

export function pageMetrics(doc) {
  const size = PAGE_SIZES[doc.settings.pageSize] || PAGE_SIZES.letter;
  const margin = MARGINS[doc.settings.margin] || MARGINS.normal;
  return {
    widthIn: size.width,
    heightIn: size.height,
    padY: margin.y,
    padX: margin.x,
    widthPx: size.width * DPI,
    heightPx: size.height * DPI,
    contentHeightPx: (size.height - margin.y * 2) * DPI,
    contentWidthPx: (size.width - margin.x * 2) * DPI,
  };
}

export function docStyleVars(doc) {
  const metrics = pageMetrics(doc);
  const vars = {
    "--page-w": `${metrics.widthIn}in`,
    "--page-h": `${metrics.heightIn}in`,
    "--page-pad": `${metrics.padY}in`,
    "--page-pad-x": `${metrics.padX}in`,
    "--r-scale": String(doc.settings.scale || 1),
  };

  // fonts are applied inline, which outranks whatever the layout stylesheet sets, so switching
  // layouts rearranges the page without restyling the text. an explicit choice wins over the
  // imported typeface, which in turn wins over the layout default.
  // both keys are always present: an empty value means "remove this and let the layout decide",
  // because leaving the key out would strand whatever was set on the previous render
  const chosen = fontChoice(doc.settings.fontOverride);
  const fonts = doc.settings.fonts;
  if (chosen) {
    vars["--r-body"] = chosen.stack;
    vars["--r-display"] = chosen.stack;
  } else if (doc.settings.keepFonts && fonts?.body?.stack) {
    vars["--r-body"] = fonts.body.stack;
    vars["--r-display"] = (fonts.display || fonts.body).stack;
  } else {
    vars["--r-body"] = "";
    vars["--r-display"] = "";
  }

  // presentation knobs. an empty string removes the property so the layout's own value applies,
  // which is what makes every one of these an override rather than a replacement
  const style = doc.settings.style || {};
  const step = { tight: 0.72, normal: 1, roomy: 1.38 };

  vars["--r-bullet"] = `"${(BULLETS.find((b) => b.id === style.bullet) || BULLETS[0]).glyph}"`;
  vars["--r-bullet-gap"] = style.bullet === "none" ? "0pt" : "10pt";
  vars["--r-gap-scale"] = String(step[style.sectionSpace] ?? 1);
  vars["--r-entry-scale"] = String(step[style.entrySpace] ?? 1);
  vars["--r-bullet-scale"] = String(step[style.bulletSpace] ?? 1);
  vars["--r-lead-scale"] = String(style.lineHeight || 1);
  vars["--r-tracking"] = `${style.letterSpacing || 0}em`;
  vars["--r-head-scale"] = String(style.headingScale || 1);
  vars["--r-ink"] = style.colors?.body || "";
  vars["--r-accent"] = style.colors?.heading || "";
  vars["--r-rule-forced"] = style.colors?.divider || "";
  vars["--r-accent-tint"] = style.colors?.accent || "";

  return vars;
}

// custom properties have to go through setProperty; assigning them onto a style object
// is silently dropped, which would leave every page on its CSS fallback
export function applyVars(element, vars) {
  for (const [key, value] of Object.entries(vars)) {
    if (!key.startsWith("--")) {
      element.style[key] = value;
    } else if (value === "" || value == null) {
      element.style.removeProperty(key);
    } else {
      element.style.setProperty(key, value);
    }
  }
  return element;
}

// the typeface actually in use, for the design panel summary
export function activeFontLabel(doc) {
  const chosen = fontChoice(doc.settings.fontOverride);
  if (chosen) return chosen.label;
  const fonts = doc.settings.fonts;
  if (doc.settings.keepFonts && fonts?.body) return fonts.body.label || fonts.body.name;
  return `${TEMPLATES.find((t) => t.id === doc.template)?.name || "Layout"} default`;
}

const isTwoColumn = (templateId) => (TEMPLATES.find((t) => t.id === templateId)?.columns || 1) === 2;

// the attributes the stylesheet keys off. shared so the measuring probe and the real page are
// always styled identically
function docDataset(doc) {
  const style = doc.settings.style || {};
  return {
    "data-template": doc.template,
    "data-density": doc.settings.density || "normal",
    "data-rules": doc.settings.sectionRules || "auto",
    "data-divider": style.divider || "thin",
    "data-header": style.headerStyle || "left",
    "data-align": style.align || "left",
  };
}

// every piece of text on the page is edited in place, so each one records where its value lives
// in the document. preview.js reads these back when the text changes
function edit(className, kind, ids = {}) {
  return {
    class: className ? `${className} r-edit` : "r-edit",
    contenteditable: "plaintext-only",
    spellcheck: "false",
    "data-edit": kind,
    "data-section": ids.section ?? null,
    "data-item": ids.item ?? null,
    "data-field": ids.field ?? null,
    "data-index": ids.index == null ? null : String(ids.index),
  };
}

// block builders

function buildContact(section) {
  const c = section.contact || {};
  const id = section.id;
  const bits = [];
  if (c.email) bits.push(h("a", { href: `mailto:${c.email}`, ...edit("", "contact", { section: id, field: "email" }) }, c.email));
  if (c.phone) bits.push(h("span", edit("", "contact", { section: id, field: "phone" }), c.phone));
  if (c.location) bits.push(h("span", edit("", "contact", { section: id, field: "location" }), c.location));
  (c.links || []).forEach((link, index) => {
    if (!link.url && !link.label) return;
    const href = /^https?:\/\//i.test(link.url) ? link.url : `https://${link.url}`;
    bits.push(h("a", { href, rel: "noreferrer", ...edit("", "link", { section: id, index }) },
      link.label || displayUrl(link.url)));
  });

  const line = h("div", { class: "r-contact-line" });
  bits.forEach((bit, index) => {
    if (index > 0) line.appendChild(h("span", { class: "r-sep", "aria-hidden": "true" }, "·"));
    line.appendChild(bit);
  });

  return h("header", { class: "r-contact", "data-section": id },
    c.name && h("div", edit("r-name", "contact", { section: id, field: "name" }), c.name),
    c.headline && h("div", edit("r-headline", "contact", { section: id, field: "headline" }), c.headline),
    bits.length ? line : null,
  );
}

const displayUrl = (url) => String(url).replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");

// an entry reads as two rows: who and where, then what and when. that is the hierarchy printed
// resumes use, and it keeps the employer and the role on separate lines instead of running them
// together with a comma
function buildEntry(item, doc, sectionId) {
  const style = doc.settings.style;
  const dates = formatDateRange(item, style.dateFormat);
  const location = formatLocation(item.location, style.locationFormat);
  const ids = { section: sectionId, item: item.id };

  const titleEl = item.title && h("span", edit("r-title", "item", { ...ids, field: "title" }), item.title);
  const orgEl = item.org && h("span", edit("r-org", "item", { ...ids, field: "org" }), item.org);
  const locEl = location && h("span", edit("r-loc", "item", { ...ids, field: "location" }), location);
  const dateEl = dates && h("span", edit("r-dates", "dates", ids), dates);

  const row = (lead, tail) => h("div", { class: "r-entry-row" },
    h("span", { class: "r-entry-lead" }, lead),
    tail ? h("span", { class: "r-entry-tail" }, tail) : null);

  const rows = [];
  if (orgEl) {
    rows.push(row(orgEl, locEl));
    if (titleEl || dateEl) rows.push(row(titleEl, dateEl));
  } else {
    // with no organisation the role carries the row, and the location follows the dates
    rows.push(row(titleEl, dateEl || locEl));
    if (dateEl && locEl) rows.push(row(null, locEl));
  }

  return h("article", { class: "r-entry" },
    ...rows,
    ...governmentRows(item, doc, ids),
    // detail lines keep the line structure they had in the source
    ...metaLines(item).map((line, index) => h("div", edit("r-meta", "meta", { ...ids, index }), line)),
    item.link && h("div", null, h("a", { class: "r-link", href: absoluteUrl(item.link), rel: "noreferrer" }, displayUrl(item.link))),
    // the index passed through is the one in the stored array, not in the filtered list, so an
    // edit lands on the right bullet even when blank ones sit between them
    item.bullets?.some((line) => line.trim())
      ? h("ul", { class: "r-bullets" }, item.bullets
          .map((line, index) => [line, index])
          .filter(([line]) => line.trim())
          .map(([line, index]) => bulletItem(line, { ...ids, index })))
      : null,
  );
}

// the position detail a federal application expects, printed as its own line so a reviewer can
// find it without reading the bullets
function governmentRows(item, doc, ids) {
  if (!doc.settings.governmentFields) return [];

  const facts = [];
  if (item.hours) facts.push(["Hours per week", item.hours, "hours"]);
  if (item.salary) facts.push(["Salary", item.salary, "salary"]);
  if (item.supervisor) {
    const contact = item.supervisorContact ? `${item.supervisor} (${item.supervisorContact})` : item.supervisor;
    facts.push(["Supervisor", contact, "supervisor"]);
  }
  if (item.supervisor) facts.push(["May we contact", item.mayContact ? "Yes" : "No", null]);
  if (!facts.length) return [];

  return [h("div", { class: "r-gov" }, facts.map(([label, value, field]) => h("div", { class: "r-gov-line" },
    h("span", { class: "r-gov-label" }, `${label}: `),
    field
      ? h("span", edit("", "item", { ...ids, field }), value)
      : h("span", null, value))))];
}

const absoluteUrl = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

export const metaLines = (item) => String(item.meta || "").split("\n").map((line) => line.trim()).filter(Boolean);

// a bullet may carry a trailing column, which the source set against the right margin. the two
// halves are edited separately and recombined around the tab on write back
export function bulletItem(line, ids) {
  const kind = ids?.item ? "bullet" : "sectionBullet";
  const at = line.indexOf("\t");
  if (at === -1) return h("li", edit("", kind, ids), line);
  return h("li", { class: "has-tail" },
    h("span", edit("r-bullet-text", kind, { ...ids, field: "text" }), line.slice(0, at).trim()),
    h("span", edit("r-bullet-tail", kind, { ...ids, field: "tail" }), line.slice(at + 1).trim()));
}

// returns the section element plus the child nodes pagination may split on
function buildSection(section, doc) {
  if (section.layout === "contact") {
    const el = buildContact(section);
    return { el, units: [el] };
  }

  const el = h("section", { class: "r-section", "data-section": section.id, "data-type": section.type, "data-jump": "1" });
  const head = h("h2", edit("r-head", "sectionTitle", { section: section.id }), section.title);
  el.appendChild(head);
  const body = h("div", { class: "r-body" });
  el.appendChild(body);

  const units = [];

  if (section.layout === "entries") {
    for (const item of section.items || []) {
      const entry = buildEntry(item, doc, section.id);
      body.appendChild(entry);
      units.push(entry);
    }
  } else if (section.layout === "bullets") {
    const list = h("ul", { class: "r-flat" });
    (section.bullets || []).forEach((line, index) => {
      if (!line.trim()) return;
      const li = bulletItem(line, { section: section.id, index });
      list.appendChild(li);
      units.push(li);
    });
    body.appendChild(list);
  } else if (section.layout === "inline") {
    const groups = (section.groups || [])
      .map((group, index) => [group, index])
      .filter(([group]) => group.items?.trim());
    const hasLabels = groups.some(([group]) => group.label?.trim());
    const wrap = h("div", { class: `r-inline-groups${hasLabels ? "" : " no-labels"}` });
    for (const [group, index] of groups) {
      const row = h("div", { class: "r-group" },
        h("span", edit("r-group-label", "group", { section: section.id, index, field: "label" }), group.label || ""),
        h("span", edit("r-group-items", "group", { section: section.id, index, field: "items" }), group.items));
      wrap.appendChild(row);
      units.push(row);
    }
    body.appendChild(wrap);
  } else if (section.layout === "prose") {
    const prose = h("div", { class: "r-prose" });
    (section.body || "").split(/\n{2,}/).forEach((paragraph, index) => {
      if (!paragraph.trim()) return;
      const p = h("p", edit("", "prose", { section: section.id, index }), paragraph.trim());
      prose.appendChild(p);
      units.push(p);
    });
    body.appendChild(prose);
  }

  return { el, head, body, units };
}

// pagination

let measureHost = null;

function getMeasureHost(metrics, doc) {
  if (!measureHost) {
    measureHost = h("div", { class: "measure-host", "aria-hidden": "true" });
    Object.assign(measureHost.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      visibility: "hidden",
      pointerEvents: "none",
      contain: "layout style",
    });
    document.body.appendChild(measureHost);
  }
  clear(measureHost);
  applyVars(measureHost, docStyleVars(doc));
  measureHost.style.width = `${metrics.widthPx}px`;
  return measureHost;
}

// renders `doc` into `container` as one or more page elements
// overflow: boolean, blocks: number}}
export function renderResume(doc, container) {
  const metrics = pageMetrics(doc);
  const visible = (doc.sections || []).filter((section) => section.visible);
  const contactSection = visible.find((section) => section.layout === "contact");
  const rest = visible.filter((section) => section !== contactSection);

  clear(container);
  container.className = "r-doc";
  for (const [key, value] of Object.entries(docDataset(doc))) container.setAttribute(key, value);
  applyVars(container, docStyleVars(doc));

  const hasContent = rest.length > 0 || (contactSection && !isEmptyContact(contactSection));
  if (!hasContent) return { pages: 0, overflow: false, blocks: 0 };

  if (isTwoColumn(doc.template)) {
    return renderTwoColumn(doc, container, metrics, contactSection, rest);
  }

  // measure a full-height layout, then cut it into pages
  const host = getMeasureHost(metrics, doc);
  // the probe must carry exactly the attributes the real page does, or heights are measured
  // against different styling than the one that ends up on screen
  const probe = h("div", { class: "r-doc", ...docDataset(doc) },
    h("div", { class: "r-page" }, h("div", { class: "r-page-inner" })));
  applyVars(probe, docStyleVars(doc));
  probe.querySelector(".r-page").style.minHeight = "0";
  host.appendChild(probe);
  const probeInner = probe.querySelector(".r-page-inner");

  const built = [];
  if (contactSection) built.push({ section: contactSection, ...buildSection(contactSection, doc) });
  for (const section of rest) built.push({ section, ...buildSection(section, doc) });
  for (const entry of built) probeInner.appendChild(entry.el);

  const flow = [];
  for (const entry of built) {
    const sectionTop = entry.el.offsetTop;
    const sectionHeight = entry.el.offsetHeight;
    const marginBottom = parseFloat(getComputedStyle(entry.el).marginBottom) || 0;

    if (!entry.units.length || entry.units[0] === entry.el) {
      flow.push({ entry, from: 0, top: sectionTop, height: sectionHeight + marginBottom, unitCount: 0 });
      continue;
    }

    // the heading must stay with its first unit or a page break orphans it
    const headHeight = entry.head ? entry.head.offsetHeight + (parseFloat(getComputedStyle(entry.head).marginBottom) || 0) : 0;
    entry.units.forEach((unit, index) => {
      const height = unit.offsetHeight + (parseFloat(getComputedStyle(unit).marginBottom) || 0);
      flow.push({
        entry,
        unit,
        index,
        height: index === 0 ? height + headHeight : height,
        tailMargin: index === entry.units.length - 1 ? marginBottom : 0,
        withHead: index === 0,
      });
    });
  }

  const available = metrics.contentHeightPx;
  const pages = [[]];
  let used = 0;

  for (const block of flow) {
    const cost = block.height + (block.tailMargin || 0);
    const isFirstOnPage = pages[pages.length - 1].length === 0;

    if (!isFirstOnPage && used + block.height > available + 1) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(block);
    used += cost;
  }

  clear(host);
  paintPages(doc, container, pages, metrics);
  // single-column layouts never overflow: anything that does not fit becomes
  // another page. `overflow` is reserved for layouts that cannot reflow
  return { pages: pages.length, overflow: false, blocks: flow.length };
}

function paintPages(doc, container, pages, metrics) {
  const sectionShells = new Map();

  pages.forEach((blocks, pageIndex) => {
    const inner = h("div", { class: "r-page-inner" });
    const page = h("div", { class: "r-page" }, inner,
      doc.settings.showPageNumbers || pages.length > 1
        ? h("div", { class: "r-page-num" }, `${pageIndex + 1} / ${pages.length}`)
        : null);

    for (const block of blocks) {
      if (!block.unit) {
        inner.appendChild(block.entry.el);
        continue;
      }
      const key = `${block.entry.section.id}:${pageIndex}`;
      let shell = sectionShells.get(key);
      if (!shell) {
        shell = h("section", {
          class: "r-section",
          "data-section": block.entry.section.id,
          "data-type": block.entry.section.type,
          "data-jump": "1",
        });
        if (block.withHead && block.entry.head) shell.appendChild(block.entry.head);
        shell.appendChild(h("div", { class: "r-body" }));
        sectionShells.set(key, shell);
        inner.appendChild(shell);
      }
      const body = shell.querySelector(".r-body");
      // rebuild the wrapper list element that the unit came from
      const parentTag = block.unit.parentElement?.className || "";
      if (/r-flat|r-bullets|r-inline-groups|r-prose/.test(parentTag)) {
        let wrapper = body.lastElementChild;
        if (!wrapper || wrapper.className !== parentTag) {
          wrapper = h(block.unit.parentElement.tagName.toLowerCase(), { class: parentTag });
          body.appendChild(wrapper);
        }
        wrapper.appendChild(block.unit);
      } else {
        body.appendChild(block.unit);
      }
    }

    container.appendChild(page);
  });
}

// two-column templates keep the aside on every page and flow the main column
function renderTwoColumn(doc, container, metrics, contactSection, rest) {
  const asideTypes = new Set(["skills", "languages", "certifications", "interests", "coursework", "awards"]);
  const asideSections = rest.filter((section) => section.column === 1 || (section.column !== 0 ? false : asideTypes.has(section.type)));
  const mainSections = rest.filter((section) => !asideSections.includes(section));

  const inner = h("div", { class: "r-page-inner two-col" });
  if (contactSection) inner.appendChild(buildSection(contactSection, doc).el);

  const aside = h("div", { class: "r-col-aside" });
  for (const section of asideSections) aside.appendChild(buildSection(section, doc).el);

  const main = h("div", { class: "r-col-main" });
  for (const section of mainSections) main.appendChild(buildSection(section, doc).el);

  inner.append(aside, main);
  const page = h("div", { class: "r-page" }, inner);
  container.appendChild(page);

  // column layouts do not split cleanly, so report overflow instead of forcing
  // a break that would look wrong
  const overflow = inner.scrollHeight > metrics.heightPx + 2;
  if (overflow) page.classList.add("is-overflowing");
  return { pages: 1, overflow, blocks: rest.length, columnsFixed: true };
}

function isEmptyContact(section) {
  const c = section.contact || {};
  return !(c.name || c.email || c.phone || c.location || c.headline || c.links?.length);
}

export function renderEmptyState(container, onImport, onStart) {
  clear(container);
  container.className = "";
  container.appendChild(h("div", { class: "canvas-empty" },
    h("h3", null, "Nothing to preview yet"),
    h("p", null, "Import an existing resume to break it into editable cards, or start from the blank sections in the composer."),
    h("div", { style: { display: "flex", gap: "8px", marginTop: "4px" } },
      h("button", { class: "btn btn-primary btn-lg", onclick: onImport }, "Import a resume"),
      h("button", { class: "btn btn-ghost btn-lg", onclick: onStart }, "Start from scratch")),
  ));
}
