import { h, clear, icon } from "../lib/dom.js";
import { countWords, plural } from "../lib/util.js";
import { store } from "../store.js";
import { typeInfo, SECTION_TYPES } from "../schema.js";
import { ruleIsOn } from "../templates/render.js";
import { diagnose, TRANSFORMS, starCoverage, quantifyPrompts, unusedVerbs } from "../analysis/writing.js";
import { analyzeJobDescription, countTerm } from "../analysis/keywords.js";
import { writeValue } from "./pageEdit.js";
import { toast } from "./toasts.js";

// tools for whatever the caret is in
// the panel is built from the selection rather than from the section, so the same bullet gets
// different help depending on whether it sits under Experience or under Awards. every suggestion
// is shown as the resulting text with accept and dismiss; nothing is applied on the user's behalf

const TRANSFORM_ORDER = ["strengthen", "shorten", "dropPronouns", "plainText", "sentenceCase"];

export function buildInspector(selection, { onRefresh }) {
  const wrap = h("div", { class: "inspect" });
  if (!selection?.sectionId) return emptyState(wrap);

  const section = store.section(selection.sectionId);
  if (!section) return emptyState(wrap);

  const item = selection.itemId ? section.items?.find((i) => i.id === selection.itemId) : null;
  wrap.appendChild(contextHeader(section, item, selection));

  const isProse = selection.kind === "bullet" || selection.kind === "sectionBullet" || selection.kind === "prose";

  if (isProse && selection.text) {
    wrap.append(
      transformBlock(selection, onRefresh),
      diagnosticsBlock(selection, section, onRefresh),
    );
    if (selection.kind !== "prose") {
      wrap.append(starBlock(selection), quantifyBlock(selection), verbBlock(selection));
    }
  } else if (selection.kind === "group") {
    wrap.appendChild(skillsBlock(section));
  } else if (selection.kind === "dates") {
    wrap.appendChild(datesBlock());
  } else if (selection.kind === "sectionTitle") {
    wrap.appendChild(headingBlock(section, selection, onRefresh));
    wrap.appendChild(ruleBlock(section, onRefresh));
  } else if (selection.kind === "contact") {
    wrap.appendChild(contactBlock(selection));
  } else if (selection.text) {
    wrap.appendChild(transformBlock(selection, onRefresh));
  }

  wrap.appendChild(sectionAdviceBlock(section));
  return wrap;
}

function emptyState(wrap) {
  wrap.appendChild(h("div", { class: "inspect-empty" },
    icon("target", 22),
    h("h3", null, "Nothing selected"),
    h("p", null, "Click any text on the page. Tools for that exact line appear here: rewrites, what is missing, and how it reads to a scanner.")));
  return wrap;
}

function contextHeader(section, item, selection) {
  const info = typeInfo(section.type);
  const what = {
    bullet: "Bullet",
    sectionBullet: "Bullet",
    prose: "Paragraph",
    item: fieldLabel(selection.field),
    dates: "Dates",
    group: "Skill group",
    sectionTitle: "Section heading",
    contact: fieldLabel(selection.field),
    link: "Link",
    meta: "Detail line",
  }[selection.kind] || "Text";

  const where = item?.title || item?.org || section.title;

  return h("div", { class: "inspect-head" },
    h("span", { class: "inspect-kind" }, what),
    h("span", { class: "inspect-where" }, `${info.label} · ${where}`),
    selection.text ? h("span", { class: "inspect-count" },
      `${plural(countWords(selection.text), "word")}, ${selection.text.length} characters`) : null);
}

const fieldLabel = (field) => ({
  title: "Title", org: "Organization", location: "Location", name: "Name",
  headline: "Headline", email: "Email", phone: "Phone", hours: "Hours per week",
  salary: "Salary", supervisor: "Supervisor",
}[field] || "Field");

