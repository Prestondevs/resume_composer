import { writeZip } from "../lib/zip.js";
import { escapeXml } from "../lib/util.js";
import { PAGE_SIZES, MARGINS, fontChoice } from "../schema.js";

// writes a real .docx rather than an HTML file with a Word extension
// a DOCX is a ZIP of OOXML parts, so this builds the six parts Word needs and hands them to the
// ZIP writer. Everything uses named styles and a genuine numbering definition, which is what
// keeps the file editable in Word and readable by applicant tracking systems

const TWIPS_PER_INCH = 1440;
const inches = (value) => Math.round(value * TWIPS_PER_INCH);

// detail lines are stored newline separated so each becomes its own paragraph
const metaLines = (item) => String(item.meta || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);

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

// a bullet whose source carried a trailing column is rebuilt with a real right tab stop, so Word
// sets the dates against the margin instead of running them into the text
function bulletParagraph(line, contentWidth) {
  const at = String(line).indexOf("\t");
  if (at === -1) {
    return paragraph({ style: "ListBullet", numbered: true, runs: [{ text: line }] });
  }
  return paragraph({
    style: "ListBullet",
    numbered: true,
    tabs: [{ align: "right", pos: contentWidth }],
    runs: [
      { text: line.slice(0, at).trim() },
      { tab: true },
      { text: line.slice(at + 1).trim(), italic: true },
    ],
  });
}

const FONT_STACKS = {
  minimal: { body: "Georgia", display: "Georgia" },
  professional: { body: "Georgia", display: "Calibri" },
  executive: { body: "Georgia", display: "Calibri" },
  technical: { body: "Calibri", display: "Calibri" },
  business: { body: "Georgia", display: "Georgia" },
  compact: { body: "Calibri", display: "Calibri" },
  academic: { body: "Palatino Linotype", display: "Palatino Linotype" },
  government: { body: "Arial", display: "Arial" },
  healthcare: { body: "Georgia", display: "Calibri" },
  legal: { body: "Times New Roman", display: "Times New Roman" },
  creative: { body: "Calibri", display: "Calibri" },
  ats: { body: "Arial", display: "Arial" },
  sidebar: { body: "Calibri", display: "Calibri" },
};

// Word needs one real family name, not a CSS stack, and it cannot use a font the reader does not
// have. so an explicit choice is passed straight through, an imported font only if Word is likely
// to know it, and anything else falls back on the generic class it belongs to
const WORD_SAFE = /^(arial|helvetica|calibri|segoe ui|verdana|tahoma|trebuchet ms|times new roman|georgia|cambria|garamond|palatino( linotype)?|book antiqua|consolas|courier new|century gothic|franklin gothic|candara|constantia|corbel|charter|baskerville)$/i;

function docxFonts(doc) {
  const chosen = fontChoice(doc.settings.fontOverride);
  if (chosen) return { body: chosen.label, display: chosen.label };

  const imported = doc.settings.keepFonts !== false ? doc.settings.fonts : null;
  if (imported?.body) {
    const pick = (face) => {
      if (!face) return null;
      if (WORD_SAFE.test(face.label)) return face.label;
      if (WORD_SAFE.test(face.name)) return face.name;
      return face.generic === "serif" ? "Times New Roman" : face.generic === "monospace" ? "Courier New" : "Arial";
    };
    const body = pick(imported.body);
    return { body, display: pick(imported.display) || body };
  }

  return FONT_STACKS[doc.template] || FONT_STACKS.minimal;
}

export async function toDocx(doc) {
  const size = PAGE_SIZES[doc.settings.pageSize] || PAGE_SIZES.letter;
  const margin = MARGINS[doc.settings.margin] || MARGINS.normal;
  const fonts = docxFonts(doc);
  const contentWidth = inches(size.width - margin.x * 2);

  const body = [];
  for (const section of doc.sections.filter((s) => s.visible)) {
    body.push(...renderSection(section, contentWidth, doc));
  }

  const sectPr = `<w:sectPr>`
    + `<w:pgSz w:w="${inches(size.width)}" w:h="${inches(size.height)}"/>`
    + `<w:pgMar w:top="${inches(margin.y)}" w:right="${inches(margin.x)}" w:bottom="${inches(margin.y)}" w:left="${inches(margin.x)}" w:header="0" w:footer="0" w:gutter="0"/>`
    + `<w:cols w:space="708"/>`
    + `<w:docGrid w:linePitch="360"/>`
    + `</w:sectPr>`;

  const document = xmlHeader()
    + `<w:document ${NAMESPACES}><w:body>${body.join("")}${sectPr}</w:body></w:document>`;

  return writeZip([
    { name: "[Content_Types].xml", data: contentTypes() },
    { name: "_rels/.rels", data: rootRels() },
    { name: "word/document.xml", data: document },
    { name: "word/styles.xml", data: styles(fonts, doc) },
    { name: "word/numbering.xml", data: numbering() },
    { name: "word/_rels/document.xml.rels", data: documentRels() },
    { name: "docProps/core.xml", data: coreProps(doc) },
  ]);
}

