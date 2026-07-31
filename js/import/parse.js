import { SECTION_TYPES, createSection, createItem, createContact, createDocument } from "../schema.js";
import { uid, cleanText, cleanLine, titleCase } from "../lib/util.js";

// turns a flat list of extracted lines into structured sections
// three signals drive the whole thing: what a line says, how it is formatted (bold, size, list
// level, explicit heading style), and how it sits relative to its neighbours. Every decision
// records a confidence so the UI can flag the parts a human should check rather than pretending
// it got everything right

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?";
const SEASON = "(?:spring|summer|fall|autumn|winter)";
const YEAR = "(?:19|20)\\d{2}";
const NOW = "(?:present|current|now|ongoing|to date)";
const DATE_TOKEN = `(?:(?:${MONTH}|${SEASON})[\\s.,]*${YEAR}|\\d{1,2}[/.-]${YEAR}|${MONTH}[\\s.,]*'\\d{2}|${YEAR}|${NOW})`;
// dash and bullet glyphs are built from codepoints so no exotic dash characters sit in
// this file, while imported resumes that use them still parse
const chars = (...codes) => codes.map((code) => String.fromCodePoint(code)).join("");
// the ASCII hyphen is escaped so DASHES stays safe anywhere inside a character class
const DASHES = chars(0x2010, 0x2011, 0x2012, 0x2013, 0x2014) + "\\-";
const BULLETS = chars(0x2022, 0x25aa, 0x25e6, 0x2023, 0x00b7, 0x2219, 0x2043, 0x25cf, 0x25cb);
const EDGE_PUNCT_SOURCE = `^[|,;${DASHES}]+|[|,;${DASHES}]+$`;
const SEPARATORS = chars(0x2022, 0x00b7, 0x2219, 0x2027);

const EDGE_PUNCT = new RegExp(EDGE_PUNCT_SOURCE, "g");