// a rewrite is only offered when it would actually change the line
function transformBlock(selection, onRefresh) {
  const options = TRANSFORM_ORDER
    .map((id) => ({ id, ...TRANSFORMS[id], result: TRANSFORMS[id].run(selection.text) }))
    .filter((option) => option.result);

  if (!options.length) {
    return h("div", { class: "inspect-group" },
      h("span", { class: "label" }, "Rewrite"),
      h("div", { class: "inspect-clean" }, icon("checkCircle", 15), h("span", null, "Nothing mechanical left to fix here.")));
  }

  const body = h("div", { class: "inspect-actions" });
  const preview = h("div", { class: "inspect-preview", hidden: true });

  for (const option of options) {
    body.appendChild(h("button", {
      class: "chip-btn",
      title: option.hint,
      onclick: () => showProposal(preview, selection, option, onRefresh),
    }, option.label));
  }

  return h("div", { class: "inspect-group" },
    h("span", { class: "label" }, "Rewrite"),
    body,
    preview);
}

// the proposal is shown as the finished sentence, not as a diff of tokens, because that is what
// the user has to judge
function showProposal(host, selection, option, onRefresh) {
  clear(host);
  host.hidden = false;

  host.append(
    h("div", { class: "inspect-proposal" },
      h("span", { class: "inspect-proposal-label" }, option.label),
      h("p", { class: "inspect-before" }, selection.text),
      h("p", { class: "inspect-after" }, option.result)),
    h("div", { class: "inspect-confirm" },
      h("button", {
        class: "btn btn-primary",
        onclick: () => {
          if (writeValue(selection, option.result)) {
            toast({ tone: "good", title: option.label, message: "Applied. Undo puts it back.", key: "rewrite" });
            onRefresh?.();
          }
        },
      }, "Apply"),
      h("button", {
        class: "btn btn-ghost",
        onclick: () => { host.hidden = true; clear(host); },
      }, "Dismiss")));
}

function diagnosticsBlock(selection, section, onRefresh) {
  const siblings = selection.itemId
    ? section.items?.find((i) => i.id === selection.itemId)?.bullets || []
    : section.bullets || [];
  const siblingsEndWithout = siblings.some((line, index) => index !== selection.index && line.trim() && !/[.!?]$/.test(line.trim()));

  const issues = diagnose(selection.text, { siblingsEndWithout });
  if (!issues.length) {
    return h("div", { class: "inspect-group" },
      h("span", { class: "label" }, "Checks"),
      h("div", { class: "inspect-clean" }, icon("checkCircle", 15), h("span", null, "Reads well. Opens with a verb and carries a result.")));
  }

  return h("div", { class: "inspect-group" },
    h("span", { class: "label" }, `Checks (${issues.length})`),
    h("div", { style: { display: "grid", gap: "6px" } }, issues.map((issue) => {
      const transform = issue.fix && TRANSFORMS[issue.fix];
      const result = transform?.run(selection.text);
      return h("div", { class: "inspect-issue", "data-severity": issue.severity },
        h("div", { class: "inspect-issue-top" },
          h("span", { class: "inspect-dot" }),
          h("span", { class: "inspect-issue-label" }, issue.label)),
        h("p", { class: "inspect-issue-detail" }, issue.detail),
        result ? h("button", {
          class: "link-btn",
          onclick: () => {
            if (writeValue(selection, result)) {
              toast({ tone: "good", title: transform.label, message: "Applied. Undo puts it back.", key: "rewrite" });
              onRefresh?.();
            }
          },
        }, `${transform.label} for me`) : null);
    })));
}

function starBlock(selection) {
  const parts = starCoverage(selection.text);
  const have = parts.filter((part) => part.present).length;

  return h("div", { class: "inspect-group" },
    h("span", { class: "label" }, `STAR coverage (${have} of ${parts.length})`),
    h("div", { class: "star-grid" }, parts.map((part) => h("div", {
      class: `star-cell${part.present ? " is-on" : ""}`,
      title: part.prompt,
    },
      icon(part.present ? "checkCircle" : "info", 13),
      h("span", null, part.part)))),
    h("div", { style: { display: "grid", gap: "4px", marginTop: "6px" } },
      parts.filter((part) => !part.present).map((part) =>
        h("p", { class: "inspect-prompt" }, part.prompt))));
}

function quantifyBlock(selection) {
  const prompts = quantifyPrompts(selection.text);
  return h("div", { class: "inspect-group" },
    h("span", { class: "label" }, "Add a number"),
    h("div", { style: { display: "grid", gap: "4px" } },
      prompts.map((prompt) => h("p", { class: "inspect-prompt" }, prompt))),
    h("p", { class: "hint", style: { marginTop: "6px", lineHeight: "1.5" } },
      "Only you know these figures, so nothing is filled in for you. Type them straight into the line on the page."));
}

