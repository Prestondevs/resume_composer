import { uid, cleanText, cleanLine } from "./lib/util.js";

// a section owns exactly one layout, and the layout decides which content field is meaningful
// Keeping that mapping in one table means the editor, the four exporters and the eight
// templates never disagree about shape

export const LAYOUTS = {
  contact: { field: "contact" },
  entries: { field: "items" },
  bullets: { field: "bullets" },
  inline: { field: "groups" },
  prose: { field: "body" },
};

export const SECTION_TYPES = {
  contact: {
    label: "Contact Information", layout: "contact", glyph: "@", singleton: true, essential: true,
    blurb: "Name, email, phone and links",
    aliases: ["contact", "contact information", "personal details", "personal information"],
  },
  summary: {
    label: "Summary", layout: "prose", glyph: "¶",
    blurb: "A short professional profile",
    aliases: ["summary", "professional summary", "profile", "objective", "career objective", "about", "about me", "career summary", "professional profile"],
  },
  education: {
    label: "Education", layout: "entries", glyph: "Ed", essential: true,
    blurb: "Degrees, schools and coursework",
    aliases: ["education", "academic background", "academics", "educational background", "academic qualifications", "schooling"],
  },
  experience: {
    label: "Experience", layout: "entries", glyph: "Ex", essential: true,
    blurb: "Jobs, internships and roles",
    aliases: ["experience", "work experience", "professional experience", "employment", "employment history", "work history", "relevant experience", "industry experience", "internships", "internship experience", "career history"],
  },
  projects: {
    label: "Projects", layout: "entries", glyph: "Pr",
    blurb: "Things you have built",
    aliases: ["projects", "personal projects", "selected projects", "technical projects", "academic projects", "side projects", "portfolio"],
  },
  skills: {
    label: "Skills", layout: "inline", glyph: "Sk", essential: true,
    blurb: "Grouped technologies and abilities",
    aliases: ["skills", "technical skills", "core competencies", "competencies", "technologies", "technical proficiencies", "proficiencies", "tools", "skills & tools", "areas of expertise", "expertise", "tech stack"],
  },
  leadership: {
    label: "Leadership", layout: "entries", glyph: "Ld",
    blurb: "Roles where you led people or teams",
    aliases: ["leadership", "leadership experience", "activities", "leadership & activities", "campus involvement", "involvement", "organizations", "extracurricular activities", "extracurriculars"],
  },
  certifications: {
    label: "Certifications", layout: "bullets", glyph: "Ce",
    blurb: "Licences and credentials",
    aliases: ["certifications", "certificates", "licenses", "licences", "credentials", "certifications & licenses"],
  },
  awards: {
    label: "Awards", layout: "bullets", glyph: "Aw",
    blurb: "Honours, scholarships and prizes",
    aliases: ["awards", "honors", "honours", "awards & honors", "honors & awards", "achievements", "accomplishments", "scholarships", "distinctions"],
  },
  publications: {
    label: "Publications", layout: "bullets", glyph: "Pu",
    blurb: "Papers, articles and talks",
    aliases: ["publications", "papers", "conference papers", "presentations", "talks", "publications & presentations", "posters"],
  },
  research: {
    label: "Research", layout: "entries", glyph: "Rs",
    blurb: "Lab work and research positions",
    aliases: ["research", "research experience", "research projects", "laboratory experience", "lab experience"],
  },
  volunteer: {
    label: "Volunteer Work", layout: "entries", glyph: "Vo",
    blurb: "Community and service roles",
    aliases: ["volunteer", "volunteering", "volunteer work", "volunteer experience", "community service", "service", "community involvement"],
  },
  teaching: {
    label: "Teaching", layout: "entries", glyph: "Te",
    blurb: "Instruction and tutoring roles",
    aliases: ["teaching", "teaching experience", "tutoring", "instruction", "teaching assistantships"],
  },
  opensource: {
    label: "Open Source", layout: "entries", glyph: "OS",
    blurb: "Contributions to public projects",
    aliases: ["open source", "open-source", "open source contributions", "contributions", "community contributions"],
  },
  languages: {
    label: "Languages", layout: "inline", glyph: "La",
    blurb: "Spoken and written languages",
    aliases: ["languages", "language skills", "spoken languages", "foreign languages"],
  },
  coursework: {
    label: "Relevant Coursework", layout: "inline", glyph: "Cw",
    blurb: "Classes worth calling out",
    aliases: ["coursework", "relevant coursework", "relevant courses", "courses", "selected coursework"],
  },
  patents: {
    label: "Patents", layout: "bullets", glyph: "Pt",
    blurb: "Filed and granted patents",
    aliases: ["patents", "patent applications", "inventions"],
  },
  military: {
    label: "Military Service", layout: "entries", glyph: "Ms",
    blurb: "Service record and roles",
    aliases: ["military", "military service", "military experience", "armed forces", "service record"],
  },
  interests: {
    label: "Interests", layout: "inline", glyph: "In",
    blurb: "Hobbies and personal interests",
    aliases: ["interests", "hobbies", "personal interests", "activities & interests", "outside interests"],
  },
  references: {
    label: "References", layout: "bullets", glyph: "Rf",
    blurb: "Referees or a availability note",
    aliases: ["references", "referees"],
  },
  clearance: {
    label: "Security Clearance", layout: "bullets", glyph: "Sc", government: true,
    blurb: "Level, agency and status",
    aliases: ["security clearance", "clearance", "clearances", "security clearances"],
  },
  ksa: {
    label: "Competencies", layout: "bullets", glyph: "Ks", government: true,
    blurb: "KSAs and rated competencies",
    aliases: ["ksa", "ksas", "competencies", "core competencies", "knowledge skills and abilities",
      "knowledge skills abilities", "rated competencies", "specialised experience", "specialized experience"],
  },
  training: {
    label: "Training", layout: "bullets", glyph: "Tr", government: true,
    blurb: "Courses and professional development",
    aliases: ["training", "professional training", "courses", "professional development", "continuing education"],
  },
  affiliations: {
    label: "Professional Affiliations", layout: "bullets", glyph: "Af",
    blurb: "Memberships and societies",
    aliases: ["affiliations", "professional affiliations", "memberships", "professional memberships",
      "societies", "professional organizations", "professional organisations"],
  },
  custom: {
    label: "Custom Section", layout: "bullets", glyph: "+",
    blurb: "Anything else you need",
    aliases: [],
  },
};