// content

function renderSection(section, contentWidth, doc) {
  if (section.layout === "contact") return renderContact(section.contact || {});

  const out = [paragraph({ style: "SectionHeading", runs: [{ text: section.title.toUpperCase() }] })];

  if (section.layout === "entries") {
    for (const item of section.items || []) {
      const dates = [item.start, item.end].filter(Boolean).join(" - ");
      const tabs = [{ align: "right", pos: contentWidth }];
      const rowOf = (lead, tail, italicTail) => {
        const runs = [];
        if (lead) runs.push({ text: lead, bold: true });
        if (tail) { runs.push({ tab: true }); runs.push({ text: tail, italic: italicTail }); }
        return runs.length ? paragraph({ style: "EntryHead", runs, tabs }) : null;
      };

      // the same two rows the page uses, so Word matches the preview
      const rows = item.org
        ? [rowOf(item.org, item.location, true), rowOf(item.title, dates, true)]
        : [rowOf(item.title, dates || item.location, true), dates && item.location ? rowOf("", item.location, true) : null];
      for (const row of rows) if (row) out.push(row);

      for (const line of governmentLines(item, doc)) {
        out.push(paragraph({ style: "EntryMeta", runs: [{ text: line }] }));
      }
      for (const detail of metaLines(item)) {
        out.push(paragraph({ style: "EntryMeta", runs: [{ text: detail }] }));
      }
      if (item.link) out.push(paragraph({ style: "EntryMeta", runs: [{ text: item.link }] }));
      for (const bullet of item.bullets || []) {
        if (bullet.trim()) out.push(bulletParagraph(bullet, contentWidth));
      }
      out.push(paragraph({ style: "Spacer", runs: [] }));
    }
    if (out[out.length - 1]?.includes('w:val="Spacer"')) out.pop();
  } else if (section.layout === "bullets") {
    for (const line of section.bullets || []) {
      if (line.trim()) out.push(bulletParagraph(line, contentWidth));
    }
  } else if (section.layout === "inline") {
    for (const group of section.groups || []) {
      if (!group.items?.trim()) continue;
      const runs = [];
      if (group.label) runs.push({ text: `${group.label}: `, bold: true });
      runs.push({ text: group.items });
      out.push(paragraph({ style: "BodyText", runs }));
    }
  } else if (section.layout === "prose") {
    for (const part of (section.body || "").split(/\n{2,}/)) {
      if (part.trim()) out.push(paragraph({ style: "BodyText", runs: [{ text: part.trim() }] }));
    }
  }

  out.push(paragraph({ style: "Spacer", runs: [] }));
  return out;
}

function renderContact(contact) {
  const out = [];
  if (contact.name) out.push(paragraph({ style: "Name", runs: [{ text: contact.name }] }));
  if (contact.headline) out.push(paragraph({ style: "Headline", runs: [{ text: contact.headline }] }));

  const bits = [contact.email, contact.phone, contact.location].filter(Boolean);
  for (const link of contact.links || []) {
    if (link.url) bits.push(link.label ? `${link.label}: ${stripScheme(link.url)}` : stripScheme(link.url));
  }
  if (bits.length) out.push(paragraph({ style: "ContactLine", runs: [{ text: bits.join("  |  ") }] }));
  out.push(paragraph({ style: "Spacer", runs: [] }));
  return out;
}