function verbBlock(selection) {
  const used = [];
  for (const section of store.doc.sections) {
    for (const item of section.items || []) {
      for (const line of item.bullets || []) {
        const first = line.trim().split(/\s+/)[0];
        if (first) used.push(first.toLowerCase());
      }
    }
  }
  const alternatives = unusedVerbs(used, 10);
  if (!alternatives.length) return h("span");

  return h("div", { class: "inspect-group" },
    h("span", { class: "label" }, "Verbs not used elsewhere"),
    h("div", { class: "kw-cloud" }, alternatives.map((verb) => h("span", { class: "kw" }, verb))),
    h("p", { class: "hint", style: { marginTop: "6px", lineHeight: "1.5" } },
      "Repeating the same opener across bullets makes them blur together."));
}

// skills get compared against the pasted posting, which is the one place a genuine gap can be
// identified without guessing
function skillsBlock(section) {
  const description = store.doc.job?.description || "";
  const text = (section.groups || []).map((group) => `${group.label} ${group.items}`).join(" ").toLowerCase();

  if (!description.trim()) {
    return h("div", { class: "inspect-group" },
      h("span", { class: "label" }, "Skills"),
      h("div", { class: "empty-note", style: { textAlign: "left" } },
        "Paste a job description under Optimize and the terms it asks for that are missing here will be listed."));
  }

  const job = analyzeJobDescription(description);
  const missing = job.terms.filter((term) => countTerm(text, term.term) === 0).slice(0, 14);
  const groups = (section.groups || []).filter((group) => group.label?.trim()).length;
  const total = (section.groups || []).reduce((sum, group) => sum + group.items.split(",").filter((x) => x.trim()).length, 0);

  return h("div", { class: "inspect-group" },
    h("span", { class: "label" }, "Asked for but not listed"),
    missing.length
      ? h("div", { class: "kw-cloud" }, missing.map((term) => h("span", {
          class: "kw is-miss",
          title: `${term.count} mentions in the posting`,
        }, term.term)))
      : h("div", { class: "inspect-clean" }, icon("checkCircle", 15), h("span", null, "Every key term from the posting appears here.")),
    h("p", { class: "hint", style: { marginTop: "8px", lineHeight: "1.5" } },
      "Add only what you have actually used. A skill you cannot discuss in an interview costs more than a gap."),
    total > 24 && groups < 3
      ? h("p", { class: "inspect-prompt", style: { marginTop: "6px" } },
          `${total} skills in ${plural(groups || 1, "group")}. Three or four labelled rows scan faster than one long list.`)
      : null);
}

function datesBlock() {
  return h("div", { class: "inspect-group" },
    h("span", { class: "label" }, "Dates"),
    h("p", { class: "inspect-prompt" }, "Type the range as one field, for example \"Jan 2026 - Present\". It is split back into a start and an end."),
    h("p", { class: "inspect-prompt" }, "The format across the whole resume is set under Layout, so a single control keeps every entry consistent."),
    h("button", {
      class: "link-btn",
      onclick: () => {
        store.setUi({ panel: "design", rightOpen: true }, { reason: "panel" });
      },
    }, "Open date formatting"));
}

// applicant tracking systems key off familiar headings, so the standard names for this section
// type are offered directly
function headingBlock(section, selection, onRefresh) {
  const info = SECTION_TYPES[section.type];
  const options = [info.label, ...(info.aliases || [])]
    .map((alias) => alias.replace(/\b\w/g, (c) => c.toUpperCase()))
    .filter((alias, index, all) => alias.toLowerCase() !== selection.text.toLowerCase() && all.indexOf(alias) === index)
    .slice(0, 6);

  return h("div", { class: "inspect-group" },
    h("span", { class: "label" }, "Heading"),
    h("p", { class: "hint", style: { lineHeight: "1.5" } },
      "Parsers match on familiar names. An invented heading can drop the whole section from a profile."),
    options.length
      ? h("div", { class: "inspect-actions", style: { marginTop: "8px" } }, options.map((alias) => h("button", {
          class: "chip-btn",
          onclick: () => {
            if (writeValue(selection, alias)) {
              toast({ tone: "good", title: "Heading renamed", message: alias, key: "rename" });
              onRefresh?.();
            }
          },
        }, alias)))
      : null);
}