// order used when the sidebar lists sections you can add
export const LIBRARY_ORDER = [
  "summary", "experience", "education", "projects", "skills", "leadership",
  "certifications", "awards", "research", "publications", "volunteer",
  "teaching", "opensource", "languages", "coursework", "ksa", "clearance",
  "training", "affiliations", "patents", "military", "interests", "references", "custom",
];

// a sensible starting order for a freshly parsed or blank resume
export const DEFAULT_ORDER = ["contact", "summary", "education", "experience", "projects", "skills"];

export const PAGE_SIZES = {
  letter: { label: "US Letter", width: 8.5, height: 11 },
  a4: { label: "A4", width: 8.27, height: 11.69 },
  legal: { label: "US Legal", width: 8.5, height: 14 },
};

export const MARGINS = {
  narrow: { label: "Narrow", y: 0.4, x: 0.45 },
  normal: { label: "Normal", y: 0.55, x: 0.6 },
  wide: { label: "Wide", y: 0.8, x: 0.9 },
};

// one font for the whole document. every stack is built from faces that ship with Windows,
// macOS or a mainstream Linux desktop, so nothing has to be downloaded and the printed PDF
// matches the preview
export const FONT_CHOICES = [
  { id: "arial", label: "Arial", generic: "sans-serif", stack: 'Arial, Helvetica, "Liberation Sans", Arimo, sans-serif' },
  { id: "helvetica", label: "Helvetica", generic: "sans-serif", stack: 'Helvetica, Arial, "Nimbus Sans", sans-serif' },
  { id: "calibri", label: "Calibri", generic: "sans-serif", stack: 'Calibri, Carlito, "Segoe UI", sans-serif' },
  { id: "segoe", label: "Segoe UI", generic: "sans-serif", stack: '"Segoe UI", Selawik, Tahoma, sans-serif' },
  { id: "verdana", label: "Verdana", generic: "sans-serif", stack: 'Verdana, "DejaVu Sans", Geneva, sans-serif' },
  { id: "tahoma", label: "Tahoma", generic: "sans-serif", stack: 'Tahoma, Verdana, sans-serif' },
  { id: "trebuchet", label: "Trebuchet MS", generic: "sans-serif", stack: '"Trebuchet MS", Tahoma, sans-serif' },
  { id: "times", label: "Times New Roman", generic: "serif", stack: '"Times New Roman", Times, "Liberation Serif", Tinos, serif' },
  { id: "georgia", label: "Georgia", generic: "serif", stack: 'Georgia, Gelasio, "Times New Roman", serif' },
  { id: "cambria", label: "Cambria", generic: "serif", stack: 'Cambria, Caladea, Georgia, serif' },
  { id: "garamond", label: "Garamond", generic: "serif", stack: 'Garamond, "EB Garamond", "Adobe Garamond Pro", Georgia, serif' },
  { id: "palatino", label: "Palatino", generic: "serif", stack: '"Palatino Linotype", "TeX Gyre Pagella", Palatino, "Book Antiqua", Georgia, serif' },
  { id: "consolas", label: "Consolas", generic: "monospace", stack: 'Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace' },
  { id: "courier", label: "Courier New", generic: "monospace", stack: '"Courier New", Courier, "Liberation Mono", monospace' },
];