const DATE_RANGE = new RegExp(
  `(${DATE_TOKEN})\\s*(?:[${DASHES}]|to|through|until)\\s*(${DATE_TOKEN})`,
  "i",
);
const SINGLE_DATE = new RegExp(`^\\s*(${DATE_TOKEN})\\s*$`, "i");
const HAS_DATE = new RegExp(DATE_TOKEN, "i");

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const URL = /(?:https?:\/\/|www\.)[^\s,;|]+|(?:[\w-]+\.)+(?:com|org|net|io|dev|me|co|uk|edu|gov|ai|app|tech|design|xyz)(?:\/[^\s,;|]*)?/i;
const BULLET_PREFIX = new RegExp(`^\\s*[${BULLETS}${DASHES}*+]\\s+`);
const LOCATION_TAIL = /,\s*(?:[A-Z]{2}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*$/;
const REMOTE = /^(?:remote|hybrid|on-?site|virtual)$/i;
// lines that describe an entry rather than name an organisation
const DETAIL_LINE = /^(?:cumulative\s+)?(?:gpa|cgpa|grade|honou?rs|dean|major|minor|concentration|coursework|relevant\s+coursework|tech|stack|tools|technologies|skills|languages|advisor|supervisor|thesis)\b/i;

const normalizeHeading = (value) =>
  String(value ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

// headings appear in both numbers ("Involvement" and "Involvements"), so every alias is indexed
// with and without trailing plurals rather than listing each form by hand
const depluralize = (value) => value.replace(/\b(\w{4,})s\b/g, "$1");

const ALIAS_INDEX = buildAliasIndex();

function buildAliasIndex() {
  const index = new Map();
  const add = (text, type) => {
    const key = normalizeHeading(text);
    if (!key) return;
    if (!index.has(key)) index.set(key, type);
    const singular = depluralize(key);
    if (singular !== key && !index.has(singular)) index.set(singular, type);
  };
  for (const [type, info] of Object.entries(SECTION_TYPES)) {
    for (const alias of info.aliases) add(alias, type);
    add(info.label, type);
  }
  return index;
}

// looks a heading up in both the form given and its singular
const lookupAlias = (normalized) => ALIAS_INDEX.get(normalized) || ALIAS_INDEX.get(depluralize(normalized));

export function parseResume(extraction, { fileName = "" } = {}) {
  const lines = (extraction.lines || []).filter((line) => line.text?.trim());
  const meta = extraction.meta || {};
  const warnings = [];

  if (meta.scanned) {
    warnings.push({
      level: "error",
      title: "No text layer found",
      detail: "This looks like a scanned or image-only file. Run it through OCR first, or paste the text in manually. Nothing was discarded, there was simply nothing to read.",
    });
  }
  if (!lines.length) {
    return { doc: emptyDocument(fileName), warnings };
  }
  if (meta.twoColumn) {
    warnings.push({
      level: "info",
      title: "Two-column layout detected",
      detail: "Columns were read separately, left rail first. Check that entries landed under the right headings.",
    });
  }
  if (meta.tables) {
    warnings.push({
      level: "warn",
      title: `${meta.tables} table${meta.tables > 1 ? "s" : ""} flattened`,
      detail: "Applicant tracking systems often mangle tables. The content was kept, but review the order.",
    });
  }

  const headingFlags = scoreHeadings(lines);
  const firstHeading = headingFlags.findIndex(Boolean);
  const preamble = lines.slice(0, firstHeading === -1 ? Math.min(lines.length, 10) : firstHeading);

  const contact = parseContact(preamble);
  const sections = [createSection("contact", { contact: contact.value, collapsed: false, confidence: contact.confidence })];

  if (contact.leftovers.length && firstHeading !== 0) {
    // text above the first heading that is not contact detail is usually a
    // summary. Keep it rather than dropping it on the floor
    const body = joinWrapped(contact.leftovers);
    if (body.length > 40) {
      sections.push(createSection("summary", { body, confidence: 0.6, note: "Recovered from text above the first heading." }));
    }
  }

  const blocks = [];
  let current = null;
  for (let i = firstHeading === -1 ? lines.length : firstHeading; i < lines.length; i += 1) {
    if (headingFlags[i]) {
      current = { heading: lines[i], lines: [] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(lines[i]);
    }
  }

  if (!blocks.length && firstHeading === -1) {
    warnings.push({
      level: "warn",
      title: "No section headings recognised",
      detail: "Everything was placed in one block so nothing is lost. Split it into sections from the card menu.",
    });
    const rest = lines.slice(preamble.length);
    if (rest.length) {
      sections.push(createSection("custom", {
        title: "Imported content",
        bullets: rest.map((line) => line.text),
        confidence: 0.25,
        note: "Headings could not be detected in this file.",
      }));
    }
  }

  const seenTitles = new Map();
  for (const block of blocks) {
    const section = buildSection(block, warnings);
    if (!section) continue;

    const key = normalizeHeading(section.title);
    const seen = seenTitles.get(key);
    if (seen) {
      seen.duplicate = true;
      section.note = section.note || `A second "${section.title}" heading appeared in the source.`;
      section.confidence = Math.min(section.confidence, 0.65);
    }
    seenTitles.set(key, section);
    sections.push(section);
  }

  const duplicateTitles = Array.from(seenTitles.values()).filter((s) => s.duplicate).map((s) => s.title);
  if (duplicateTitles.length) {
    warnings.push({
      level: "info",
      title: "Repeated headings kept separate",
      detail: `${duplicateTitles.join(", ")} appeared more than once. Merge the cards if they belong together.`,
    });
  }
  for (const section of sections) delete section.duplicate;

  const lowConfidence = sections.filter((s) => s.confidence < 0.7);
  if (lowConfidence.length) {
    warnings.push({
      level: "warn",
      title: `${lowConfidence.length} section${lowConfidence.length > 1 ? "s need" : " needs"} a check`,
      detail: "Highlighted cards were harder to read with confidence. Nothing was dropped. Open them and confirm the split.",
    });
  }

  const doc = createDocument({
    name: contact.value.name ? `${contact.value.name.split(/\s+/)[0]}'s resume` : (fileName.replace(/\.[^.]+$/, "") || "Imported resume"),
    sections,
    warnings,
  });

  // an imported resume keeps the typeface it arrived with unless the user changes it
  if (meta.fonts?.body) {
    doc.settings.fonts = meta.fonts;
    doc.settings.keepFonts = true;
  }

  // match the shape of the source: a centred name and contact block gets the layout that does
  // the same, and section rules go on because nearly every real resume separates sections
  doc.template = meta.centeredHeader ? "professional" : "minimal";
  doc.settings.sectionRules = "on";

  // carry the source's own line spacing across, so a resume that was set tight enough to fit two
  // pages still fits two pages here
  if (meta.leading) {
    doc.settings.density = meta.leading < 1.3 ? "tight" : meta.leading > 1.55 ? "roomy" : "normal";
  }

  if ((meta.pages || 1) >= 3) {
    warnings.push({
      level: "info",
      title: `Source was ${meta.pages} pages`,
      detail: "Most roles expect one or two. Hide the sections you do not need for this application rather than deleting them.",
    });
  }

  return { doc, warnings };
}

function emptyDocument(fileName) {
  const doc = createDocument({ name: fileName.replace(/\.[^.]+$/, "") || "Imported resume" });
  doc.sections = [createSection("contact", { collapsed: false })];
  return doc;
}

// heading detection

function scoreHeadings(lines) {
  const sizes = lines.map((l) => l.size || 0).filter(Boolean).sort((a, b) => a - b);
  const medianSize = sizes[Math.floor(sizes.length / 2)] || 0;

  return lines.map((line, index) => {
    const text = line.text.trim();
    const normalized = normalizeHeading(text);
    if (!normalized) return false;

    // a heading introduces content; the last line cannot be one
    if (index === lines.length - 1) return false;
    if (line.listLevel != null) return false;
    if (BULLET_PREFIX.test(line.text)) return false;
    if (text.length > 62) return false;
    if (/[.;,]$/.test(text) && !lookupAlias(normalized)) return false;
    if (EMAIL.test(text) || DATE_RANGE.test(text) || SINGLE_DATE.test(text)) return false;
    // a column break means the line pairs a title with dates or a location, which is an entry
    // rather than a section heading. this is what keeps a bold job title out of the heading list
    if (line.text.includes("\t")) return false;
    // the first line is usually the person's name, so it is protected unless the source marked
    // it as a heading or it matches a known section name outright
    if (index === 0 && !line.styleHeading && !lookupAlias(normalized)) return false;

    let score = 0;
    if (lookupAlias(normalized)) score += 6;
    else if (findAliasByWords(normalized)) score += 4;

    if (line.styleHeading) score += 4;
    // capitals are the signal that separates a section heading from an emphasised entry title,
    // since both are usually set in the same heavier font
    if (line.allCaps) score += 3;
    if (medianSize && line.size > medianSize * 1.12) score += 2;
    if (line.bold && line.allCaps) score += 1;
    if (text.split(/\s+/).length <= 4) score += 1;
    if (line.gapAbove > (line.size || 10) * 0.7) score += 1;
    if (/^\d/.test(text)) score -= 2;
    if (text.split(/\s+/).length > 6) score -= 2;

    const next = lines[index + 1];
    if (next && (next.listLevel != null || BULLET_PREFIX.test(next.text) || HAS_DATE.test(next.text))) score += 1;

    return score >= 5;
  });
}

// an order insensitive match on the whole heading. it deliberately does not accept an alias that
// merely appears inside the heading: "Honors College" is a school, not the Awards section, and a
// subset match would call it one
function findAliasByWords(normalized) {
  const words = new Set(normalized.split(" "));
  for (const [alias, type] of ALIAS_INDEX) {
    const aliasWords = alias.split(" ");
    if (aliasWords.length !== words.size) continue;
    if (aliasWords.length > words.size) continue;
    if (aliasWords.every((word) => words.has(word))) return type;
  }
  return null;
}

// the longest alias whose words all appear in the heading, so "Relevant Work Experience" prefers
// "work experience" over the bare "experience"
function findAliasWithin(normalized) {
  const words = new Set(normalized.split(" "));
  let best = null;
  for (const [alias, type] of ALIAS_INDEX) {
    const aliasWords = alias.split(" ");
    if (aliasWords.length > words.size) continue;
    if (!aliasWords.every((word) => words.has(word))) continue;
    if (!best || aliasWords.length > best.length) best = { type, length: aliasWords.length };
  }
  return best?.type || null;
}

function classifyHeading(text) {
  const normalized = normalizeHeading(text);
  const exact = lookupAlias(normalized);
  if (exact) return { type: exact, confidence: 1 };
  const byWords = findAliasByWords(normalized);
  if (byWords) return { type: byWords, confidence: 0.85 };
  // this heading has already been accepted as a heading, so a contained alias is safe to act on
  // here even though it is far too loose to decide heading-ness with. "Employment Experience"
  // and "Relevant Work Experience" both land on experience this way
  const contained = findAliasWithin(normalized);
  if (contained) return { type: contained, confidence: 0.8 };
  return { type: "custom", confidence: 0.55 };
}

// contact block

function parseContact(lines) {
  const value = createContact();
  const leftovers = [];
  let confidence = lines.length ? 0.9 : 0.3;

  const joined = lines.map((l) => l.text).join(" • ");
  const emailMatch = joined.match(EMAIL);
  if (emailMatch) value.email = emailMatch[0].replace(/[.,;]$/, "");

  const phone = findPhone(joined);
  if (phone) value.phone = phone;

  for (const [index, line] of lines.entries()) {
    const text = line.text.trim();
    if (!text) continue;

    if (!value.name && index < 3 && looksLikeName(text)) {
      value.name = text.replace(/\s{2,}/g, " ");
      continue;
    }

    // split contact rows that PDF extraction joined with separators
    const parts = text.split(/\s*[|•·∙‧]\s*|\s{3,}|\t+/).map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      if (EMAIL.test(part) || (phone && stripDigits(part) && stripDigits(part) === stripDigits(phone))) continue;

      const url = part.match(URL);
      if (url && !EMAIL.test(part)) {
        const href = url[0].replace(/[.,;)]$/, "");
        value.links.push({ label: labelForUrl(href), url: href });
        continue;
      }
      if (!value.location && isLocation(part)) { value.location = part; continue; }
      if (part.length > 3) leftovers.push(part);
    }
  }

  // decide headline against the whole leftover block rather than line by line
  // a wrapped summary paragraph produces several leftovers, and picking one of
  // them as a headline both mislabels it and drops it from the summary
  if (leftovers.length === 1 && isHeadline(leftovers[0])) {
    value.headline = leftovers.shift();
  }

  // de-duplicate links that appear in both a header row and a body line
  const seen = new Set();
  value.links = value.links.filter((link) => {
    const key = link.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);

  if (!value.name) confidence = Math.min(confidence, 0.45);
  if (!value.email && !value.phone) confidence = Math.min(confidence, 0.5);

  return { value, leftovers, confidence };
}

function looksLikeName(text) {
  if (text.length > 46 || /\d|@/.test(text)) return false;
  const words = text.replace(/[,.]/g, "").split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  if (lookupAlias(normalizeHeading(text))) return false;
  const capitalised = words.filter((word) => /^[A-Z]/.test(word) || /^[^a-z]+$/.test(word));
  return capitalised.length >= Math.max(1, words.length - 1);
}

function isLocation(text) {
  if (text.length > 46 || EMAIL.test(text) || URL.test(text)) return false;
  return LOCATION_TAIL.test(text) || REMOTE.test(text) || /^[A-Z][\w.'-]+(?:\s[\w.'-]+)*,\s*[A-Z]{2}(?:\s+\d{5})?$/.test(text);
}

function isHeadline(text) {
  if (text.length < 6 || text.length > 90) return false;
  if (/\d{4}/.test(text) || !/[a-z]/.test(text)) return false;
  // sentence punctuation means this is prose, not a title line
  return !/[.;]$/.test(text) && !/^[a-z]/.test(text);
}

function findPhone(text) {
  // the leading bracket class matters: without it "(251) 604-7088" is captured
  // from the digit onward and loses its area code bracket
  const candidates = text.match(new RegExp(`[+(]?\\d[\\d\\s().+${DASHES}]{5,22}\\d`, "g"));
  if (!candidates) return "";
  for (const candidate of candidates) {
    const digits = stripDigits(candidate);
    if (digits.length < 7 || digits.length > 15) continue;
    if (/^(?:19|20)\d{2}$/.test(digits)) continue;
    return candidate.trim().replace(/\s{2,}/g, " ");
  }
  return "";
}

const stripDigits = (value) => String(value).replace(/\D/g, "");

function labelForUrl(url) {
  const host = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  if (host.includes("linkedin")) return "LinkedIn";
  if (host.includes("github")) return "GitHub";
  if (host.includes("gitlab")) return "GitLab";
  if (host.includes("behance")) return "Behance";
  if (host.includes("dribbble")) return "Dribbble";
  if (host.includes("medium")) return "Medium";
  if (host.includes("scholar.google")) return "Scholar";
  if (host.includes("orcid")) return "ORCID";
  if (host.includes("stackoverflow")) return "Stack Overflow";
  return "Website";
}

// section bodies

function buildSection(block, warnings) {
  const heading = cleanText(block.heading.text).replace(/[:•]+\s*$/, "").trim();
  const { type, confidence: typeConfidence } = classifyHeading(heading);
  const info = SECTION_TYPES[type];
  const contentLines = block.lines;

  if (!contentLines.length) {
    return createSection(type, {
      title: tidyHeading(heading, info.label, typeConfidence),
      confidence: 0.5,
      note: "This heading had no content underneath it in the source.",
    });
  }

  const layout = chooseLayout(info.layout, contentLines);
  const section = createSection(type, {
    title: tidyHeading(heading, info.label, typeConfidence),
    layout,
    confidence: typeConfidence,
  });

  if (layout === "entries") {
    const parsed = parseEntries(contentLines);
    section.items = parsed.items;
    section.confidence = Math.min(section.confidence, parsed.confidence);
    if (parsed.note) section.note = parsed.note;
  } else if (layout === "inline") {
    section.groups = parseGroups(contentLines);
  } else if (layout === "prose") {
    section.body = joinWrapped(contentLines.map((line) => flatten(line.text)));
  } else {
    section.bullets = parseBulletList(contentLines);
  }

  if (section.items?.length > 24 || section.bullets?.length > 40) {
    warnings.push({
      level: "info",
      title: `"${section.title}" is long`,
      detail: `It came in with ${section.items?.length || section.bullets.length} entries. Consider splitting it or hiding the older ones.`,
    });
  }

  return section;
}

function tidyHeading(heading, fallback, confidence) {
  const text = heading.trim();
  if (!text) return fallback;
  // ALL CAPS headings are a formatting choice in the source, not the label the
  // user wants to keep editing
  if (/^[^a-z]+$/.test(text) && text.length > 3) return titleCase(text);
  return confidence >= 1 && normalizeHeading(text) === normalizeHeading(fallback) ? fallback : text;
}

// some resumes use an entry-shaped section where the type suggests bullets and vice versa
// Trust the content over the type table
function chooseLayout(preferred, lines) {
  const dated = lines.filter((line) => DATE_RANGE.test(line.text) || SINGLE_DATE.test(line.text)).length;
  const bulleted = lines.filter((line) => line.listLevel != null || BULLET_PREFIX.test(line.text)).length;
  const labelled = lines.filter((line) => /^[^:]{2,32}:\s*\S/.test(line.text)).length;
  // an emphasised, unbulleted line is an entry head even when the section carries no dates, which
  // is how a projects or involvement section is usually written
  const heads = lines.filter((line) =>
    (line.bold || line.text.includes("\t")) && line.listLevel == null && !BULLET_PREFIX.test(line.text)).length;

  if (preferred === "inline") return labelled >= 1 || lines.length <= 6 ? "inline" : "bullets";
  if (preferred === "prose") return lines.length > 6 && bulleted > lines.length / 2 ? "bullets" : "prose";
  if (preferred === "entries") return dated === 0 && heads === 0 && bulleted >= lines.length * 0.7 ? "bullets" : "entries";
  if (preferred === "bullets" && dated >= 2 && bulleted < lines.length * 0.5) return "entries";
  return preferred;
}

function parseEntries(lines) {
  const items = [];
  let current = null;
  let uncertain = 0;

  const push = (head) => {
    current = createItem(head);
    items.push(current);
  };

  // true while the previous line carried an explicit bullet marker, which is what makes the
  // following unmarked line a wrapped continuation rather than a new bullet
  let afterMarkedBullet = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const isBullet = line.listLevel != null || BULLET_PREFIX.test(line.text);
    const text = stripBullet(line.text);
    if (!text) continue;

    if (isBullet) {
      if (!current) push({ title: "" });
      // a column break inside a bullet is a right hand date, as in "President<tab>Fall 2026".
      // it is kept so the renderer can set it against the right margin the way the source did
      current.bullets.push(keepTail(text));
      afterMarkedBullet = true;
      continue;
    }

    const dates = extractDates(text);

    // a long bullet wraps onto the next visual line with no marker of its own. emphasis, a column
    // break or a date all rule it out: a wrapped sentence carries none of them, whereas the next
    // entry's title carries at least one
    const isWrap = afterMarkedBullet
      && current?.bullets.length
      && !line.bold
      && !dates
      && !text.includes("\t");
    if (isWrap) {
      const list = current.bullets;
      list[list.length - 1] = joinWrapped([list[list.length - 1], flatten(text)]);
      continue;
    }
    afterMarkedBullet = false;

    // a line that is nothing but a date range belongs to the entry above it. some templates put a
    // long title on one line and its dates on the next instead of using a column
    const dateOnly = dates && !text.replace(dates.matched, " ").replace(EDGE_PUNCT, "").trim();
    if (dateOnly && current && !current.start && !current.end) {
      current.start = dates.start;
      current.end = dates.end;
      continue;
    }

    // an undated, multi column row right under a head that still has no organisation is the
    // second row of that head, not a new entry. templates split "role / dates" and "employer /
    // location" across two lines exactly like this. the tab is the giveaway: wrapped prose never
    // carries one, so this cannot swallow a continued bullet
    const continuation = current && !current.bullets.length && !current.org && !dates && text.includes("\t");
    if (continuation && absorbIntoEntry(current, text)) continue;

    // a dated line, a styled line, or a row with a real column break starts a new entry. anything
    // else is a wrapped continuation of the head above or of a long bullet, never a head itself
    if (dates || line.bold || !current || text.includes("\t")) {
      push(splitEntryHead(text, dates));
      continue;
    }

    if (!current.bullets.length && absorbIntoEntry(current, text)) continue;

    if (!current) push({ title: "" });
    current.bullets.push(flatten(text));
    if (!current.title) uncertain += 1;
  }

  const cleaned = foldHeaders(items.filter((item) => item.title || item.org || item.bullets.length));
  for (const item of cleaned) {
    if (!item.title && item.bullets.length) item.title = item.bullets.shift();
  }

  const missingDates = cleaned.filter((item) => !item.start && !item.end).length;
  let confidence = 1;
  if (!cleaned.length) confidence = 0.3;
  else {
    if (missingDates === cleaned.length && cleaned.length > 1) confidence -= 0.3;
    if (uncertain > 0) confidence -= 0.2;
    if (cleaned.some((item) => item.title.length > 140)) confidence -= 0.2;
  }

  return {
    items: cleaned,
    confidence: Math.max(0.2, Math.min(1, confidence)),
    note: missingDates && missingDates === cleaned.length && cleaned.length > 1
      ? "No dates were found for these entries."
      : "",
  };
}

