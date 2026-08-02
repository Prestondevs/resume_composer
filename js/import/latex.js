import { cleanLine } from "../lib/util.js";
import { resolveFont } from "./fonts.js";

// LaTeX import
// resume classes differ wildly in their macro names and argument order, so this does not try to
// know them. Formatting macros are unwrapped to their contents, layout macros are dropped, and
// any remaining multi-argument macro becomes one tab separated line. The section parser then
// works out which piece is a title, an organization, a date range or a location from the content
// itself, which is the same thing it does for PDF text

// escaped specials are parked under sentinels so later brace and macro stripping cannot
// eat them, then restored once the line is otherwise clean
// plain ASCII so it survives brace stripping, macro stripping and whitespace cleanup
const BOLD_OPEN = "@@B@@";
const BOLD_CLOSE = "@@/B@@";

const ESCAPED = [
  ["\\\\&", "@@AMP@@", "&"],
  ["\\\\%", "@@PCT@@", "%"],
  ["\\\\\\$", "@@DLR@@", "$"],
  ["\\\\#", "@@HSH@@", "#"],
  ["\\\\_", "@@USC@@", "_"],
  ["\\\\\\{", "@@LBR@@", "{"],
  ["\\\\\\}", "@@RBR@@", "}"],
];

// macros whose argument is the text we want to keep
const UNWRAP = [
  "textbf", "textit", "textsl", "textsc", "texttt", "textrm", "textsf", "textup", "textnormal",
  "emph", "underline", "uline", "mbox", "text", "bf", "it", "sc", "tt", "sl",
  "large", "Large", "LARGE", "huge", "Huge", "small", "footnotesize", "scriptsize", "normalsize",
  "centerline", "makebox", "raisebox", "textsuperscript", "textsubscript", "so", "sout",
];

// macros that only affect layout; both the macro and its arguments go
const DROP = [
  "vspace", "hspace", "vskip", "hskip", "rule", "titlerule", "hrule",
  "label", "ref", "pagestyle", "thispagestyle", "setlength", "addtolength", "renewcommand",
  "newcommand", "providecommand", "definecolor", "color", "textcolor", "colorbox", "pagenumbering",
  "geometry", "usepackage", "documentclass", "input", "include", "bibliographystyle", "bibliography",
  "fontsize", "selectfont", "setmainfont", "setsansfont", "setmonofont", "titleformat", "titlespacing",
  "columnsep", "raggedright", "raggedbottom", "sloppy", "phantom", "index", "footnote",
];

const LAYOUT_BARE = new Set([
  "noindent", "centering", "raggedright", "raggedleft", "bigskip", "medskip", "smallskip",
  "clearpage", "newpage", "pagebreak", "linebreak", "par", "vfil", "vfill",
  "maketitle", "tableofcontents", "normalfont", "bfseries", "itshape", "scshape", "ttfamily",
  "rmfamily", "sffamily", "mdseries", "upshape", "sloppy", "justifying", "boldmath", "unboldmath",
  "leavevmode", "strut", "quad", "qquad",
]);

const ACCENTS = new Map(Object.entries({
  "'a": "á", "`a": "à", '"a': "ä", "^a": "â", "~a": "ã",
  "'e": "é", "`e": "è", '"e': "ë", "^e": "ê",
  "'i": "í", "`i": "ì", '"i': "ï", "^i": "î",
  "'o": "ó", "`o": "ò", '"o': "ö", "^o": "ô", "~o": "õ",
  "'u": "ú", "`u": "ù", '"u': "ü", "^u": "û",
  "'c": "ć", "cc": "ç", "'n": "ń", "~n": "ñ",
  "'A": "Á", "`A": "À", '"A': "Ä", "'E": "É", "'O": "Ó", "'U": "Ú",
  '"O': "Ö", '"U': "Ü", "~N": "Ñ", "cC": "Ç",
}));

const FONT_PACKAGES = [
  [/\b(times|mathptmx|newtxtext|newtxmath|txfonts|tgtermes)\b/, "Times New Roman"],
  [/\b(helvet|tgheros|newtxsf)\b/, "Helvetica"],
  [/\b(mathpazo|palatino|newpxtext|pxfonts|tgpagella)\b/, "Palatino"],
  [/\b(charter|XCharter)\b/, "Charter"],
  [/\b(libertine|libertinus)\b/, "Linux Libertine"],
  [/\b(ebgaramond|garamondx|garamond)\b/, "EB Garamond"],
  [/\b(fourier|utopia|erewhon)\b/, "Utopia"],
  [/\b(lmodern|latinmodern)\b/, "Latin Modern Roman"],
  [/\b(kpfonts|kpsans)\b/, "Kp-Fonts"],
  [/\b(avant|tgadventor)\b/, "Avant Garde"],
  [/\b(bookman|tgbonum)\b/, "Bookman"],
  [/\b(courier|tgcursor)\b/, "Courier New"],
  [/\b(concrete|ccfonts)\b/, "Concrete"],
  [/\b(fira|FiraSans)\b/, "Fira Sans"],
  [/\b(roboto)\b/, "Roboto"],
  [/\b(lato)\b/, "Lato"],
  [/\b(sourcesanspro|sourcesans)\b/, "Source Sans"],
  [/\b(opensans)\b/, "Open Sans"],
  [/\b(raleway)\b/, "Raleway"],
  [/\b(montserrat)\b/, "Montserrat"],
];