export const fontChoice = (id) => FONT_CHOICES.find((font) => font.id === id) || null;

// each layout is a starting point: it sets the style knobs below, and every one of them stays
// editable afterwards. `preset` is applied when the layout is chosen, never on every render, so a
// change the user makes is not overwritten the next time the page repaints
export const TEMPLATES = [
  { id: "minimal", name: "Minimal", blurb: "Quiet serif, no rules, lots of air", columns: 1, ats: true,
    preset: { headerStyle: "left", divider: "none", bullet: "circle" } },
  { id: "professional", name: "Professional", blurb: "Centred header, classic and safe", columns: 1, ats: true,
    preset: { headerStyle: "center", divider: "thin", bullet: "circle" } },
  { id: "executive", name: "Executive", blurb: "Wide margins, large name, senior tone", columns: 1, ats: true,
    preset: { headerStyle: "executive", divider: "accent", bullet: "dash", sectionSpace: "roomy" } },
  { id: "technical", name: "Technical", blurb: "Dense sans-serif for engineering roles", columns: 1, ats: true,
    preset: { headerStyle: "left", divider: "minimal", bullet: "dash" } },
  { id: "business", name: "Business", blurb: "Traditional serif with a strong rule", columns: 1, ats: true,
    preset: { headerStyle: "center", divider: "thick", bullet: "circle" } },
  { id: "compact", name: "Compact", blurb: "Tight leading to fit more on one page", columns: 1, ats: true,
    preset: { headerStyle: "left", divider: "thin", bullet: "dash", sectionSpace: "tight" } },
  { id: "academic", name: "Academic", blurb: "CV conventions, stacked entries", columns: 1, ats: true,
    preset: { headerStyle: "center", divider: "thin", bullet: "circle", sectionSpace: "roomy" } },
  { id: "government", name: "Government / Federal", blurb: "USAJOBS conventions, full position detail", columns: 1, ats: true,
    preset: { headerStyle: "government", divider: "thick", bullet: "square", sectionSpace: "roomy" } },
  { id: "healthcare", name: "Healthcare", blurb: "Licences and clinical detail up front", columns: 1, ats: true,
    preset: { headerStyle: "center", divider: "thin", bullet: "circle" } },
  { id: "legal", name: "Legal", blurb: "Formal serif, restrained and conventional", columns: 1, ats: true,
    preset: { headerStyle: "center", divider: "thin", bullet: "circle", sectionSpace: "roomy" } },
  { id: "ats", name: "ATS Optimized", blurb: "Plain, single column, parser-first", columns: 1, ats: true,
    preset: { headerStyle: "minimal", divider: "none", bullet: "circle" } },
  { id: "creative", name: "Creative", blurb: "Large name, warm accent, side column", columns: 2, ats: false,
    preset: { headerStyle: "modern", divider: "none", bullet: "dash" } },
  { id: "sidebar", name: "Sidebar", blurb: "Tinted rail for skills and contact", columns: 2, ats: false,
    preset: { headerStyle: "left", divider: "none", bullet: "circle" } },
];