// resumes routinely name the employer or school on its own line above the dated roles under it.
// that line parses as an entry with nothing in it, so fold it into the entry it introduces. it is
// applied to one entry only: carrying it further would attribute a role to an employer the source
// never linked it to
function foldHeaders(items) {
  const out = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const next = items[i + 1];

    // a header carries a name and nothing else, and the entry after it is a dated role. both
    // halves matter: without the lookahead an ordinary undated entry would be swallowed
    const looksLikeHeader = item.title && !item.start && !item.end && !item.bullets.length;
    const introducesRole = next && (next.start || next.end) && !next.org;
    if (!looksLikeHeader || !introducesRole) {
      out.push(item);
      continue;
    }

    // the header may already have been split on a comma into title and org; it is one name
    next.org = [item.title, item.org].filter(Boolean).join(", ");
    if (!next.location && item.location) next.location = item.location;
    if (item.meta) next.meta = [item.meta, next.meta].filter(Boolean).join("\n");
  }

  return out;
}

function extractDates(text) {
  const range = text.match(DATE_RANGE);
  if (range) return { start: tidyDate(range[1]), end: tidyDate(range[2]), matched: range[0] };
  const single = text.match(new RegExp(`(?:^|[|(\\t,${DASHES}]\\s*)(${DATE_TOKEN})\\s*$`, "i"));
  if (single) return { start: "", end: tidyDate(single[1]), matched: single[1] };
  return null;
}

