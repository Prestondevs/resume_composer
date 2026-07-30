import { readZip, decodeUtf8 } from "../lib/zip.js";
import { cleanText, cleanLine } from "../lib/util.js";
import { pickFonts } from "./fonts.js";

// DOCX carries far more structure than PDF: named paragraph styles, real list levels and
// explicit run formatting. Reading it directly from the OOXML keeps that information, which
// makes section detection much more reliable than it can be for PDF

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export async function extractDocx(arrayBuffer, onProgress = () => {}) {
  onProgress(0.2, "Opening document");

  const files = await readZip(arrayBuffer);
  const main = files.get("word/document.xml");
  if (!main) throw new Error("This DOCX is missing its main document part and cannot be read.");

  onProgress(0.45, "Reading content");

  const xml = new DOMParser().parseFromString(decodeUtf8(main), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("The document body could not be parsed.");

  const relationships = parseRelationships(files);
  const body = xml.getElementsByTagNameNS(W, "body")[0];
  if (!body) throw new Error("The document body is empty.");

  const lines = [];
  let tableCount = 0;
  let totalChars = 0;
  const fontUsage = new Map();

  const visit = (node, insideTable) => {
    for (const child of Array.from(node.children)) {
      if (child.namespaceURI !== W) continue;

      if (child.localName === "p") {
        const line = readParagraph(child, relationships, insideTable, fontUsage);
        if (line) {
          totalChars += line.text.length;
          lines.push(line);
        }
      } else if (child.localName === "tbl") {
        tableCount += 1;
        visit(child, true);
      } else if (child.localName === "tr" || child.localName === "tc" || child.localName === "sdt" || child.localName === "sdtContent") {
        visit(child, insideTable);
      }
    }
  };
  visit(body, false);

  onProgress(0.8, "Interpreting layout");

  const sizes = lines.filter((l) => l.size).map((l) => l.size).sort((a, b) => a - b);
  const medianSize = sizes[Math.floor(sizes.length / 2)] || 11;
  for (const line of lines) line.size ||= medianSize;

  // runs that inherit their typeface carry no rFonts of their own, so the
  // document default from styles.xml stands in for them
  const defaultFont = readDefaultFont(files);
  if (defaultFont) {
    const inherited = totalChars - Array.from(fontUsage.values()).reduce((sum, u) => sum + u.chars, 0);
    if (inherited > 0) {
      const usage = fontUsage.get(defaultFont) || { chars: 0, size: medianSize, generic: "" };
      usage.chars += inherited;
      fontUsage.set(defaultFont, usage);
    }
  }

  const fonts = pickFonts(Array.from(fontUsage.entries()).map(([name, usage]) => ({
    name,
    chars: usage.chars,
    size: usage.size,
    generic: usage.generic,
  })));
  if (fonts) fonts.source = "docx";

  return {
    lines,
    meta: {
      pages: Math.max(1, Math.round(totalChars / 3200)),
      chars: totalChars,
      tables: tableCount,
      twoColumn: false,
      scanned: false,
      headerFooterText: readHeadersAndFooters(files),
      fonts,
    },
  };
}

function readDefaultFont(files) {
  const raw = files.get("word/styles.xml");
  if (!raw) return "";
  try {
    const xml = new DOMParser().parseFromString(decodeUtf8(raw), "application/xml");
    const defaults = xml.getElementsByTagNameNS(W, "docDefaults")[0];
    const rFonts = defaults?.getElementsByTagNameNS(W, "rFonts")[0]
      || xml.getElementsByTagNameNS(W, "rFonts")[0];
    return rFonts?.getAttributeNS(W, "ascii") || rFonts?.getAttributeNS(W, "hAnsi") || "";
  } catch {
    return "";
  }
}

function parseRelationships(files) {
  const rels = new Map();
  const raw = files.get("word/_rels/document.xml.rels");
  if (!raw) return rels;
  try {
    const xml = new DOMParser().parseFromString(decodeUtf8(raw), "application/xml");
    for (const node of Array.from(xml.getElementsByTagName("Relationship"))) {
      rels.set(node.getAttribute("Id"), node.getAttribute("Target"));
    }
  } catch { /* relationships are a nicety, not a requirement */ }
  return rels;
}

function readParagraph(paragraph, relationships, insideTable) {
  const properties = paragraph.getElementsByTagNameNS(W, "pPr")[0];
  const styleId = properties?.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") || "";
  const numbering = properties?.getElementsByTagNameNS(W, "numPr")[0];
  const listLevel = numbering
    ? Number(numbering.getElementsByTagNameNS(W, "ilvl")[0]?.getAttributeNS(W, "val") || 0)
    : null;
  const outlineLevel = properties?.getElementsByTagNameNS(W, "outlineLvl")[0]?.getAttributeNS(W, "val");
  const alignment = properties?.getElementsByTagNameNS(W, "jc")[0]?.getAttributeNS(W, "val") || "";

  let text = "";
  let boldChars = 0;
  let totalRunChars = 0;
  let maxSize = 0;
  let allCaps = true;
  let link = "";

  const collectRuns = (node) => {
    for (const child of Array.from(node.children)) {
      if (child.namespaceURI !== W) continue;
      if (child.localName === "hyperlink") {
        const id = child.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
        const target = relationships.get(id);
        if (target && !link) link = target;
        collectRuns(child);
      } else if (child.localName === "r") {
        const runProps = child.getElementsByTagNameNS(W, "rPr")[0];
        const bold = Boolean(runProps?.getElementsByTagNameNS(W, "b")[0])
          && runProps.getElementsByTagNameNS(W, "b")[0].getAttributeNS(W, "val") !== "0";
        const caps = Boolean(runProps?.getElementsByTagNameNS(W, "caps")[0]);
        const halfPoints = Number(runProps?.getElementsByTagNameNS(W, "sz")[0]?.getAttributeNS(W, "val") || 0);
        if (halfPoints) maxSize = Math.max(maxSize, halfPoints / 2);

        let runText = "";
        for (const part of Array.from(child.children)) {
          if (part.namespaceURI !== W) continue;
          if (part.localName === "t") runText += part.textContent;
          else if (part.localName === "tab") runText += "\t";
          else if (part.localName === "br" || part.localName === "cr") runText += "\n";
          else if (part.localName === "noBreakHyphen") runText += "-";
        }

        if (runText.trim()) {
          totalRunChars += runText.length;
          if (bold || caps) boldChars += runText.length;
          if (!/^[^a-z]*$/.test(runText)) allCaps = false;
        }
        text += runText;
      }
    }
  };
  collectRuns(paragraph);

  const clean = cleanLine(text).replace(/\n+/g, " ").trim();
  if (!clean) return null;

  const isHeadingStyle = /^heading[1-4]$/i.test(styleId) || outlineLevel != null && Number(outlineLevel) < 3;

  return {
    text: clean,
    size: maxSize || 0,
    bold: totalRunChars > 0 && boldChars / totalRunChars > 0.6,
    allCaps: allCaps && clean.length > 2,
    listLevel,
    styleHeading: isHeadingStyle,
    centered: alignment === "center",
    insideTable,
    link,
    x: 0,
    gapAbove: 0,
  };
}

function readHeadersAndFooters(files) {
  const parts = [];
  for (const [name, bytes] of files) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue;
    try {
      const xml = new DOMParser().parseFromString(decodeUtf8(bytes), "application/xml");
      const text = cleanText(xml.documentElement.textContent).trim();
      if (text) parts.push(text);
    } catch { /* ignore unreadable parts */ }
  }
  return parts.join(" ");
}