export function extractLatex(source) {
  const raw = String(source || "");
  const preamble = raw.split(/\\begin\s*\{document\}/)[0] || "";
  const fonts = detectFonts(preamble, raw);

  let body = raw;
  const start = raw.search(/\\begin\s*\{document\}/);
  if (start !== -1) {
    body = raw.slice(start).replace(/^\\begin\s*\{document\}/, "");
    const end = body.search(/\\end\s*\{document\}/);
    if (end !== -1) body = body.slice(0, end);
  }

  body = stripComments(body);
  for (const [pattern, token] of ESCAPED) body = body.replace(new RegExp(pattern, "g"), token);

  // resume templates routinely break a macro and its arguments across several source lines.
  // pulling each invocation back onto one line is what lets the argument groups be read as one
  // entry rather than as unrelated lines
  for (let pass = 0; pass < 6; pass += 1) {
    const joined = body
      .replace(/\}[ \t]*\r?\n[ \t]*\{/g, "}{")
      .replace(/(\\[a-zA-Z@]+\*?)[ \t]*\r?\n[ \t]*\{/g, "$1{");
    if (joined === body) break;
    body = joined;
  }

  // in LaTeX these are en and em dashes
  body = body.replace(/---/g, "-").replace(/--/g, "-");

  body = body
    .replace(/\\href\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, url, label) => (label.trim() ? `${label} (${url})` : url))
    .replace(/\\url\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:faIcon|faicon|includegraphics)\s*(\[[^\]]*\])?\s*\{[^{}]*\}/g, " ")
    .replace(/\$([^$]*)\$/g, "$1")
    .replace(/\\\\\s*(\[[^\]]*\])?/g, "\n")
    // both push the rest of the line to the far margin, so they mark a column break
    .replace(/\\(?:hfill|hrulefill|dotfill)\b/g, "\t")
    .replace(/&/g, "\t");

  body = expandAccents(body);
  body = dropMacros(body);
  // \textbf is what a LaTeX resume uses for a section heading and for an entry title, and
  // unwrapping it would throw that away. the marker survives the unwrap and is read back when the
  // line is emitted, which is the same signal the PDF reader gets from the font
  body = body.replace(
    /\\(?:textbf|bfseries|textsc|scshape|bf)\s*\{([^{}]*)\}/g,
    (_, inner) => `${BOLD_OPEN}${inner}${BOLD_CLOSE}`,
  );
  body = unwrapMacros(body);

  const lines = [];
  let listDepth = 0;
  let blankRun = 0;

  // shared by the heading pass and the content pass so both get the same cleanup
  function emit(rawText, { heading = false, sub = false, item = false } = {}) {
    let text = rawText;
    text = text.replace(/\\[a-zA-Z@]+\*?\s*((?:\{[^{}]*\}\s*){2,})/g, (_, groups) => {
      const parts = Array.from(groups.matchAll(/\{([^{}]*)\}/g)).map((m) => m[1].trim()).filter(Boolean);
      return parts.join("\t");
    });
    text = text
      .replace(/\\[a-zA-Z@]+\*?\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\[a-zA-Z@]+\*?/g, " ")
      .replace(/[{}]/g, " ");

    for (const [, token, char] of ESCAPED) text = text.split(token).join(char);

    // emphasis is read before the markers are removed, and a marker anywhere on a line that is
    // not a list item means the line is a heading or an entry title
    const emphasized = text.includes(BOLD_OPEN);
    text = text.split(BOLD_OPEN).join("").split(BOLD_CLOSE).join("");

    text = cleanLine(text).trim().replace(/^\t+|\t+$/g, "").trim();

    if (!text) { blankRun += 1; return; }

    lines.push({
      text,
      size: heading ? 13 : sub ? 11.5 : 10,
      bold: sub || (!item && emphasized) || (!item && !heading && /\t/.test(text)),
      allCaps: /^[^a-z]{3,}$/.test(text) && text.length < 46,
      // a custom macro such as \resumeItem loses its \item, so anything inside an itemize with no
      // tab separated fields counts as a list entry too
      listLevel: item || (listDepth > 0 && !heading && !sub && !/\t/.test(text))
        ? Math.max(0, listDepth - 1)
        : null,
      styleHeading: heading,
      x: 0,
      gapAbove: blankRun > 0 ? 12 : 0,
    });
    blankRun = 0;
  }

  for (const rawLine of body.split("\n")) {
    let line = rawLine;

    const begin = line.match(/\\begin\s*\{(itemize|enumerate|description|tabular\*?|tabularx|multicols|center|flushleft|adjustwidth)\}/);
    if (begin) {
      if (/itemize|enumerate|description/.test(begin[1])) listDepth += 1;
      line = line.replace(/\\begin\s*\{[^{}]*\}(\s*\{[^{}]*\})*(\s*\[[^\]]*\])?/g, " ");
    }
    if (/\\end\s*\{(itemize|enumerate|description)\}/.test(line)) {
      listDepth = Math.max(0, listDepth - 1);
    }
    line = line.replace(/\\(begin|end)\s*\{[^{}]*\}(\s*\{[^{}]*\})*(\s*\[[^\]]*\])?/g, " ");

    // a heading frequently shares its source line with the content that follows it, so emit the
    // heading and carry on with the remainder rather than discarding it
    let isSub = false;
    const section = line.match(/\\(?:section|chapter)\*?\s*\{([\s\S]*?)\}/);
    if (section) {
      emit(section[1], { heading: true });
      line = line.replace(section[0], " ");
    } else {
      const subsection = line.match(/\\(?:subsection|subsubsection|paragraph)\*?\s*\{([\s\S]*?)\}/);
      if (subsection) {
        emit(subsection[1], { sub: true });
        line = line.replace(subsection[0], " ");
        isSub = true;
      }
    }

    // \item[] with an empty optional label deliberately suppresses the bullet marker, which is
    // how most resume classes open an entry block. that is a container, not a list item
    const itemMatch = line.match(/\\item\s*(\[[^\]]*\])?/);
    const isItem = Boolean(itemMatch) && !(itemMatch[1] && /^\[\s*(\{\s*\})?\s*\]$/.test(itemMatch[1]));
    line = line.replace(/\\item\s*(\[[^\]]*\])?/g, " ");

    emit(line, { sub: isSub, item: isItem });
  }

  const totalChars = lines.reduce((sum, line) => sum + line.text.length, 0);

  return {
    lines,
    meta: {
      pages: Math.max(1, Math.round(totalChars / 3200)),
      chars: totalChars,
      twoColumn: false,
      scanned: false,
      fonts,
    },
  };
}

