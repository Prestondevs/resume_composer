// font identification for imported files
// an imported resume should keep looking like itself, so the importer records which typeface
// the source used and the renderer honours it instead of imposing a template's font
// two problems make this less trivial than reading a name. PDF font names are subset-prefixed
// ("ORZDOG+SFBX1095") and frequently name a font the reader does not have installed, especially
// for LaTeX output. So each detected font becomes a CSS stack: the real name first, so an exact
// match is used when it exists, then close metric substitutes, then the correct generic family

const SUBSET_PREFIX = /^[A-Z]{6}\+/;

const FAMILIES = [
  {
    test: /^(sfrm|sfbx|sfss|sfti|cmss|cmbx?ss|lmsans|latinmodernsans)/i,
    name: "Computer Modern Sans",
    generic: "sans-serif",
    stack: '"Latin Modern Sans", "CMU Sans Serif", "DejaVu Sans", "Segoe UI", Helvetica, Arial, sans-serif',
  },
  {
    test: /^(cmr|cmbx|cmti|cmsl|lmroman|latinmodernroman|computermodern)/i,
    name: "Computer Modern Roman",
    generic: "serif",
    stack: '"Latin Modern Roman", "CMU Serif", "Nimbus Roman", "Times New Roman", Times, serif',
  },
  {
    test: /^(cmtt|lmmono|latinmodernmono)/i,
    name: "Computer Modern Typewriter",
    generic: "monospace",
    stack: '"Latin Modern Mono", "CMU Typewriter Text", "DejaVu Sans Mono", Consolas, monospace',
  },
  { test: /times|nimbusroman|nimbusromno9|liberationserif|tinos|thorndale/i, name: "Times New Roman", generic: "serif", stack: '"Times New Roman", Times, "Liberation Serif", Tinos, serif' },
  { test: /arial|helvetica|nimbussan|liberationsans|arimo|albany/i, name: "Arial", generic: "sans-serif", stack: 'Arial, Helvetica, "Liberation Sans", Arimo, sans-serif' },
  { test: /calibri|carlito/i, name: "Calibri", generic: "sans-serif", stack: 'Calibri, Carlito, "Segoe UI", sans-serif' },
  { test: /cambria|caladea/i, name: "Cambria", generic: "serif", stack: 'Cambria, Caladea, Georgia, serif' },
  { test: /georgia|gelasio/i, name: "Georgia", generic: "serif", stack: 'Georgia, Gelasio, "Times New Roman", serif' },
  { test: /garamond/i, name: "Garamond", generic: "serif", stack: '"EB Garamond", Garamond, "Adobe Garamond Pro", Georgia, serif' },
  { test: /palatino|pagella|palladio|book\s?antiqua/i, name: "Palatino", generic: "serif", stack: '"Palatino Linotype", "TeX Gyre Pagella", Palatino, "Book Antiqua", Georgia, serif' },
  { test: /baskerville|librebaskerville/i, name: "Baskerville", generic: "serif", stack: 'Baskerville, "Libre Baskerville", Georgia, serif' },
  { test: /courier|nimbusmono|liberationmono|cousine/i, name: "Courier New", generic: "monospace", stack: '"Courier New", Courier, "Liberation Mono", monospace' },
  { test: /segoeui|segoe/i, name: "Segoe UI", generic: "sans-serif", stack: '"Segoe UI", Selawik, Tahoma, sans-serif' },
  { test: /verdana|dejavusans(?!mono)|bitstreamvera/i, name: "Verdana", generic: "sans-serif", stack: 'Verdana, "DejaVu Sans", Geneva, sans-serif' },
  { test: /tahoma/i, name: "Tahoma", generic: "sans-serif", stack: 'Tahoma, Verdana, sans-serif' },
  { test: /trebuchet/i, name: "Trebuchet MS", generic: "sans-serif", stack: '"Trebuchet MS", Tahoma, sans-serif' },
  { test: /(^|\W)(lato)/i, name: "Lato", generic: "sans-serif", stack: 'Lato, "Segoe UI", Helvetica, sans-serif' },
  { test: /roboto(?!mono|slab)/i, name: "Roboto", generic: "sans-serif", stack: 'Roboto, "Segoe UI", Helvetica, sans-serif' },
  { test: /opensans|notosans|sourcesans|firasans|ibmplexsans|publicsans|worksans|inter|montserrat|raleway|nunito|poppins|karla|rubik|manrope/i, name: "Humanist sans", generic: "sans-serif", stack: '"Open Sans", "Noto Sans", "Source Sans 3", Inter, "Segoe UI", Helvetica, Arial, sans-serif' },
  { test: /merriweather|lora|ptserif|crimson|sourceserif|notoserif|ibmplexserif|spectral|charter|charis/i, name: "Transitional serif", generic: "serif", stack: '"Source Serif 4", Merriweather, Lora, Charter, Georgia, serif' },
  { test: /minionpro|minion/i, name: "Minion Pro", generic: "serif", stack: '"Minion Pro", "Source Serif 4", Georgia, serif' },
  { test: /myriadpro|myriad/i, name: "Myriad Pro", generic: "sans-serif", stack: '"Myriad Pro", "Segoe UI", Helvetica, sans-serif' },
];