export const HEADER_STYLES = [
  { id: "left", label: "Left aligned" },
  { id: "center", label: "Centred" },
  { id: "modern", label: "Modern" },
  { id: "executive", label: "Executive" },
  { id: "government", label: "Government" },
  { id: "minimal", label: "Minimal" },
];

export const DIVIDERS = [
  { id: "none", label: "None" },
  { id: "minimal", label: "Minimal" },
  { id: "thin", label: "Thin" },
  { id: "thick", label: "Thick" },
  { id: "accent", label: "Accent" },
];

// the glyph is what the page and the exports both use, so a bullet style survives to Word
export const BULLETS = [
  { id: "circle", label: "Circle", glyph: "•" },
  { id: "square", label: "Square", glyph: "▪" },
  { id: "dash", label: "Dash", glyph: "-" },
  { id: "arrow", label: "Arrow", glyph: "›" },
  { id: "none", label: "None", glyph: "" },
];

export const DATE_FORMATS = [
  { id: "asWritten", label: "As written" },
  { id: "monthYear", label: "Month YYYY" },
  { id: "shortMonthYear", label: "Mon YYYY" },
  { id: "numeric", label: "MM/YYYY" },
  { id: "year", label: "YYYY" },
];

export const LOCATION_FORMATS = [
  { id: "asWritten", label: "As written" },
  { id: "cityState", label: "City, ST" },
  { id: "cityStateLong", label: "City, State" },
  { id: "stateOnly", label: "State only" },
  { id: "hidden", label: "Hide" },
];

export const SPACE_STEPS = [
  { id: "tight", label: "Tight" },
  { id: "normal", label: "Normal" },
  { id: "roomy", label: "Roomy" },
];

export const typeInfo = (type) => SECTION_TYPES[type] || SECTION_TYPES.custom;

export function createItem(patch = {}) {
  return {
    id: uid("i"),
    title: "",
    org: "",
    location: "",
    start: "",
    end: "",
    meta: "",
    link: "",
    bullets: [],
    // federal applications ask for these; they render only when government fields are on
    hours: "",
    salary: "",
    supervisor: "",
    supervisorContact: "",
    mayContact: true,
    ...patch,
  };
}

export function createSection(type, patch = {}) {
  const info = typeInfo(type);
  const layout = patch.layout || info.layout;
  const section = {
    id: uid("s"),
    type,
    title: patch.title ?? info.label,
    layout,
    visible: true,
    locked: false,
    collapsed: true,
    column: 0,
    confidence: 1,
    note: "",
    // the line under this heading: true to draw one, false to drop it, null to do whatever the
    // rest of the document is doing
    rule: null,
    items: [],
    bullets: [],
    groups: [],
    body: "",
    contact: null,
    ...patch,
  };
  if (layout === "contact" && !section.contact) section.contact = createContact();
  return section;
}

export function createContact(patch = {}) {
  return { name: "", headline: "", email: "", phone: "", location: "", links: [], ...patch };
}

// choosing a layout seeds the style knobs it cares about and leaves the rest alone, so a font or
// a date format the user already picked survives the change
export function applyTemplate(doc, templateId) {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) return false;
  doc.template = templateId;
  Object.assign(doc.settings.style, template.preset || {});
  if (templateId === "government") doc.settings.governmentFields = true;
  return true;
}

export function defaultStyle() {
  return {
    headerStyle: "left",
    divider: "thin",
    bullet: "circle",
    dateFormat: "asWritten",
    locationFormat: "asWritten",
    sectionSpace: "normal",
    entrySpace: "normal",
    bulletSpace: "normal",
    lineHeight: 1,
    letterSpacing: 0,
    headingScale: 1,
    align: "left",
    colors: { heading: "", body: "", accent: "", divider: "" },
  };
}

