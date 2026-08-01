import { h, clear, icon } from "../lib/dom.js";
import { fuzzyMatch, plural, formatRelative, debounce, escapeHtml } from "../lib/util.js";
import { store } from "../store.js";
import { SECTION_TYPES, LIBRARY_ORDER, TEMPLATES, PAGE_SIZES, MARGINS, FONT_CHOICES, typeInfo, isSectionEmpty } from "../schema.js";
import { reviewDocument } from "../analysis/review.js";
import { activeFontLabel } from "../templates/render.js";
import { openMenu, promptDialog, confirmDialog } from "./overlay.js";
import { toast } from "./toasts.js";

// tabs across the top of the right dock
export const TOOL_PANELS = [
  { id: "sections", label: "Library", icon: "layers", blurb: "Add or switch on sections" },
  { id: "design", label: "Layout", icon: "wand", blurb: "Layout, page setup and font" },
  { id: "optimize", label: "Optimize", icon: "target", blurb: "Match against a job description" },
  { id: "review", label: "Review", icon: "checkCircle", blurb: "Score and what to fix" },
  { id: "versions", label: "Versions", icon: "copy", blurb: "Saved variants of this resume" },
  { id: "help", label: "Help", icon: "info", blurb: "Shortcuts and how this works" },
];

// groups that start open the first time a panel is opened
const DEFAULT_OPEN = new Set([
  "lib-add", "lib-hidden", "design-layout", "design-font", "design-page",
  "opt-job", "opt-tips", "rev-score", "rev-tips", "ver-list",
]);

export class PanelHost {
  constructor(root, { onFocusSection, onApplyAction }) {
    this.root = root;
    this.onFocusSection = onFocusSection;
    this.onApplyAction = onApplyAction;
    this.query = "";
    this.review = null;
    this.reviewDirty = true;
    this.recomputeReview = debounce(() => {
      this.reviewDirty = true;
      if (store.ui.panel === "review" || store.ui.panel === "optimize") this.render();
    }, 400);
  }

  invalidate() {
    this.recomputeReview();
  }

  getReview() {
    if (this.reviewDirty || !this.review) {
      this.review = reviewDocument(store.doc);
      this.reviewDirty = false;
    }
    return this.review;
  }

  isOpen(id) {
    const saved = store.ui.groups?.[id];
    return saved === undefined ? DEFAULT_OPEN.has(id) : saved;
  }

  // a collapsible block whose open state persists, so a panel reopens as it was left
  group(id, name, tail, build) {
    const open = this.isOpen(id);
    const body = h("div", { class: "group-body" });
    if (open) body.appendChild(build());

    const head = h("button", {
      class: "group-head",
      "aria-expanded": String(open),
      onclick: () => {
        const next = head.getAttribute("aria-expanded") !== "true";
        head.setAttribute("aria-expanded", String(next));
        store.setUi({ groups: { ...(store.ui.groups || {}), [id]: next } }, { reason: "group" });
        clear(body);
        if (next) body.appendChild(build());
      },
    },
      icon("chevronRight", 13, "group-chev"),
      h("span", { class: "group-name" }, name),
      tail && h("span", { class: "group-tail" }, tail));

    return h("div", { class: "panel-group" }, head, body);
  }

  render() {
    const panel = store.ui.panel || "sections";
    clear(this.root);
    const builder = {
      sections: () => this.buildSections(),
      design: () => this.buildDesign(),
      optimize: () => this.buildOptimize(),
      review: () => this.buildReview(),
      versions: () => this.buildVersions(),
      help: () => this.buildHelp(),
    }[panel];
    this.root.appendChild(builder ? builder() : this.buildSections());
  }

  shell(content, foot) {
    return h("div", { style: { display: "contents" } },
      h("div", { class: "panel-scroll" }, content),
      foot && h("div", { class: "panel-foot" }, foot));
  }

  /* library */

