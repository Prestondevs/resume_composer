import { cleanText, cleanLine } from "../lib/util.js";
import { pickFonts } from "./fonts.js";

// PDF text is a bag of positioned glyph runs with no notion of lines, columns or headings
// Recovering those is most of the work: we cluster runs into lines by baseline, look for a
// vertical gutter to detect two-column layouts, and keep per-line font size and weight so the
// section parser can tell a heading from a job title

let pdfjs = null;

// loaded on demand so the app starts without paying for a 600 KB parser, and named .js rather
// than .mjs because several static hosts (and Python's http.server, which is what most people
// reach for locally) do not map .mjs to a JavaScript MIME type, and modules are rejected
// without one
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import("../../vendor/pdfjs/pdf.js");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../vendor/pdfjs/pdf.worker.js", import.meta.url).href;
  return pdfjs;
}

export async function extractPdf(arrayBuffer, onProgress = () => {}) {
  const lib = await loadPdfjs();

  let pdf;
  try {
    pdf = await lib.getDocument({
      data: arrayBuffer,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
    }).promise;
  } catch (error) {
    if (/password/i.test(error?.message || "")) {
      throw new Error("This PDF is password protected. Remove the password and try again.");
    }
    throw new Error("This file could not be opened as a PDF. It may be corrupted or incomplete.");
  }

  const lines = [];
  const pageCount = pdf.numPages;
  let totalChars = 0;
  let twoColumnPages = 0;
  let hasVectorContent = false;
  let centeredHeader = false;
  const fontUsage = new Map();

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    onProgress(0.15 + (0.65 * (pageNumber - 1)) / pageCount, `Reading page ${pageNumber} of ${pageCount}`);

    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ includeMarkedContent: false });

    const runs = [];
    for (const item of content.items) {
      const text = item.str;
      if (!text || !item.transform) continue;
      const [scaleX, , , scaleY, x, y] = item.transform;
      const size = Math.abs(scaleY) || Math.abs(scaleX) || 10;
      if (!text.trim()) {
        // whitespace-only runs still mark a gap between words
        runs.push({ text: " ", x, y, width: item.width || 0, size, bold: false, blank: true });
        continue;
      }
      totalChars += text.trim().length;

      if (item.fontName) {
        const usage = fontUsage.get(item.fontName) || { chars: 0, size: 0, generic: "" };
        usage.chars += text.trim().length;
        usage.size = Math.max(usage.size, size);
        usage.generic ||= content.styles?.[item.fontName]?.fontFamily || "";
        fontUsage.set(item.fontName, usage);
      }

      runs.push({
        text,
        x,
        y,
        width: item.width || text.length * size * 0.5,
        size,
        bold: /bold|black|heavy|semibold|-bd|,bold/i.test(item.fontName || ""),
        blank: false,
      });
    }

    // real font names only become available once the page's font objects are
    // resolved, which getOperatorList does. Page one is enough: resumes do not
    // change typeface halfway through, and this is the expensive call
    if (pageNumber === 1) await resolveFontNames(page, fontUsage);

    if (!runs.some((run) => !run.blank)) {
      const ops = await page.getOperatorList().catch(() => null);
      if (ops && ops.fnArray?.length > 6) hasVectorContent = true;
      page.cleanup();
      continue;
    }

    const pageLines = buildLines(runs);
    const columns = detectColumns(pageLines, viewport.width);
    if (columns) twoColumnPages += 1;

    if (pageNumber === 1) centeredHeader = detectCenteredHeader(pageLines, viewport.width);

    const ordered = columns ? orderByColumn(pageLines, columns) : pageLines;
    for (const line of ordered) {
      line.page = pageNumber;
      lines.push(line);
    }

    page.cleanup();
  }

  onProgress(0.85, "Interpreting layout");

  const fonts = pickFonts(Array.from(fontUsage.values()).map((usage) => ({
    name: usage.realName || "",
    chars: usage.chars,
    size: usage.size,
    generic: usage.generic,
  })));
  if (fonts) fonts.source = "pdf";

  const meta = {
    pages: pageCount,
    chars: totalChars,
    twoColumn: twoColumnPages > 0,
    scanned: totalChars < Math.max(40, pageCount * 60),
    hasVectorContent,
    centeredHeader,
    fonts,
  };

  await pdf.destroy();
  return { lines: dropRepeatedHeaders(lines, pageCount), meta };
}

// a centred name and contact block is a deliberate design choice, so the layout picked for the
// imported document should match it. measured from geometry rather than guessed from the text
function detectCenteredHeader(pageLines, pageWidth) {
  if (!pageWidth || pageLines.length < 3) return false;

  const header = pageLines.slice(0, 5).filter((line) => line.right > line.x);
  if (header.length < 2) return false;

  const middle = pageWidth / 2;
  let centred = 0;
  for (const line of header) {
    const width = line.right - line.x;
    if (width > pageWidth * 0.85) continue; // a full width line tells us nothing
    const offset = Math.abs((line.x + line.right) / 2 - middle);
    const leftGap = line.x;
    const rightGap = pageWidth - line.right;
    if (offset < pageWidth * 0.06 && leftGap > pageWidth * 0.08 && rightGap > pageWidth * 0.08) centred += 1;
  }
  return centred >= 2 && centred >= header.length - 1;
}

