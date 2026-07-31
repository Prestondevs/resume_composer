import { cleanText } from "../lib/util.js";

// plain text and Markdown share a reader. Markdown gives us explicit heading and list markers,
// which map straight onto the signals the section parser already uses for PDF and DOCX

export function extractText(source, { markdown = false } = {}) {
  const raw = cleanText(source).split("\n");
  const lines = [];
  let inCodeFence = false;
  let totalChars = 0;
  let blankRun = 0;

  for (const original of raw) {
    let text = original;

    if (markdown) {
      if (/^\s*(```|~~~)/.test(text)) { inCodeFence = !inCodeFence; continue; }
      if (inCodeFence) continue;
      if (/^\s*(\|.*\|)\s*$/.test(text) && /^\s*\|[\s:|-]+\|\s*$/.test(text)) continue;
    }

    if (!text.trim()) { blankRun += 1; continue; }

    let styleHeading = false;
    let listLevel = null;
    let bold = false;
    let indent = text.match(/^\s*/)[0].length;

    if (markdown) {
      const heading = text.match(/^\s{0,3}(#{1,4})\s+(.*)$/);
      if (heading) {
        // a single hash is the document title, which on a resume is the person's name. only the
        // deeper levels are section headings, so an h1 is left to the contact reader
        styleHeading = heading[1].length > 1;
        text = heading[2];
      }
      const bullet = text.match(/^(\s*)[-*+]\s+(.*)$/);
      if (bullet) {
        listLevel = Math.floor(bullet[1].length / 2);
        text = bullet[2];
      }
      const numbered = text.match(/^(\s*)\d+[.)]\s+(.*)$/);
      if (!bullet && numbered) {
        listLevel = Math.floor(numbered[1].length / 2);
        text = numbered[2];
      }
      if (/^\*\*.+\*\*:?$/.test(text.trim())) bold = true;
      text = text
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/(^|\W)\*(?!\s)(.+?)(?<!\s)\*(?=\W|$)/g, "$1$2")
        .replace(/(^|\W)_(?!\s)(.+?)(?<!\s)_(?=\W|$)/g, "$1$2")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => (label.trim() === url.trim() ? url : `${label} (${url})`))
        .replace(/^>\s?/, "");
      if (/^\s*([-*_])\1{2,}\s*$/.test(text)) continue;
    } else {
      const bullet = text.match(/^(\s*)[•▪◦‣·*+•▪●-]\s+(.*)$/);
      if (bullet) {
        listLevel = Math.floor(bullet[1].length / 2);
        text = bullet[2];
      }
      if (/^[^a-z]{3,}$/.test(text.trim()) && text.trim().length < 46) bold = true;
    }

    text = cleanText(text).trim();
    if (!text) { blankRun += 1; continue; }

    totalChars += text.length;
    lines.push({
      text,
      size: 0,
      bold,
      allCaps: /^[^a-z]{3,}$/.test(text) && text.length < 46,
      listLevel,
      styleHeading,
      x: indent,
      gapAbove: blankRun > 0 ? 12 : 0,
    });
    blankRun = 0;
  }

  return {
    lines,
    meta: { pages: Math.max(1, Math.round(totalChars / 3200)), chars: totalChars, twoColumn: false, scanned: false },
  };
}