  buildSections() {
    const search = h("div", { class: "panel-search" },
      icon("search", 14),
      h("input", {
        class: "input",
        type: "search",
        placeholder: "Search sections",
        value: this.query,
        "aria-label": "Search sections",
        oninput: (event) => {
          this.query = event.target.value;
          this.renderLibrary();
        },
      }));

    this.libraryHost = h("div");
    this.renderLibrary();
    return this.shell(h("div", null, search, this.libraryHost));
  }

  renderLibrary() {
    if (!this.libraryHost) return;
    clear(this.libraryHost);
    const doc = store.doc;
    const query = this.query.trim();

    const hidden = doc.sections.filter((s) => !s.visible);
    if (hidden.length && !query) {
      this.libraryHost.appendChild(this.group("lib-hidden", "Switched off", String(hidden.length), () =>
        h("div", { style: { display: "grid", gap: "2px" } }, hidden.map((section) => h("button", {
          class: "lib-item",
          onclick: () => store.commit(`Show ${section.title}`, (d) => {
            const target = d.sections.find((s) => s.id === section.id);
            if (target) target.visible = true;
          }),
        },
          h("span", { class: "lib-glyph" }, typeInfo(section.type).glyph),
          h("span", { class: "lib-body" },
            h("span", { class: "lib-name" }, section.title),
            h("span", { class: "lib-sub" }, isSectionEmpty(section) ? "Empty" : summaryOf(section))),
          h("span", { class: "lib-add" }, icon("eye", 15)))))));
    }

    const candidates = LIBRARY_ORDER.map((type) => ({ type, info: SECTION_TYPES[type] }));
    const scored = query
      ? candidates
          .map((candidate) => {
            const match = fuzzyMatch(query, candidate.info.label) || fuzzyMatch(query, candidate.info.aliases.join(" "));
            return match ? { ...candidate, score: match.score } : null;
          })
          .filter(Boolean)
          .sort((a, b) => b.score - a.score)
      : candidates;

    if (!scored.length) {
      this.libraryHost.append(
        h("div", { class: "empty-note" }, `Nothing matches "${escapeHtml(query)}".`),
        h("button", {
          class: "btn btn-ghost btn-block",
          style: { marginTop: "8px" },
          onclick: () => this.addCustom(query),
        }, "Create a custom section"));
      return;
    }

    const rows = () => h("div", { style: { display: "grid", gap: "2px" } }, scored.map(({ type, info }) => h("button", {
      class: "lib-item",
      onclick: () => {
        if (type === "custom") return this.addCustom("");
        const section = store.addSection(type);
        toast({ title: `${section.title} added`, tone: "good", key: "add-section" });
        this.onFocusSection?.(section.id);
      },
    },
      h("span", { class: "lib-glyph" }, info.glyph),
      h("span", { class: "lib-body" },
        h("span", { class: "lib-name" }, info.label),
        h("span", { class: "lib-sub" }, info.blurb)),
      h("span", { class: "lib-add" }, icon("plus", 15)))));

    if (query) this.libraryHost.appendChild(rows());
    else this.libraryHost.appendChild(this.group("lib-add", "Add a section", String(scored.length), rows));
  }

  async addCustom(seed) {
    const name = await promptDialog({
      title: "New custom section",
      label: "Heading",
      value: seed,
      placeholder: "Conference Talks",
      confirmLabel: "Add section",
    });
    if (!name) return;
    const section = store.addSection("custom", { patch: { title: name } });
    this.onFocusSection?.(section.id);
  }

  /* layout */