// "ORZDOG+SFBX1095-Bold" -> "SFBX1095"
export function normalizeFontName(raw) {
  let name = String(raw || "").trim().replace(SUBSET_PREFIX, "");
  // style suffixes describe the cut, not the family, but only when a delimiter marks them off.
  // stripping bare words would turn "Times New Roman" into "Times New"
  name = name
    .replace(/[-_,](regular|book|roman|medium|bold|semibold|demibold|black|heavy|light|thin|extralight|italic|oblique|bolditalic|mt|ms|std|pro|lt)+$/gi, "")
    .replace(/\d{3,}$/, (match, offset, full) => (/^(sf|cm|lm)/i.test(full) ? match : ""))
    .replace(/[-_]+$/, "")
    .trim();
  return name;
}

// resolves a raw font name to a usable CSS stack
// source file
export function resolveFont(raw, genericHint = "") {
  const name = normalizeFontName(raw);
  if (!name) return null;

  const generic = /serif/i.test(genericHint) && !/sans/i.test(genericHint)
    ? "serif"
    : /mono/i.test(genericHint) ? "monospace" : /sans/i.test(genericHint) ? "sans-serif" : "";

  for (const family of FAMILIES) {
    if (!family.test.test(name)) continue;
    return { name, label: family.name, generic: family.generic, stack: quoteFirst(name, family.stack) };
  }

  // unrecognised: still lead with the real name so an installed match wins,
  // then fall back on whatever generic class the source declared
  const guessed = generic || (/serif/i.test(name) && !/sans/i.test(name) ? "serif" : "sans-serif");
  const fallback = guessed === "serif"
    ? '"Source Serif 4", Georgia, "Times New Roman", serif'
    : guessed === "monospace"
      ? 'Consolas, "DejaVu Sans Mono", monospace'
      : '"Segoe UI", Inter, Helvetica, Arial, sans-serif';

  return { name, label: name, generic: guessed, stack: quoteFirst(name, fallback) };
}

function quoteFirst(name, stack) {
  const quoted = /[\s]/.test(name) ? `"${name}"` : `"${name}"`;
  return stack.includes(quoted) ? stack : `${quoted}, ${stack}`;
}

// chooses body and display fonts from usage samples
// number, size: number, generic?: string}>} samples
export function pickFonts(samples) {
  const usable = samples.filter((s) => s.name && s.chars > 0);
  if (!usable.length) return null;

  const byName = new Map();
  for (const sample of usable) {
    const key = normalizeFontName(sample.name);
    if (!key) continue;
    const entry = byName.get(key) || { name: sample.name, chars: 0, maxSize: 0, generic: sample.generic || "" };
    entry.chars += sample.chars;
    entry.maxSize = Math.max(entry.maxSize, sample.size || 0);
    byName.set(key, entry);
  }
  if (!byName.size) return null;

  const ranked = Array.from(byName.values()).sort((a, b) => b.chars - a.chars);
  const body = resolveFont(ranked[0].name, ranked[0].generic);
  if (!body) return null;

  // a display face only counts if it is genuinely a different family used at a
  // larger size, not just the bold cut of the body font
  const largest = Array.from(byName.values()).sort((a, b) => b.maxSize - a.maxSize)[0];
  let display = null;
  if (largest && largest !== ranked[0] && largest.maxSize > ranked[0].maxSize * 1.25) {
    const resolved = resolveFont(largest.name, largest.generic);
    if (resolved && resolved.label !== body.label) display = resolved;
  }

  return {
    body,
    display,
    source: null,
    detected: ranked.map((entry) => ({ name: normalizeFontName(entry.name), chars: entry.chars })).slice(0, 6),
  };
}