async function resolveFontNames(page, fontUsage) {
  try {
    await page.getOperatorList();
  } catch {
    return; // Text still imported fine; we just keep the generic family.
  }
  for (const [id, usage] of fontUsage) {
    try {
      const font = page.commonObjs.get(id);
      if (font?.name) usage.realName = font.name;
      if (font?.fallbackName) usage.generic = font.fallbackName;
    } catch {
      // font object not resolved for this id; the generic family still applies
    }
  }
}

// groups runs sharing a baseline into a single line of text
function buildLines(runs) {
  const sizes = runs.filter((r) => !r.blank).map((r) => r.size).sort((a, b) => a - b);
  const medianSize = sizes[Math.floor(sizes.length / 2)] || 10;
  const tolerance = Math.max(2, medianSize * 0.42);

  const buckets = [];
  for (const run of runs) {
    const bucket = buckets.find((b) => Math.abs(b.y - run.y) <= tolerance);
    if (bucket) {
      bucket.runs.push(run);
      // track the dominant baseline so long lines do not drift
      bucket.y = (bucket.y * (bucket.runs.length - 1) + run.y) / bucket.runs.length;
    } else {
      buckets.push({ y: run.y, runs: [run] });
    }
  }

  buckets.sort((a, b) => b.y - a.y);

  return buckets.map((bucket) => {
    const ordered = bucket.runs.sort((a, b) => a.x - b.x);
    const visible = ordered.filter((run) => !run.blank);
    if (!visible.length) return null;

    let text = "";
    let previous = null;
    for (const run of ordered) {
      if (run.blank) {
        if (text && !text.endsWith(" ")) text += " ";
        continue;
      }
      if (previous) {
        const gap = run.x - (previous.x + previous.width);
        const spaceWidth = previous.size * 0.22;
        if (gap > spaceWidth * 8) text += "\t";        // column-ish gap inside a line
        else if (gap > spaceWidth && !text.endsWith(" ")) text += " ";
      }
      text += run.text;
      previous = run;
    }

    const boldWidth = visible.filter((r) => r.bold).reduce((sum, r) => sum + r.width, 0);
    const totalWidth = visible.reduce((sum, r) => sum + r.width, 0) || 1;
    const left = Math.min(...visible.map((r) => r.x));
    const right = Math.max(...visible.map((r) => r.x + r.width));

    return {
      text: cleanLine(text).trim(),
      size: Math.max(...visible.map((r) => r.size)),
      bold: boldWidth / totalWidth > 0.6,
      x: left,
      right,
      y: bucket.y,
      gapAbove: 0,
    };
  }).filter((line) => line && line.text).map((line, index, all) => {
    const previous = all[index - 1];
    line.gapAbove = previous ? Math.max(0, previous.y - line.y - line.size) : 0;
    return line;
  });
}

// finds a vertical gutter that no line crosses. Two-column resumes are common and reading them
// left-to-right across the gutter destroys the content, so this is worth getting right
function detectColumns(lines, pageWidth) {
  if (lines.length < 12 || !pageWidth) return null;

  const body = lines.filter((line) => line.right - line.x > 4);
  if (body.length < 10) return null;

  let best = null;
  for (let ratio = 0.28; ratio <= 0.72; ratio += 0.02) {
    const split = pageWidth * ratio;
    let crossing = 0;
    let left = 0;
    let right = 0;
    for (const line of body) {
      if (line.x < split - 2 && line.right > split + 2) crossing += 1;
      else if (line.right <= split) left += 1;
      else right += 1;
    }
    if (crossing > body.length * 0.04) continue;
    if (left < 4 || right < 4) continue;
    const balance = Math.min(left, right) / Math.max(left, right);
    const score = balance - crossing * 0.05;
    if (!best || score > best.score) best = { split, score, left, right };
  }

  return best && best.score > 0.18 ? best : null;
}

// reads the narrower column first only when it is clearly a side rail
function orderByColumn(lines, columns) {
  const left = lines.filter((line) => line.right <= columns.split);
  const right = lines.filter((line) => line.right > columns.split);
  const header = lines.filter((line) => line.x < columns.split && line.right > columns.split);

  for (const line of left) line.column = 0;
  for (const line of right) line.column = 1;
  for (const line of header) line.column = null;

  const topHeader = header.filter((line) => line.y >= (lines[0]?.y ?? 0) - 80);
  return [...topHeader, ...left, ...right];
}

// multi-page resumes often repeat a name or page number on every page. Those lines confuse
// section detection, so drop text that appears on most pages at a similar position
function dropRepeatedHeaders(lines, pageCount) {
  if (pageCount < 2) return lines;

  const counts = new Map();
  for (const line of lines) {
    const key = line.text.replace(/\d+/g, "#").toLowerCase();
    if (key.length < 3 || key.length > 70) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const repeated = new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count >= pageCount && pageCount > 1)
      .map(([key]) => key),
  );
  if (!repeated.size) return lines;

  let firstSeen = new Set();
  return lines.filter((line) => {
    const key = line.text.replace(/\d+/g, "#").toLowerCase();
    if (!repeated.has(key)) return true;
    if (firstSeen.has(key)) return false;
    firstSeen.add(key);
    return true;
  });
}