const STYLE_ENUMS = {
  headerStyle: HEADER_STYLES,
  divider: DIVIDERS,
  bullet: BULLETS,
  dateFormat: DATE_FORMATS,
  locationFormat: LOCATION_FORMATS,
  sectionSpace: SPACE_STEPS,
  entrySpace: SPACE_STEPS,
  bulletSpace: SPACE_STEPS,
};

// a colour is only accepted in the two forms the picker produces, so a stored document cannot
// smuggle arbitrary text into a style attribute
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeStyle(input) {
  const style = { ...defaultStyle(), ...(input && typeof input === "object" ? input : {}) };

  for (const [key, options] of Object.entries(STYLE_ENUMS)) {
    if (!options.some((option) => option.id === style[key])) style[key] = defaultStyle()[key];
  }
  style.align = ["left", "center"].includes(style.align) ? style.align : "left";
  style.lineHeight = clampNumber(style.lineHeight, 0.8, 1.6, 1);
  style.letterSpacing = clampNumber(style.letterSpacing, -0.03, 0.12, 0);
  style.headingScale = clampNumber(style.headingScale, 0.8, 1.5, 1);

  const colors = style.colors && typeof style.colors === "object" ? style.colors : {};
  style.colors = {};
  for (const key of ["heading", "body", "accent", "divider"]) {
    style.colors[key] = HEX.test(colors[key] || "") ? colors[key] : "";
  }
  return style;
}

const clampNumber = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function createDocument(patch = {}) {
  const now = Date.now();
  return {
    id: uid("doc"),
    name: "Untitled resume",
    createdAt: now,
    updatedAt: now,
    template: "minimal",
    settings: {
      pageSize: "letter",
      margin: "normal",
      density: "normal",
      scale: 1,
      showPageNumbers: false,
      // typeface detected during import, whether to honour it over the layout, and an explicit
      // choice that overrides both when the user picks one
      fonts: null,
      keepFonts: true,
      fontOverride: null,
      // presentation knobs. a layout seeds these when it is chosen; after that they are the
      // user's, and the renderer reads them rather than hard coding anything per template
      style: defaultStyle(),
      // the extra position detail a federal application expects, off unless asked for
      governmentFields: false,
    },
    sections: [],
    trash: [],
    job: { title: "", company: "", url: "", description: "" },
    warnings: [],
    ...patch,
  };
}

export function blankDocument(name = "Untitled resume") {
  const doc = createDocument({ name });
  doc.sections = DEFAULT_ORDER.map((type) => createSection(type, { collapsed: type !== "contact" }));
  const contact = doc.sections[0];
  contact.collapsed = false;
  return doc;
}

// true when a section carries nothing a reader would see
export function isSectionEmpty(section) {
  switch (section.layout) {
    case "contact": {
      const c = section.contact || {};
      return !(c.name || c.email || c.phone || c.location || c.headline || c.links?.length);
    }
    case "entries":
      return !section.items?.some((item) => item.title || item.org || item.bullets?.some(Boolean));
    case "bullets":
      return !section.bullets?.some((line) => line.trim());
    case "inline":
      return !section.groups?.some((group) => group.items?.trim());
    case "prose":
      return !section.body?.trim();
    default:
      return true;
  }
}

// small count shown on each card header
export function sectionCount(section) {
  switch (section.layout) {
    case "entries": return section.items?.length || 0;
    case "bullets": return section.bullets?.filter((line) => line.trim()).length || 0;
    case "inline": return section.groups?.length || 0;
    case "prose": return 0;
    default: return 0;
  }
}

// flattens a section to plain text for scoring, keyword matching and search
export function sectionText(section) {
  const parts = [section.title];
  switch (section.layout) {
    case "contact": {
      const c = section.contact || {};
      parts.push(c.name, c.headline, c.email, c.phone, c.location, ...(c.links || []).map((l) => `${l.label} ${l.url}`));
      break;
    }
    case "entries":
      for (const item of section.items || []) {
        parts.push(item.title, item.org, item.location, item.start, item.end, item.meta, item.link,
          item.hours, item.salary, item.supervisor, ...(item.bullets || []));
      }
      break;
    case "bullets":
      parts.push(...(section.bullets || []));
      break;
    case "inline":
      for (const group of section.groups || []) parts.push(group.label, group.items);
      break;
    case "prose":
      parts.push(section.body);
      break;
  }
  return parts.filter(Boolean).join("\n");
}