// a bare % starts a comment, an escaped one does not
function stripComments(text) {
  return text
    .split("\n")
    .map((line) => {
      let out = "";
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === "%" && line[i - 1] !== "\\") break;
        out += line[i];
      }
      return out;
    })
    .join("\n");
}

function expandAccents(text) {
  return text
    .replace(/\\([`'"^~c])\s*\{?([a-zA-Z])\}?/g, (match, accent, letter) => ACCENTS.get(accent + letter) || letter)
    .replace(/\\ss\b/g, "ß")
    .replace(/\\ae\b/g, "æ")
    .replace(/\\oe\b/g, "œ")
    .replace(/\\o\b/g, "ø")
    .replace(/\\l\b/g, "ł")
    .replace(/\\ldots\b|\\dots\b/g, "...")
    .replace(/\\textbullet\b/g, " ")
    .replace(/\\textbar\b/g, "|")
    .replace(/\\textendash\b/g, "-")
    .replace(/\\textemdash\b/g, "-")
    .replace(/~/g, " ")
    .replace(/\\[,;:!]/g, " ");
}

function dropMacros(text) {
  let out = text;
  for (const name of DROP) {
    // the macro plus any optional and brace arguments that follow it
    out = out.replace(new RegExp(`\\\\${name}\\*?\\s*(\\[[^\\]]*\\])?(\\s*\\{[^{}]*\\})*`, "g"), " ");
  }
  for (const name of LAYOUT_BARE) {
    out = out.replace(new RegExp(`\\\\${name}\\b`, "g"), " ");
  }
  return out;
}

function unwrapMacros(text) {
  let out = text;
  // repeat so nested formatting such as \textbf{\large X} fully unwraps
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const name of UNWRAP) {
      const pattern = new RegExp(`\\\\${name}\\s*\\{([^{}]*)\\}`, "g");
      const next = out.replace(pattern, "$1");
      if (next !== out) { out = next; changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

function detectFonts(preamble, whole) {
  const explicit = whole.match(/\\set(?:main|sans|roman)font\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/);
  let name = explicit ? explicit[1].trim() : "";

  if (!name) {
    for (const [pattern, family] of FONT_PACKAGES) {
      if (pattern.test(preamble)) { name = family; break; }
    }
  }

  // with no font package at all, LaTeX sets Computer Modern
  if (!name) name = "Computer Modern Roman";

  const wantsSans = /\\renewcommand\s*\{?\s*\\familydefault\s*\}?\s*\{?\s*\\sfdefault/.test(preamble)
    || /\b(helvet|newtxsf|FiraSans|roboto|lato|sourcesans|opensans|raleway|montserrat|avant)\b/.test(preamble);
  if (wantsSans && /Computer Modern Roman/.test(name)) name = "Computer Modern Sans";

  const body = resolveFont(name, wantsSans ? "sans-serif" : "");
  return body ? { body, display: null, source: "latex" } : null;
}