const stripScheme = (url) => String(url).replace(/^https?:\/\//i, "").replace(/\/$/, "");

function paragraph({ style, runs, numbered = false, tabs = [] }) {
  const properties = [`<w:pStyle w:val="${style}"/>`];
  if (numbered) properties.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
  if (tabs.length) {
    properties.push(`<w:tabs>${tabs.map((tab) => `<w:tab w:val="${tab.align}" w:pos="${tab.pos}"/>`).join("")}</w:tabs>`);
  }

  const content = runs.map((run) => {
    if (run.tab) return "<w:r><w:tab/></w:r>";
    const runProps = [];
    if (run.bold) runProps.push("<w:b/>");
    if (run.italic) runProps.push("<w:i/>");
    const rPr = runProps.length ? `<w:rPr>${runProps.join("")}</w:rPr>` : "";
    // xml:space preserve keeps the separators between runs intact
    return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`;
  }).join("");

  return `<w:p><w:pPr>${properties.join("")}</w:pPr>${content}</w:p>`;
}

// package parts

const NAMESPACES = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const xmlHeader = () => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const contentTypes = () => xmlHeader()
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
  + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
  + '</Types>';

const rootRels = () => xmlHeader()
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
  + '</Relationships>';

const documentRels = () => xmlHeader()
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
  + '</Relationships>';

function coreProps(doc) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const author = doc.sections.find((s) => s.type === "contact")?.contact?.name || "";
  return xmlHeader()
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
    + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
    + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${escapeXml(doc.name)}</dc:title>`
    + `<dc:creator>${escapeXml(author)}</dc:creator>`
    + `<cp:lastModifiedBy>${escapeXml(author)}</cp:lastModifiedBy>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>`
    + `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>`
    + '</cp:coreProperties>';
}

function styles(fonts, doc) {
  const base = Math.round((doc.settings.scale || 1) * 10 * 2); // half-points
  const style = (id, name, definition) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${definition}</w:style>`;

  return xmlHeader()
    + `<w:styles ${NAMESPACES}>`
    + '<w:docDefaults><w:rPrDefault><w:rPr>'
    + `<w:rFonts w:ascii="${fonts.body}" w:hAnsi="${fonts.body}" w:cs="${fonts.body}"/>`
    + `<w:sz w:val="${base}"/><w:szCs w:val="${base}"/><w:color w:val="14161A"/>`
    + '</w:rPr></w:rPrDefault>'
    + '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
    + '</w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'

    + style("Name", "Name",
      `<w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:rFonts w:ascii="${fonts.display}" w:hAnsi="${fonts.display}"/><w:b/><w:sz w:val="${base * 2}"/></w:rPr>`)

    + style("Headline", "Headline",
      `<w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:color w:val="3D4249"/><w:sz w:val="${Math.round(base * 1.05)}"/></w:rPr>`)

    + style("ContactLine", "Contact Line",
      '<w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:color w:val="3D4249"/></w:rPr>')

    + style("SectionHeading", "Section Heading",
      '<w:pPr><w:spacing w:before="200" w:after="80"/>'
      + '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="C9CCD1"/></w:pBdr>'
      + `<w:keepNext/></w:pPr><w:rPr><w:rFonts w:ascii="${fonts.display}" w:hAnsi="${fonts.display}"/><w:b/>`
      + `<w:spacing w:val="24"/><w:sz w:val="${Math.round(base * 0.95)}"/></w:rPr>`)

    + style("EntryHead", "Entry Head",
      '<w:pPr><w:spacing w:before="80" w:after="20"/><w:keepNext/></w:pPr>')

    + style("EntryMeta", "Entry Meta",
      `<w:pPr><w:spacing w:after="20"/></w:pPr><w:rPr><w:color w:val="3D4249"/><w:sz w:val="${Math.round(base * 0.94)}"/></w:rPr>`)

    + style("BodyText", "Body Text",
      '<w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:color w:val="3D4249"/></w:rPr>')

    + '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/>'
    + '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
    + '<w:ind w:left="288" w:hanging="216"/><w:spacing w:after="20"/><w:contextualSpacing/></w:pPr>'
    + '<w:rPr><w:color w:val="3D4249"/></w:rPr></w:style>'

    + style("Spacer", "Spacer", '<w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr>')
    + '</w:styles>';
}

function numbering() {
  return xmlHeader()
    + `<w:numbering ${NAMESPACES}>`
    + '<w:abstractNum w:abstractNumId="0">'
    + '<w:multiLevelType w:val="hybridMultilevel"/>'
    + '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>'
    + '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="288" w:hanging="216"/></w:pPr>'
    + '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>'
    + '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="○"/>'
    + '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="576" w:hanging="216"/></w:pPr>'
    + '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:hint="default"/></w:rPr></w:lvl>'
    + '</w:abstractNum>'
    + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
    + '</w:numbering>';
}