  buildDesign() {
    const doc = store.doc;

    const setting = (label, value, options, onChange) => h("div", { class: "field" },
      h("label", null, label),
      h("select", { class: "select", onchange: (event) => onChange(event.target.value) },
        options.map(([id, name]) => h("option", { value: id, selected: id === value }, name))));

    const layouts = this.group("design-layout", "Layout", TEMPLATES.find((t) => t.id === doc.template)?.name, () =>
      h("div", { style: { display: "grid", gap: "4px" } }, TEMPLATES.map((template) => h("button", {
        class: `ver-item${doc.template === template.id ? " is-on" : ""}`,
        onclick: () => store.commit("Change layout", (d) => { d.template = template.id; }),
      },
        h("span", { class: "lib-glyph" }, template.columns === 2 ? "▥" : "▤"),
        h("span", { class: "ver-body" },
          h("span", { class: "ver-name" }, template.name),
          h("span", { class: "ver-sub" }, template.blurb))))));

    const fonts = this.group("design-font", "Typeface", activeFontLabel(doc), () => this.buildFontControls(doc));

    const page = this.group("design-page", "Page setup", null, () =>
      h("div", { style: { display: "grid", gap: "10px" } },
        setting("Paper size", doc.settings.pageSize,
          Object.entries(PAGE_SIZES).map(([id, size]) => [id, size.label]),
          (value) => store.commit("Page size", (d) => { d.settings.pageSize = value; })),
        setting("Margins", doc.settings.margin,
          Object.entries(MARGINS).map(([id, margin]) => [id, margin.label]),
          (value) => store.commit("Margins", (d) => { d.settings.margin = value; })),
        setting("Spacing", doc.settings.density,
          [["tight", "Tight"], ["normal", "Normal"], ["roomy", "Roomy"]],
          (value) => store.commit("Spacing", (d) => { d.settings.density = value; })),
        setting("Lines under headings", doc.settings.sectionRules,
          [["on", "Show"], ["off", "Hide"], ["auto", "Follow the layout"]],
          (value) => store.commit("Section rules", (d) => { d.settings.sectionRules = value; })),
        setting("Text size", String(doc.settings.scale),
          [["0.9", "Small"], ["0.95", "Compact"], ["1", "Default"], ["1.05", "Large"], ["1.1", "Larger"]],
          (value) => store.commit("Text size", (d) => { d.settings.scale = Number(value); }))));

    const twoColumn = TEMPLATES.find((t) => t.id === doc.template)?.columns === 2;
    const note = twoColumn
      ? h("div", { class: "empty-note", style: { marginTop: "12px", textAlign: "left" } },
          "Skills, languages, certifications and interests move to the side column automatically. Two columns can confuse older applicant tracking systems, so check the ATS text view before applying through a portal.")
      : null;

    return this.shell(h("div", null, layouts, fonts, page, note));
  }

  // one control sets the typeface for the whole document. "imported" and "layout default" are
  // options in the same list so there is a single place to look
  buildFontControls(doc) {
    const fonts = doc.settings.fonts;
    const wrap = h("div", { style: { display: "grid", gap: "8px" } });

    const current = doc.settings.fontOverride
      ? doc.settings.fontOverride
      : (fonts?.body && doc.settings.keepFonts !== false) ? "imported" : "layout";

    const options = [];
    if (fonts?.body) options.push(h("option", { value: "imported", selected: current === "imported" }, `From my file (${fonts.body.label})`));
    options.push(h("option", { value: "layout", selected: current === "layout" }, `Layout default (${TEMPLATES.find((t) => t.id === doc.template)?.name})`));

    for (const [label, generic] of [["Sans serif", "sans-serif"], ["Serif", "serif"], ["Monospace", "monospace"]]) {
      const group = h("optgroup", { label });
      for (const font of FONT_CHOICES.filter((f) => f.generic === generic)) {
        group.appendChild(h("option", { value: font.id, selected: current === font.id }, font.label));
      }
      options.push(group);
    }

    wrap.appendChild(h("div", { class: "field" },
      h("label", null, "Font for the whole resume"),
      h("select", {
        class: "select",
        onchange: (event) => {
          const value = event.target.value;
          store.commit("Change font", (d) => {
            if (value === "imported") { d.settings.fontOverride = null; d.settings.keepFonts = true; }
            else if (value === "layout") { d.settings.fontOverride = null; d.settings.keepFonts = false; }
            else d.settings.fontOverride = value;
          });
          this.render();
        },
      }, options)));

    const chosen = FONT_CHOICES.find((f) => f.id === doc.settings.fontOverride);
    wrap.appendChild(h("p", { class: "hint", style: { lineHeight: "1.5" } },
      chosen
        ? `Everything on the page is set in ${chosen.label}. Exports use the same font, and switching layout only changes the arrangement.`
        : current === "imported"
          ? "The typeface from your imported file is used everywhere, so switching layout rearranges the page without restyling the text."
          : "Each layout brings its own typeface. Pick a font above to set one for the whole resume instead."));

    if (!fonts?.body) {
      wrap.appendChild(h("div", { class: "empty-note", style: { textAlign: "left" } },
        "No embedded font was detected in this document. Importing a PDF, Word or LaTeX file carries its font across automatically."));
    }

    return wrap;
  }

