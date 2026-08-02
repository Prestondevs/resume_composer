// markdown and plain-text serialisation
// the plain-text form doubles as the ATS preview, so it deliberately mirrors what a naive
// parser would pull out of the PDF: headings on their own line, no decorative characters, dates
// written out

const visibleSections = (doc) => doc.sections.filter((section) => section.visible);

const dateRange = (item) => [item.start, item.end].filter(Boolean).join(" - ");

// a line the writer has opened but not filled yet belongs to editing, not to the resume. the page
// shows those so there is somewhere to type; nothing that leaves the app should carry them
export const writtenLines = (lines) => (lines || []).filter((line) => String(line ?? "").trim());
export const itemHasContent = (item) => Boolean(
  item.org || item.title || item.location || item.start || item.end
  || item.meta || item.link || writtenLines(item.bullets).length,
);

// detail lines are stored newline separated so they keep the shape they had in the source
const metaLines = (item) => String(item.meta || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);

// federal position detail, printed only when the document asks for it
function governmentLines(item, doc) {
  if (!doc?.settings?.governmentFields) return [];
  const out = [];
  if (item.hours) out.push(`Hours per week: ${item.hours}`);
  if (item.salary) out.push(`Salary: ${item.salary}`);
  if (item.supervisor) {
    out.push(`Supervisor: ${item.supervisor}${item.supervisorContact ? ` (${item.supervisorContact})` : ""}`);
    out.push(`May we contact: ${item.mayContact === false ? "No" : "Yes"}`);
  }
  return out;
}

// a bullet may carry a trailing column that the source set against the right margin. plain text
// keeps the tab, which is what a parser sees; markdown has no right alignment, so it reads as an
// aside instead
const bulletAside = (line) => {
  const at = String(line).indexOf("\t");
  return at === -1 ? String(line) : `${line.slice(0, at).trim()} (${line.slice(at + 1).trim()})`;
};

function contactLines(contact) {
  const lines = [];
  if (contact.name) lines.push(contact.name);
  if (contact.headline) lines.push(contact.headline);
  const details = [contact.email, contact.phone, contact.location].filter(Boolean);
  const links = (contact.links || []).map((link) => (link.label ? `${link.label}: ${link.url}` : link.url)).filter(Boolean);
  if (details.length) lines.push(details.join(" | "));
  if (links.length) lines.push(links.join(" | "));
  return lines;
}

export function toPlainText(doc, { width = 0 } = {}) {
  const out = [];

  for (const section of visibleSections(doc)) {
    if (section.layout === "contact") {
      out.push(...contactLines(section.contact || {}), "");
      continue;
    }

    out.push(section.title.toUpperCase(), "");

    if (section.layout === "entries") {
      for (const item of section.items || []) {
        if (!itemHasContent(item)) continue;
        // the same two rows the page uses: who and where, then what and when
        if (item.org) {
          out.push([item.org, item.location].filter(Boolean).join("   "));
          const role = [item.title, dateRange(item)].filter(Boolean).join("   ");
          if (role) out.push(role);
        } else {
          const role = [item.title, dateRange(item) || item.location].filter(Boolean).join("   ");
          if (role) out.push(role);
          if (dateRange(item) && item.location) out.push(item.location);
        }
        for (const line of governmentLines(item, doc)) out.push(line);
        for (const detail of metaLines(item)) out.push(detail);
        if (item.link) out.push(item.link);
        for (const bullet of writtenLines(item.bullets)) out.push(...wrap(`- ${bullet}`, width, "  "));
        out.push("");
      }
    } else if (section.layout === "bullets") {
      for (const line of writtenLines(section.bullets)) out.push(...wrap(`- ${line}`, width, "  "));
      out.push("");
    } else if (section.layout === "inline") {
      for (const group of section.groups || []) {
        if (!group.items?.trim()) continue;
        out.push(...wrap(group.label ? `${group.label}: ${group.items}` : group.items, width, "  "));
      }
      out.push("");
    } else if (section.layout === "prose") {
      for (const paragraph of (section.body || "").split(/\n{2,}/)) {
        if (paragraph.trim()) out.push(...wrap(paragraph.trim(), width), "");
      }
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function wrap(text, width, hangingIndent = "") {
  if (!width || text.length <= width) return [text];
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const limit = lines.length ? width - hangingIndent.length : width;
    if (candidate.length > limit && current) {
      lines.push(lines.length ? hangingIndent + current : current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(lines.length ? hangingIndent + current : current);
  return lines;
}

export function toMarkdown(doc) {
  const out = [];

  for (const section of visibleSections(doc)) {
    if (section.layout === "contact") {
      const contact = section.contact || {};
      if (contact.name) out.push(`# ${contact.name}`, "");
      if (contact.headline) out.push(`*${contact.headline}*`, "");
      const bits = [];
      if (contact.email) bits.push(`[${contact.email}](mailto:${contact.email})`);
      if (contact.phone) bits.push(contact.phone);
      if (contact.location) bits.push(contact.location);
      for (const link of contact.links || []) {
        if (!link.url) continue;
        bits.push(`[${link.label || link.url}](${absolute(link.url)})`);
      }
      if (bits.length) out.push(bits.join(" · "), "");
      continue;
    }

    out.push(`## ${section.title}`, "");

    if (section.layout === "entries") {
      for (const item of section.items || []) {
        if (!itemHasContent(item)) continue;
        // the same two rows the page uses: who and where, then what and when
        if (item.org) {
          out.push([`**${item.org}**`, item.location && `*${item.location}*`].filter(Boolean).join("  \n"));
          const role = [item.title && `**${item.title}**`, dateRange(item) && `*${dateRange(item)}*`]
            .filter(Boolean).join("  \n");
          if (role) out.push(role);
        } else {
          const aside = [dateRange(item), item.location].filter(Boolean).join(" · ");
          const heading = item.title && `**${item.title}**`;
          if (heading || aside) out.push([heading, aside && `*${aside}*`].filter(Boolean).join("  \n"));
        }
        for (const line of governmentLines(item, doc)) out.push(line);
        for (const detail of metaLines(item)) out.push(detail);
        if (item.link) out.push(`[${item.link.replace(/^https?:\/\//, "")}](${absolute(item.link)})`);
        const bullets = writtenLines(item.bullets);
        if (bullets.length) {
          out.push("");
          for (const bullet of bullets) out.push(`- ${escapeMarkdown(bulletAside(bullet))}`);
        }
        out.push("");
      }
    } else if (section.layout === "bullets") {
      for (const line of writtenLines(section.bullets)) {
        out.push(`- ${escapeMarkdown(bulletAside(line))}`);
      }
      out.push("");
    } else if (section.layout === "inline") {
      for (const group of section.groups || []) {
        if (!group.items?.trim()) continue;
        out.push(group.label ? `**${group.label}:** ${escapeMarkdown(group.items)}` : `- ${escapeMarkdown(group.items)}`);
      }
      out.push("");
    } else if (section.layout === "prose") {
      for (const paragraph of (section.body || "").split(/\n{2,}/)) {
        if (paragraph.trim()) out.push(escapeMarkdown(paragraph.trim()), "");
      }
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const absolute = (url) => (/^(https?:|mailto:)/i.test(url) ? url : `https://${url}`);

// only escape what would otherwise change the rendered structure
const escapeMarkdown = (text) => String(text).replace(/^(\s*)([*+->#])/gm, "$1\\$2");
