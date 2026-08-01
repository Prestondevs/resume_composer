import { h, frag, clear } from "../lib/dom.js";
import { PAGE_SIZES, MARGINS, TEMPLATES, fontChoice } from "../schema.js";

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

function buildEntry(item, templateId, sectionId) {
  const stacked = templateId === "academic" || templateId === "ats";
  const dates = [item.start, item.end].filter(Boolean).join(" - ");
  const ids = { section: sectionId, item: item.id };

  const aside = (dates || item.location)
    ? h("div", { class: "r-entry-aside" },
        dates && h("span", edit("r-dates", "dates", ids), dates),
        item.location && h("span", edit("r-loc", "item", { ...ids, field: "location" }), item.location))
    : null;

  return h("article", { class: "r-entry" },
    (item.title || item.org || aside) && h("div", { class: "r-entry-top" },
      h("div", { class: `r-entry-lead${stacked ? " stacked" : ""}` },
        item.title && h("span", edit("r-title", "item", { ...ids, field: "title" }), item.title),
        item.org && h("span", edit("r-org", "item", { ...ids, field: "org" }), item.org)),
      aside),
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
      const entry = buildEntry(item, doc.template, section.id);
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
  container.dataset.template = doc.template;
  container.dataset.density = doc.settings.density || "normal";
  container.dataset.rules = doc.settings.sectionRules || "auto";
  applyVars(container, docStyleVars(doc));

  const hasContent = rest.length > 0 || (contactSection && !isEmptyContact(contactSection));
  if (!hasContent) return { pages: 0, overflow: false, blocks: 0 };

  if (isTwoColumn(doc.template)) {
    return renderTwoColumn(doc, container, metrics, contactSection, rest);
  }

  // measure a full-height layout, then cut it into pages
  const host = getMeasureHost(metrics, doc);
  const probe = h("div", {
    class: "r-doc",
    "data-template": doc.template,
    "data-density": doc.settings.density || "normal",
    "data-rules": doc.settings.sectionRules || "auto",
  }, h("div", { class: "r-page" }, h("div", { class: "r-page-inner" })));
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