  /* optimize */

  buildOptimize() {
    const doc = store.doc;
    const job = doc.job || {};

    const field = (key, label, placeholder, multiline = false) => {
      const node = h(multiline ? "textarea" : "input", {
        class: multiline ? "textarea" : "input",
        placeholder,
        value: job[key] || "",
        rows: multiline ? 8 : null,
        oninput: (event) => {
          store.commit("Job description", (d) => { d.job[key] = event.target.value; },
            { reason: "edit", coalesce: `job:${key}`, silent: true });
          if (key === "description") this.invalidate();
        },
      });
      return h("div", { class: "field" }, h("label", null, label), node);
    };

    const form = this.group("opt-job", "The posting", job.title || null, () =>
      h("div", { style: { display: "grid", gap: "10px" } },
        field("title", "Job title", "Software Engineer Intern"),
        field("company", "Company", "Acme"),
        field("url", "Link", "acme.com/careers/123"),
        field("description", "Paste the full description", "Everything is analysed on your device.", true)));

    const host = h("div");
    const review = this.getReview();

    if (!review.job.terms.length) {
      host.appendChild(h("div", { class: "empty-note", style: { marginTop: "12px" } },
        "Paste a description to see which of its terms already appear in your resume."));
    } else {
      const { match, job: analysis } = review;
      host.appendChild(h("div", { class: "score-hero", style: { marginTop: "12px" } },
        h("span", { class: "score-num" }, `${Math.round(match.coverage * 100)}%`),
        h("span", { class: "score-cap" }, `${match.hits.length} of ${analysis.terms.length} key terms covered`)));

      const buckets = {
        technology: "Technologies",
        skill: "Skills",
        soft: "Soft skills",
        certification: "Certifications",
        domain: "Domain language",
      };
      for (const [key, label] of Object.entries(buckets)) {
        const terms = analysis.buckets[key];
        if (!terms?.length) continue;
        host.appendChild(this.group(`opt-${key}`, label, String(terms.length), () =>
          h("div", { class: "kw-cloud" }, terms.slice(0, 24).map((term) => {
            const hit = match.hits.find((entry) => entry.term === term.term);
            return h("span", {
              class: `kw ${hit ? "is-hit" : "is-miss"}`,
              title: hit
                ? `${term.count} times in the posting, ${hit.resumeCount} in your resume`
                : `${term.count} times in the posting, not found in your resume`,
            }, term.term, h("span", { class: "kw-n" }, String(term.count)));
          }))));
      }

      if (analysis.verbs.length) {
        host.appendChild(this.group("opt-verbs", "Verbs it uses", String(analysis.verbs.length), () =>
          h("div", { class: "kw-cloud" }, analysis.verbs.map((verb) =>
            h("span", { class: "kw" }, verb.term, h("span", { class: "kw-n" }, String(verb.count)))))));
      }

      host.appendChild(this.group("opt-tips", "Suggestions", String(review.suggestions.length), () =>
        h("div", { style: { display: "grid", gap: "6px" } }, review.suggestions.map((s) => this.buildTip(s)))));

      host.appendChild(h("p", { class: "hint", style: { marginTop: "12px", lineHeight: "1.5" } },
        "Suggestions never rewrite your wording and never add a skill for you. Anything you accept is applied as a reorder or a visibility change, and undo covers all of it."));
    }

    return this.shell(h("div", null, form, host));
  }

