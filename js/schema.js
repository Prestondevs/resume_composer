import { uid, cleanText } from "./lib/util.js";

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
  "teaching", "opensource", "languages", "coursework", "patents", "military",
  "interests", "references", "custom",
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

export const TEMPLATES = [
  { id: "minimal", name: "Minimal", blurb: "Quiet serif, no rules, lots of air", columns: 1 },
  { id: "professional", name: "Professional", blurb: "Centred header, classic and safe", columns: 1 },
  { id: "technical", name: "Technical", blurb: "Dense sans-serif for engineering roles", columns: 1 },
  { id: "business", name: "Business", blurb: "Traditional serif with a strong rule", columns: 1 },
  { id: "academic", name: "Academic", blurb: "CV conventions, stacked entries", columns: 1 },
  { id: "creative", name: "Creative", blurb: "Large name, warm accent, side column", columns: 2 },
  { id: "ats", name: "ATS Friendly", blurb: "Plain, single column, parser-first", columns: 1 },
  { id: "sidebar", name: "Sidebar", blurb: "Tinted rail for skills and contact", columns: 2 },
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
        parts.push(item.title, item.org, item.location, item.start, item.end, item.meta, item.link, ...(item.bullets || []));
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
      meta: cleanText(item?.meta).slice(0, 300),
      link: cleanText(item?.link).slice(0, 300),
      bullets: (Array.isArray(item?.bullets) ? item.bullets : [])
        .slice(0, 40)
        .map((line) => cleanText(line).slice(0, 900))
        .filter((line) => line.length > 0),
    }));
  } else if (layout === "bullets") {
    section.bullets = (Array.isArray(input?.bullets) ? input.bullets : [])
      .slice(0, 200)
      .map((line) => cleanText(line).slice(0, 900))
      .filter((line) => line.length > 0);
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
