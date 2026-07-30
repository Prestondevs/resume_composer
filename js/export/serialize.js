// markdown and plain-text serialisation
// the plain-text form doubles as the ATS preview, so it deliberately mirrors what a naive
// parser would pull out of the PDF: headings on their own line, no decorative characters, dates
// written out

const visibleSections = (doc) => doc.sections.filter((section) => section.visible);

const dateRange = (item) => [item.start, item.end].filter(Boolean).join(" - ");

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
        const head = [item.title, item.org].filter(Boolean).join(", ");
        const tail = [dateRange(item), item.location].filter(Boolean).join(" | ");
        if (head || tail) out.push([head, tail].filter(Boolean).join("   "));
        if (item.meta) out.push(item.meta);
        if (item.link) out.push(item.link);
        for (const bullet of item.bullets || []) out.push(...wrap(`- ${bullet}`, width, "  "));
        out.push("");
      }
    } else if (section.layout === "bullets") {
      for (const line of section.bullets || []) {
        if (line.trim()) out.push(...wrap(`- ${line}`, width, "  "));
      }
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
        const heading = [item.title && `**${item.title}**`, item.org].filter(Boolean).join(", ");
        const aside = [dateRange(item), item.location].filter(Boolean).join(" · ");
        if (heading || aside) out.push([heading, aside && `*${aside}*`].filter(Boolean).join("  \n"));
        if (item.meta) out.push(item.meta);
        if (item.link) out.push(`[${item.link.replace(/^https?:\/\//, "")}](${absolute(item.link)})`);
        if (item.bullets?.length) {
          out.push("");
          for (const bullet of item.bullets) out.push(`- ${escapeMarkdown(bullet)}`);
        }
        out.push("");
      }
    } else if (section.layout === "bullets") {
      for (const line of section.bullets || []) {
        if (line.trim()) out.push(`- ${escapeMarkdown(line)}`);
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