  buildTip(suggestion) {
    const node = h("div", { class: "tip", "data-tone": suggestion.tone },
      h("div", { class: "tip-top" }, h("span", { class: "tip-kind" }, suggestion.kind)),
      h("div", { class: "tip-text", _html: suggestion.text }));

    if (suggestion.action) {
      node.appendChild(h("div", { class: "tip-acts" },
        h("button", {
          class: "btn btn-ghost",
          onclick: () => {
            this.onApplyAction?.(suggestion.action);
            node.classList.add("is-applied");
          },
        }, suggestion.action.label)));
    }
    return node;
  }

  /* review */

  buildReview() {
    const review = this.getReview();
    const verdict = review.overall >= 80
      ? "Strong"
      : review.overall >= 60 ? "Solid, with gaps" : review.overall >= 40 ? "Needs work" : "Early draft";

    const hero = h("div", { class: "score-hero" },
      h("span", { class: "score-num" }, String(review.overall)),
      h("span", { class: "score-cap" }, `${verdict}. ${review.stats.words} words across ${plural(review.stats.sections, "section")}`));

    const breakdown = this.group("rev-score", "Breakdown", null, () =>
      h("div", { style: { display: "grid", gap: "11px" } }, review.categories.map((category) =>
        h("div", { class: "meter", "data-tone": category.tone },
          h("div", { class: "meter-top" },
            h("span", { class: "meter-name" }, category.label),
            h("span", { class: "meter-val" }, category.inactive ? "n/a" : String(category.score))),
          h("div", { class: "meter-track" },
            h("div", { class: "meter-fill", style: { width: `${category.inactive ? 0 : category.score}%` } })),
          h("div", { class: "meter-note" }, category.note)))));

    const tips = this.group("rev-tips", "What to do next", String(review.suggestions.length), () =>
      h("div", { style: { display: "grid", gap: "6px" } }, review.suggestions.map((s) => this.buildTip(s))));

    return this.shell(h("div", null, hero, breakdown, tips));
  }

  /* versions */

  buildVersions() {
    const list = this.group("ver-list", "Saved here", String(store.versions.length), () =>
      h("div", { style: { display: "grid", gap: "5px" } }, store.versions.map((version) => {
        const isActive = version.id === store.activeId;
        return h("div", { class: `ver-item${isActive ? " is-on" : ""}` },
          h("button", {
            class: "ver-body",
            style: { textAlign: "left" },
            onclick: () => store.switchVersion(version.id),
          },
            h("span", { class: "ver-name" }, version.name),
            h("span", { class: "ver-sub" },
              `${plural(version.sections.filter((s) => s.visible).length, "section")}, edited ${formatRelative(version.updatedAt)}`)),
          h("button", {
            class: "icon-btn sm",
            "aria-label": `Options for ${version.name}`,
            onclick: (event) => openMenu(event.currentTarget, [
              { label: "Rename", icon: icon("file", 15), onClick: () => this.renameVersion(version) },
              { label: "Duplicate", icon: icon("copy", 15), onClick: () => this.duplicateVersion(version) },
              { separator: true },
              {
                label: "Delete",
                icon: icon("trash", 15),
                danger: true,
                disabled: store.versions.length <= 1,
                onClick: () => this.deleteVersion(version),
              },
            ]),
          }, icon("more", 15)));
      })));

    const presets = ["Software Engineering", "Data Science", "Internship", "Research", "Product"];
    const quick = this.group("ver-presets", "Start a tailored copy", null, () =>
      h("div", { class: "kw-cloud" }, presets.map((preset) => h("button", {
        class: "kw",
        style: { cursor: "pointer" },
        onclick: () => {
          store.createVersion(`${preset} resume`, store.doc);
          toast({ title: "Version created", message: `${preset} resume`, tone: "good" });
        },
      }, preset))));

    const foot = h("button", {
      class: "btn btn-ghost btn-block",
      onclick: () => this.duplicateVersion(store.doc),
    }, icon("copy", 14), "Duplicate this version");

    return this.shell(h("div", null, list, quick), foot);
  }