// splits a head into columns without cutting inside brackets. a title like "Data Patterns in
// Unintended RF Emanations (INSURE - NSA)" contains a separator that belongs to the title, and
// splitting on it strands half the name in the organisation field
const GUARD = chars(0xe000);
const COLUMN_SPLIT = new RegExp(`\\s*[|${SEPARATORS}]\\s*|\\s{3,}|\\s+[${DASHES}]\\s+`);

function splitGuarded(text) {
  const masked = text.replace(/[([][^()[\]]*[)\]]/g, (group) => group.replace(/[^\S\n]/g, GUARD));
  return masked.split(COLUMN_SPLIT).map((part) => part.split(GUARD).join(" "));
}

function tidyDate(value) {
  const text = cleanText(value).replace(/[.,]+$/, "").trim();
  if (/^(present|current|now|ongoing|to date)$/i.test(text)) return "Present";
  return text.replace(/\b([a-z]{3,})\b/gi, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function splitEntryHead(text, dates) {
  let rest = text;
  const head = { title: "", org: "", location: "", start: "", end: "", meta: "", link: "", bullets: [] };

  if (dates) {
    head.start = dates.start;
    head.end = dates.end;
    rest = rest.replace(dates.matched, " ").replace(/\(\s*\)/g, " ");
  }

  const url = rest.match(URL);
  if (url) {
    head.link = url[0].replace(/[.,;)]$/, "");
    rest = rest.replace(url[0], " ");
  }

  // a tab is a column break the source actually had, so it wins. only when there is none do we
  // guess at columns from pipes, bullets or a run of spaces
  const hasColumns = rest.includes("\t");
  const parts = (hasColumns ? rest.split(/\t+/) : splitGuarded(rest))
    .map((part) => cleanText(part).replace(EDGE_PUNCT, "").trim())
    .filter(Boolean);

  if (!parts.length) return head;

  // pull the location out before deciding what is title and what is org. templates disagree
  // about where it sits, so search every field rather than assuming it comes last
  if (parts.length > 1) {
    const at = parts.findIndex((part) => isLocation(part) || REMOTE.test(part));
    if (at !== -1) head.location = parts.splice(at, 1)[0];
  }

  if (parts.length === 1) {
    // removing the dates can leave a dangling comma behind, so each half is trimmed again
    const commaSplit = parts[0].split(/,\s+/).map((piece) => piece.replace(EDGE_PUNCT, "").trim());
    if (commaSplit.length === 2 && commaSplit.every((piece) => piece.length > 2)) {
      head.title = commaSplit[0];
      head.org = commaSplit[1];
    } else {
      head.title = parts[0].replace(EDGE_PUNCT, "").trim();
    }
  } else if (hasColumns) {
    // in a real two column row the right hand side is a detail such as a tech stack, not the
    // employer. the employer is normally the line above, which foldHeaders attaches
    head.title = parts[0];
    head.meta = parts.slice(1).join("\n");
  } else {
    head.title = parts[0];
    head.org = parts[1];
    if (parts.length > 2) head.meta = parts.slice(2).join(" . ");
  }

  return head;
}

// fills gaps on the entry we just created from a wrapped continuation line
function absorbIntoEntry(item, text) {
  const dates = extractDates(text);
  let rest = text;

  if (dates && !item.start && !item.end) {
    item.start = dates.start;
    item.end = dates.end;
    rest = rest.replace(dates.matched, " ").trim().replace(EDGE_PUNCT, "").trim();
    if (!rest) return true;
  }

  // split columns before testing for a location, or a whole "employer<tab>city, ST" row would
  // be mistaken for the city on its own
  const parts = rest.split(new RegExp(`\\t+|\\s*[|${SEPARATORS}]\\s*|\\s{3,}`)).map((p) => p.trim()).filter(Boolean);

  if (parts.length === 1 && isLocation(rest) && !item.location) { item.location = rest; return true; }

  // a line sitting under the head is a detail: a GPA, an honour, a tech stack, sometimes the
  // employer. the organisation slot is filled from the head itself or from the line above, so
  // keeping these as detail lines in source order is what reproduces the original layout
  const at = parts.findIndex((part) => isLocation(part) || REMOTE.test(part));
  if (at !== -1 && !item.location) item.location = parts.splice(at, 1)[0];
  if (!parts.length) return true;

  const detail = parts.join(" . ");
  const isDetail = DETAIL_LINE.test(rest)
    || (detail.length <= 100 && !/[.!?]$/.test(detail) && detail.split(/\s+/).length <= 14);
  if (isDetail) {
    item.meta = [item.meta, detail].filter(Boolean).join("\n");
    return true;
  }

  return false;
}

// same wrapped line handling as the entry parser, for sections that are a plain list
function parseBulletList(lines) {
  const out = [];
  let afterMarkedBullet = false;

  for (const line of lines) {
    const isBullet = line.listLevel != null || BULLET_PREFIX.test(line.text);
    const raw = stripBullet(line.text);
    const text = flatten(raw);
    if (!text) continue;

    if (!isBullet && afterMarkedBullet && out.length && !raw.includes("\t")) {
      out[out.length - 1] = joinWrapped([out[out.length - 1], text]);
      continue;
    }
    out.push(text);
    afterMarkedBullet = isBullet;
  }
  return out;
}

function parseGroups(lines) {
  const groups = [];
  for (const line of lines) {
    const text = flatten(stripBullet(line.text));
    if (!text) continue;
    const match = text.match(/^([^:]{2,40}):\s*(.+)$/);
    if (match) groups.push({ id: uid("g"), label: cleanText(match[1]).trim(), items: cleanText(match[2]).trim() });
    else if (groups.length && !/[:,]$/.test(groups[groups.length - 1].items) && text.length < 30 && !/,/.test(text)) {
      // short continuation of a wrapped list
      groups[groups.length - 1].items += `, ${text}`;
    } else {
      groups.push({ id: uid("g"), label: "", items: text });
    }
  }
  return groups.length ? groups : [{ id: uid("g"), label: "", items: "" }];
}

// tabs survive here because an entry head uses them as field separators. anything stored as
// prose or a bullet is flattened first
const stripBullet = (text) => cleanLine(text).replace(BULLET_PREFIX, "").trim();
const flatten = (text) => String(text).replace(/\t+/g, " ").replace(/ {2,}/g, " ").trim();

// keeps a single trailing column so a bullet can carry a right aligned tail, and flattens any
// others, since more than one column inside a bullet is extraction noise rather than layout
function keepTail(text) {
  const parts = String(text).split(/\t+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return flatten(text);
  const tail = parts.pop();
  return `${parts.join(" ")}\t${tail}`;
}

// joins wrapped lines back into a paragraph. PDF extraction preserves the hyphen a typesetter
// used to break a word across lines, so "cyber-" followed by "security" has to rejoin as
// "cybersecurity" rather than "cyber- security"
function joinWrapped(lines) {
  let out = "";
  for (const line of lines) {
    const text = String(line).trim();
    if (!text) continue;
    if (!out) { out = text; continue; }
    if (/[a-z]-$/.test(out) && /^[a-z]/.test(text)) out = `${out.slice(0, -1)}${text}`;
    else out = `${out} ${text}`;
  }
  return out.replace(/\s{2,}/g, " ").trim();
}
