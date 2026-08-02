let idCounter = 0;

export function uid(prefix = "s") {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function debounce(fn, wait) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  wrapped.flush = (...args) => { clearTimeout(timer); fn(...args); };
  return wrapped;
}

// coalesces repeated calls into one run per frame. a hidden document does not paint, so its
// animation frames never arrive; without the timer the first queued call would never run and
// every later one would be dropped as already queued, leaving the view frozen for good
export function throttleFrame(fn) {
  let queued = false;
  let lastArgs;
  let frame = 0;
  let timer = 0;
  const run = () => {
    if (!queued) return;
    queued = false;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    fn(...lastArgs);
  };
  const wrapped = (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    frame = requestAnimationFrame(run);
    timer = setTimeout(run, 120);
  };
  wrapped.flush = () => run();
  wrapped.cancel = () => {
    queued = false;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
  return wrapped;
}

export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const escapeXml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

// these classes are built from codepoints rather than written as literals. Most of the
// characters are invisible in an editor, and two of them (the line and paragraph separators)
// are line terminators that would silently break the regular expression they appear in
const chars = (...codes) => codes.map((code) => String.fromCodePoint(code)).join("");
const range = (from, to) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;

const NBSP = new RegExp(`[${chars(0x00a0, 0x2007, 0x202f)}]`, "g");
const INVISIBLE = new RegExp(
  `[${range(0x00, 0x08)}${chars(0x0b, 0x0c)}${range(0x0e, 0x1f)}${range(0x200b, 0x200f)}${chars(0x2028, 0x2029, 0xfeff)}]`,
  "g",
);
const HYPHENS = new RegExp(`[${chars(0x2010, 0x2011, 0x2012, 0x2043)}]`, "g");
const DASHES = new RegExp(`[${chars(0x2013, 0x2014)}]`, "g");
const SINGLE_QUOTES = new RegExp(`[${chars(0x2018, 0x2019, 0x201b, 0x2032)}]`, "g");
const DOUBLE_QUOTES = new RegExp(`[${chars(0x201c, 0x201d, 0x2033)}]`, "g");
const ELLIPSIS = new RegExp(chars(0x2026), "g");
const COMBINING_MARKS = new RegExp(`[${range(0x0300, 0x036f)}]`, "g");
// every dash variant folds to a plain hyphen, so imported text does not smuggle typographic
// dashes into a document this app then exports
function normalizeGlyphs(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(NBSP, " ")
    .replace(INVISIBLE, "")
    .replace(HYPHENS, "-")
    .replace(DASHES, "-")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(ELLIPSIS, "...");
}

// normalizes the whitespace, dashes, quotes and control characters that PDF and DOCX extraction
// routinely leave behind
export function cleanText(value) {
  return normalizeGlyphs(value)
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ {2,}/g, " ");
}

// the same normalization except tabs survive. the extractors insert a tab wherever the source had
// a column gap and the section parser reads those as field separators, so flattening them would
// merge a job title, its dates and its location into one string
export function cleanLine(value) {
  return normalizeGlyphs(value)
    .replace(/[\f\v]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/ *\t */g, "\t")
    .replace(/\t{2,}/g, "\t");
}

export const titleCase = (value) =>
  String(value ?? "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function formatRelative(timestamp) {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 45000) return "just now";
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "resume";
}

export const deepClone = (value) =>
  typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// case-insensitive subsequence match used by the palette and section search. Returns null when
// there is no match, otherwise a score plus hit indices
export function fuzzyMatch(query, target) {
  const text = String(target ?? "");
  if (!query) return { score: 0, hits: [] };
  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();

  const direct = haystack.indexOf(needle);
  if (direct !== -1) {
    const hits = [];
    for (let i = 0; i < needle.length; i += 1) hits.push(direct + i);
    return { score: 1000 - direct * 2 - (text.length - needle.length) * 0.1, hits };
  }

  const hits = [];
  let cursor = 0;
  let score = 0;
  let streak = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return null;
    streak = found === cursor && cursor > 0 ? streak + 1 : 0;
    score += 10 + streak * 5 - Math.min(found - cursor, 12);
    if (found === 0 || /[\s\-_/]/.test(haystack[found - 1])) score += 12;
    hits.push(found);
    cursor = found + 1;
  }
  return { score, hits };
}

// wraps matched characters in <mark> for palette results. Escapes first
export function highlight(text, hits) {
  if (!hits?.length) return escapeHtml(text);
  const set = new Set(hits);
  let out = "";
  let open = false;
  for (let i = 0; i < text.length; i += 1) {
    const isHit = set.has(i);
    if (isHit && !open) { out += "<mark>"; open = true; }
    if (!isHit && open) { out += "</mark>"; open = false; }
    out += escapeHtml(text[i]);
  }
  return open ? `${out}</mark>` : out;
}

const WORD_PATTERN = new RegExp(`[\\p{L}\\p{N}][\\p{L}\\p{N}'${chars(0x2019)}\\-]*`, "gu");

export function countWords(text) {
  const matches = String(text ?? "").match(WORD_PATTERN);
  return matches ? matches.length : 0;
}

// resolves once the browser is idle, with a hard deadline so slow devices still make progress
export function whenIdle(timeout = 200) {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(resolve, { timeout });
    else setTimeout(resolve, 0);
  });
}