// the line under this one heading, independent of the rest of the document. the same toggle sits
// on the page itself; this is the discoverable copy
function ruleBlock(section, onRefresh) {
  const doc = store.doc;
  const drawn = ruleIsOn(section, doc);
  const own = section.rule !== null;

  const choose = (value) => {
    store.commit("Section line", (d) => {
      const target = d.sections.find((s) => s.id === section.id);
      if (!target) return false;
      target.rule = value;
    });
    onRefresh?.();
  };

  const option = (label, value, active) => h("button", {
    class: `chip-btn${active ? " is-on" : ""}`,
    "aria-pressed": String(active),
    onclick: () => choose(value),
  }, label);

  return h("div", { class: "inspect-group" },
    h("span", { class: "label" }, "Line under this heading"),
    h("div", { class: "inspect-actions" },
      option("Draw it", true, section.rule === true),
      option("Drop it", false, section.rule === false),
      option("Follow the layout", null, !own)),
    h("p", { class: "inspect-prompt" },
      own
        ? `This section has its own setting. The rest of the resume is currently ${(doc.settings.style?.divider || "thin") === "none" ? "drawing no line" : "drawing a line"}.`
        : `Following the document, which ${drawn ? "draws a line" : "draws no line"}. Change it under Design to move every section at once.`));
}

function contactBlock(selection) {
  const checks = [];
  const value = selection.text;

  if (selection.field === "email") {
    checks.push({
      ok: /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(value),
      label: "Looks like a valid address",
      fail: "Parsers reject a contact block with no readable email.",
    });
    checks.push({
      ok: !/@(?:aol|hotmail|yahoo)\./i.test(value),
      label: "Modern provider",
      fail: "Some readers treat older providers as a signal about currency. Optional.",
    });
  }
  if (selection.field === "phone") {
    checks.push({
      ok: value.replace(/\D/g, "").length >= 10,
      label: "Enough digits to dial",
      fail: "Include the area code.",
    });
  }
  if (selection.field === "name") {
    checks.push({
      ok: value.split(/\s+/).length >= 2,
      label: "First and last name",
      fail: "Federal and most corporate systems expect a full legal name.",
    });
  }

  return h("div", { class: "inspect-group" },
    h("span", { class: "label" }, "Checks"),
    checks.length
      ? h("div", { style: { display: "grid", gap: "6px" } }, checks.map((check) => h("div", {
          class: "inspect-issue",
          "data-severity": check.ok ? "ok" : "medium",
        },
          h("div", { class: "inspect-issue-top" },
            icon(check.ok ? "checkCircle" : "warn", 15),
            h("span", { class: "inspect-issue-label" }, check.label)),
          check.ok ? null : h("p", { class: "inspect-issue-detail" }, check.fail))))
      : h("p", { class: "inspect-prompt" }, "Keep this line short. Everything here competes with the first job for attention."));
}

// advice that belongs to the section as a whole rather than the line
const SECTION_ADVICE = {
  experience: "Three to five bullets per role. Lead each with a verb and end with what changed.",
  projects: "Say what it does, what you built it with, and what it achieved. A link earns its space.",
  education: "Once you have a year of work behind you, this belongs below Experience.",
  skills: "Group into three or four labelled rows. A flat list of thirty reads as noise.",
  summary: "Two or three lines. Say what you do, at what level, and what you are aiming at.",
  awards: "Give the awarding body and the year. An unfamiliar award means nothing without them.",
  certifications: "Include the issuer and the valid range. Expired credentials are worth listing as expired.",
  clearance: "State the level, the granting agency and whether it is current. Never include the investigation detail.",
  ksa: "Mirror the wording of the announcement. Federal panels score against the wording they published.",
  leadership: "Say how many people or how large the budget. Scope is what separates leadership from involvement.",
};

function sectionAdviceBlock(section) {
  const advice = SECTION_ADVICE[section.type];
  if (!advice) return h("span");
  return h("div", { class: "inspect-group inspect-advice" },
    h("span", { class: "label" }, `About ${typeInfo(section.type).label}`),
    h("p", { class: "inspect-prompt" }, advice));
}