  async renameVersion(version) {
    const name = await promptDialog({ title: "Rename version", label: "Name", value: version.name });
    if (name) store.renameVersion(version.id, name);
  }

  async duplicateVersion(version) {
    const name = await promptDialog({
      title: "Duplicate version",
      label: "Name for the copy",
      value: `${version.name} copy`,
      confirmLabel: "Create",
    });
    if (!name) return;
    store.createVersion(name, version);
    toast({ title: "Version created", message: name, tone: "good" });
  }

  async deleteVersion(version) {
    const ok = await confirmDialog({
      title: `Delete "${version.name}"?`,
      description: "This version and its history are removed from this device. It cannot be undone.",
      confirmLabel: "Delete version",
      danger: true,
    });
    if (!ok) return;
    store.deleteVersion(version.id);
    toast({ title: "Version deleted", message: version.name });
  }

  /* help */

  buildHelp() {
    const row = (keys, description) => h("div", {
      style: { display: "flex", justifyContent: "space-between", gap: "12px", padding: "5px 0", fontSize: "12.5px" },
    },
      h("span", { class: "muted" }, description),
      h("span", { style: { display: "flex", gap: "3px", flex: "none" } }, keys.map((key) => h("kbd", null, key))));

    const groups = [
      ["help-general", "General", [
        [["Ctrl K"], "Command palette"],
        [["Ctrl Z"], "Undo"],
        [["Ctrl Shift Z"], "Redo"],
        [["Ctrl S"], "Export"],
        [["Ctrl O"], "Import a file"],
        [["Ctrl \\"], "Toggle the tools panel"],
        [["Ctrl Shift \\"], "Toggle the sections panel"],
        [["?"], "Open help"],
      ]],
      ["help-cards", "Cards", [
        [["Space"], "Pick up a focused card"],
        [["Up", "Down"], "Move a picked-up card"],
        [["Esc"], "Cancel the move"],
        [["Ctrl click"], "Select several cards"],
        [["Ctrl D"], "Duplicate the focused card"],
        [["Enter"], "New bullet"],
        [["Backspace"], "Delete an empty bullet"],
      ]],
      ["help-page", "Page", [
        [["Ctrl +"], "Zoom in"],
        [["Ctrl -"], "Zoom out"],
        [["Ctrl 0"], "Reset zoom"],
      ]],
    ];

    const content = h("div", null,
      ...groups.map(([id, title, rows]) => this.group(id, title, null, () =>
        h("div", null, rows.map(([keys, description]) => row(keys, description))))),
      this.group("help-data", "Where your data lives", null, () =>
        h("p", { class: "hint", style: { lineHeight: "1.55" } },
          "Everything stays in this browser's local storage. Nothing is uploaded, there is no account, and the job description analysis runs on your device. Clearing site data clears your resumes, so export anything you want to keep.")));

    return this.shell(content);
  }
}

function summaryOf(section) {
  if (section.layout === "entries") return (section.items[0]?.title || "Entries").slice(0, 40);
  if (section.layout === "bullets") return (section.bullets[0] || "").slice(0, 40);
  if (section.layout === "inline") return (section.groups[0]?.items || "").slice(0, 40);
  if (section.layout === "prose") return (section.body || "").slice(0, 40);
  return "";
}