export const documentText = (doc) =>
  (doc.sections || []).filter((s) => s.visible).map(sectionText).join("\n\n");

// repairs a document loaded from storage or produced by an importer so every downstream module
// can assume a complete shape. Anything unrecognised is dropped rather than allowed to crash a
// render
export function normalizeDocument(input) {
  const base = createDocument();
  const doc = { ...base, ...(input || {}) };

  doc.id ||= uid("doc");
  doc.name = cleanText(doc.name).slice(0, 120) || "Untitled resume";
  doc.template = TEMPLATES.some((t) => t.id === doc.template) ? doc.template : "minimal";
  doc.settings = { ...base.settings, ...(doc.settings || {}) };
  if (!PAGE_SIZES[doc.settings.pageSize]) doc.settings.pageSize = "letter";
  if (!MARGINS[doc.settings.margin]) doc.settings.margin = "normal";
  doc.settings.scale = Math.min(1.25, Math.max(0.8, Number(doc.settings.scale) || 1));
  doc.settings.fonts = normalizeFonts(doc.settings.fonts);
  doc.settings.keepFonts = doc.settings.keepFonts !== false;
  doc.settings.fontOverride = fontChoice(doc.settings.fontOverride) ? doc.settings.fontOverride : null;
  doc.settings.style = normalizeStyle(doc.settings.style);
  doc.settings.governmentFields = Boolean(doc.settings.governmentFields);
  doc.job = { title: "", company: "", url: "", description: "", ...(doc.job || {}) };
  doc.warnings = Array.isArray(doc.warnings) ? doc.warnings : [];
  doc.trash = Array.isArray(doc.trash) ? doc.trash.slice(0, 40).map(normalizeSection) : [];
  doc.sections = (Array.isArray(doc.sections) ? doc.sections : []).map(normalizeSection);

  // contact is structural: it must exist and it must lead
  const contactIndex = doc.sections.findIndex((s) => s.type === "contact");
  if (contactIndex === -1) doc.sections.unshift(createSection("contact", { collapsed: false }));
  else if (contactIndex > 0) doc.sections.unshift(doc.sections.splice(contactIndex, 1)[0]);

  return doc;
}

// a font record only survives if it still carries a usable CSS stack; anything else
// falls back to the template's own typeface
function normalizeFonts(input) {
  if (!input || typeof input !== "object") return null;
  const face = (value) => {
    if (!value || typeof value !== "object") return null;
    const stack = cleanText(value.stack).slice(0, 400);
    if (!stack) return null;
    return {
      name: cleanText(value.name).slice(0, 80),
      label: cleanText(value.label).slice(0, 80) || cleanText(value.name).slice(0, 80),
      generic: ["serif", "sans-serif", "monospace"].includes(value.generic) ? value.generic : "sans-serif",
      stack,
    };
  };
  const body = face(input.body);
  if (!body) return null;
  return {
    body,
    display: face(input.display),
    source: ["pdf", "docx", "latex", "text"].includes(input.source) ? input.source : null,
  };
}

// an entry's detail lines are newline separated so they render on the lines they came from
function tidyDetailLines(value) {
  return cleanText(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 400);
}

function normalizeSection(input) {
  const type = SECTION_TYPES[input?.type] ? input.type : "custom";
  const info = typeInfo(type);
  const layout = LAYOUTS[input?.layout] ? input.layout : info.layout;

  const section = createSection(type, {
    id: input?.id || uid("s"),
    title: cleanText(input?.title).slice(0, 90) || info.label,
    layout,
    visible: input?.visible !== false,
    locked: Boolean(input?.locked),
    collapsed: input?.collapsed !== false,
    column: input?.column === 1 ? 1 : 0,
    confidence: typeof input?.confidence === "number" ? Math.min(1, Math.max(0, input.confidence)) : 1,
    note: cleanText(input?.note).slice(0, 200),
    rule: input?.rule === true || input?.rule === false ? input.rule : null,
  });

  if (layout === "contact") {
    const c = input?.contact || {};
    section.contact = createContact({
      name: cleanText(c.name).slice(0, 120),
      headline: cleanText(c.headline).slice(0, 160),
      email: cleanText(c.email).slice(0, 160),
      phone: cleanText(c.phone).slice(0, 60),
      location: cleanText(c.location).slice(0, 120),
      links: (Array.isArray(c.links) ? c.links : []).slice(0, 12).map((link) => ({
        label: cleanText(link?.label).slice(0, 40),
        url: cleanText(link?.url).slice(0, 300),
      })).filter((link) => link.url || link.label),
    });
  } else if (layout === "entries") {
    section.items = (Array.isArray(input?.items) ? input.items : []).slice(0, 200).map((item) => createItem({
      id: item?.id || uid("i"),
      title: cleanText(item?.title).slice(0, 200),
      org: cleanText(item?.org).slice(0, 200),
      location: cleanText(item?.location).slice(0, 120),
      start: cleanText(item?.start).slice(0, 40),
      end: cleanText(item?.end).slice(0, 40),
      meta: tidyDetailLines(item?.meta),
      link: cleanText(item?.link).slice(0, 300),
      hours: cleanText(item?.hours).slice(0, 40),
      salary: cleanText(item?.salary).slice(0, 60),
      supervisor: cleanText(item?.supervisor).slice(0, 120),
      supervisorContact: cleanText(item?.supervisorContact).slice(0, 120),
      mayContact: item?.mayContact !== false,
      bullets: (Array.isArray(item?.bullets) ? item.bullets : [])
        .slice(0, 40)
        .map((line) => cleanLine(line).slice(0, 900))
        .filter((line) => line.trim().length > 0),
    }));
  } else if (layout === "bullets") {
    section.bullets = (Array.isArray(input?.bullets) ? input.bullets : [])
      .slice(0, 200)
      .map((line) => cleanLine(line).slice(0, 900))
      .filter((line) => line.trim().length > 0);
  } else if (layout === "inline") {
    section.groups = (Array.isArray(input?.groups) ? input.groups : []).slice(0, 40).map((group) => ({
      id: group?.id || uid("g"),
      label: cleanText(group?.label).slice(0, 60),
      items: cleanText(group?.items).slice(0, 900),
    }));
  } else if (layout === "prose") {
    section.body = cleanText(input?.body).slice(0, 4000);
  }

  return section;
}

// changes a section's layout while carrying content across as faithfully as the shapes allow
// Used when merging sections and when a user reclassifies one
export function convertLayout(section, layout) {
  if (section.layout === layout) return section;
  const lines = layoutToLines(section);
  const next = { ...section, layout, items: [], bullets: [], groups: [], body: "", contact: section.contact };

  if (layout === "bullets") next.bullets = lines;
  else if (layout === "prose") next.body = lines.join("\n");
  else if (layout === "inline") next.groups = lines.map((line) => {
    const [label, ...rest] = line.split(/:\s*/);
    return rest.length ? { id: uid("g"), label, items: rest.join(": ") } : { id: uid("g"), label: "", items: line };
  });
  else if (layout === "entries") next.items = lines.map((line) => createItem({ title: line }));
  else if (layout === "contact") next.contact = section.contact || createContact();

  return next;
}

function layoutToLines(section) {
  switch (section.layout) {
    case "entries":
      return (section.items || []).flatMap((item) => {
        const head = [item.title, item.org].filter(Boolean).join(", ");
        const dates = [item.start, item.end].filter(Boolean).join(" - ");
        const label = [head, dates].filter(Boolean).join(", ");
        return [label, ...(item.bullets || [])].filter(Boolean);
      });
    case "bullets":
      return [...(section.bullets || [])];
    case "inline":
      return (section.groups || []).map((g) => (g.label ? `${g.label}: ${g.items}` : g.items)).filter(Boolean);
    case "prose":
      return (section.body || "").split(/\n+/).filter(Boolean);
    default:
      return [];
  }
}
