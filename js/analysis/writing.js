import { ACTION_VERBS, WEAK_OPENERS, VERB_SET, tokenize } from "./keywords.js";
import { countWords } from "../lib/util.js";

// sentence level writing help
// every rule here is deterministic and every rewrite is mechanical: something is removed,
// reordered or substituted from a fixed table. nothing is generated, because a resume is a claim
// about what someone actually did and a plausible sentence is worse than no sentence

const FILLER = [
  "successfully", "effectively", "efficiently", "various", "several", "a variety of",
  "in order to", "as needed", "on a daily basis", "on a regular basis", "utilized", "utilised",
  "responsible for", "tasked with", "helped to", "worked to", "served as", "duties included",
  "including but not limited to", "actively", "closely", "heavily", "basically", "really",
  "very", "quite", "extremely", "highly motivated", "hard working", "team player",
];

// the shorter, plainer form of a phrase that says the same thing
const TIGHTEN = [
  [/\bin order to\b/gi, "to"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bfor the purpose of\b/gi, "to"],
  [/\bwith the goal of\b/gi, "to"],
  [/\bin an effort to\b/gi, "to"],
  [/\bmade use of\b/gi, "used"],
  [/\butili[sz]ed\b/gi, "used"],
  [/\butili[sz]ing\b/gi, "using"],
  [/\ba number of\b/gi, "several"],
  [/\bat this point in time\b/gi, "now"],
  [/\bon a daily basis\b/gi, "daily"],
  [/\bon a regular basis\b/gi, "regularly"],
  [/\bin the process of\b/gi, ""],
  [/\bwas able to\b/gi, ""],
  [/\bhelped to\b/gi, "helped"],
  [/\bassisted with\b/gi, "supported"],
  [/\bincluding but not limited to\b/gi, "including"],
  [/\bas well as\b/gi, "and"],
];

// a weak opening and the verbs that actually say what happened
const OPENER_SWAPS = [
  { test: /^worked on\b/i, verbs: ["Built", "Developed", "Delivered", "Implemented"] },
  { test: /^worked with\b/i, verbs: ["Partnered with", "Collaborated with", "Advised"] },
  { test: /^responsible for\b/i, verbs: ["Owned", "Led", "Ran", "Managed"] },
  { test: /^helped( with| to)?\b/i, verbs: ["Supported", "Contributed to", "Enabled"] },
  { test: /^assisted( with| in)?\b/i, verbs: ["Supported", "Coordinated", "Contributed to"] },
  { test: /^involved in\b/i, verbs: ["Contributed to", "Delivered", "Drove"] },
  { test: /^participated in\b/i, verbs: ["Contributed to", "Took part in", "Supported"] },
  { test: /^tasked with\b/i, verbs: ["Owned", "Led", "Delivered"] },
  { test: /^duties included\b/i, verbs: ["Ran", "Handled", "Delivered"] },
  { test: /^familiar with\b/i, verbs: ["Used", "Applied", "Worked in"] },
  { test: /^exposure to\b/i, verbs: ["Used", "Applied"] },
  { test: /^was in charge of\b/i, verbs: ["Led", "Owned", "Directed"] },
];

// units a resume actually counts in. time units matter as much as head counts: "cut the build
// from 40 minutes to 6" is a measured result and an earlier version of this pattern missed it
const UNITS = "users|customers|clients|people|students|staff|engineers|volunteers|attendees"
  + "|seconds|minutes|hours|days|weeks|months|years"
  + "|records|requests|transactions|tickets|incidents|defects|bugs|calls|emails"
  + "|lines|tests|queries|rows|models|projects|repositories|commits|releases|deploys|builds"
  + "|servers|nodes|endpoints|devices|sites|downloads|installs|papers|posters|courses";

const MEASURABLE = new RegExp(
  "(\\$\\s?[\\d,.]+"
  + "|\\b\\d+(?:\\.\\d+)?\\s?(?:%|percent|x\\b)"
  + `|\\b\\d[\\d,]*\\+?\\s*(?:${UNITS})\\b`
  // "from 40 minutes to 6" keeps its unit between the two numbers
  + `|\\bfrom\\s+\\$?\\d[\\d,.]*\\s*(?:${UNITS})?\\s+to\\s+\\$?\\d`
  + "|\\bby\\s+\\$?\\d)",
  "i",
);
const PASSIVE = /\b(?:was|were|been|being|is|are)\s+\w+(?:ed|en)\b/i;
const FIRST_PERSON = /\b(?:I|my|me|mine|we|our|us)\b/i;
const DECORATIVE = /[℀-➿\u{1F000}-\u{1FAFF}]/u;

const capitalise = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const tidy = (text) => String(text).replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();

// removing a word can strand the wrong article, turning "a very effective tool" into
// "a effective tool". this puts the article back in agreement with whatever now follows it
const fixArticles = (text) => String(text)
  .replace(/\ba\s+([aeiou])/gi, (match, letter) => `${match[0] === "A" ? "An" : "an"} ${letter}`)
  .replace(/\ban\s+([^aeiou\s])/gi, (match, letter) => `${match[0] === "A" ? "A" : "a"} ${letter}`);

// what is wrong with this line, most important first. each carries a fix when one exists
export function diagnose(text, context = {}) {
  const value = String(text || "").trim();
  const issues = [];
  if (!value) return issues;

  const words = countWords(value);
  const first = tokenize(value)[0] || "";

  const swap = OPENER_SWAPS.find((entry) => entry.test.test(value));
  if (swap) {
    issues.push({
      id: "weak-opener",
      severity: "high",
      label: "Passive opening",
      detail: "Lead with the thing you did, not with how you were assigned it.",
      fix: "strengthen",
    });
  } else if (!VERB_SET.has(first)) {
    issues.push({
      id: "no-verb",
      severity: "medium",
      label: "Does not open with an action verb",
      detail: "Recruiters skim the first word of every bullet.",
      fix: "strengthen",
    });
  }

  if (!MEASURABLE.test(value)) {
    issues.push({
      id: "no-metric",
      severity: "high",
      label: "No measurable result",
      detail: "Scale, time saved or a percentage change makes a bullet concrete.",
      fix: "quantify",
    });
  }

  if (words > 32) {
    issues.push({
      id: "long",
      severity: "medium",
      label: `${words} words runs past two lines`,
      detail: "Bullets under about 25 words stay scannable.",
      fix: "shorten",
    });
  }

  const filler = FILLER.filter((phrase) => new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(value));
  if (filler.length) {
    issues.push({
      id: "filler",
      severity: "medium",
      label: `Filler: ${filler.slice(0, 3).join(", ")}`,
      detail: "These words take space without adding meaning.",
      fix: "shorten",
    });
  }

  if (PASSIVE.test(value)) {
    issues.push({
      id: "passive",
      severity: "medium",
      label: "Passive voice",
      detail: "Say who did it. Passive constructions hide the actor.",
    });
  }

  if (FIRST_PERSON.test(value)) {
    issues.push({
      id: "first-person",
      severity: "low",
      label: "First person",
      detail: "Resume bullets conventionally drop I and we.",
      fix: "dropPronouns",
    });
  }

  if (DECORATIVE.test(value)) {
    issues.push({
      id: "glyph",
      severity: "medium",
      label: "Decorative character",
      detail: "Some applicant tracking systems drop these.",
      fix: "plainText",
    });
  }

  if (/[.!?]$/.test(value) && context.siblingsEndWithout) {
    issues.push({
      id: "punctuation",
      severity: "low",
      label: "Ends with a full stop",
      detail: "The other bullets in this entry do not.",
    });
  }

  return issues.sort((a, b) => rank(b.severity) - rank(a.severity));
}

const rank = (severity) => ({ high: 3, medium: 2, low: 1 }[severity] || 0);

// the transforms. each returns null when it would change nothing, so a tool that cannot help
// can be hidden rather than offered as a no-op
export const TRANSFORMS = {
  shorten: {
    label: "Shorten",
    hint: "Remove filler and tighten phrasing",
    run(text) {
      let out = String(text);
      for (const [pattern, replacement] of TIGHTEN) out = out.replace(pattern, replacement);
      // adverbs and empty adjectives that assert quality without evidence
      const strip = [
        "successfully", "effectively", "efficiently", "actively", "closely", "heavily",
        "basically", "really", "very", "quite", "extremely",
        "effective", "efficient", "various", "numerous", "several different",
      ];
      for (const word of strip) out = out.replace(new RegExp(`\\b${word}\\s+`, "gi"), "");
      out = fixArticles(capitalise(tidy(out)));
      return out !== String(text).trim() ? out : null;
    },
  },

  strengthen: {
    label: "Stronger opening",
    hint: "Lead with an action verb",
    run(text) {
      const value = String(text).trim();
      const swap = OPENER_SWAPS.find((entry) => entry.test.test(value));
      if (swap) {
        const rest = value.replace(swap.test, "").replace(/^\s*(the|a|an)\s+/i, "").trim();
        return `${swap.verbs[0]} ${rest}`.replace(/\s{2,}/g, " ").trim();
      }
      const first = tokenize(value)[0] || "";
      if (VERB_SET.has(first)) return null;
      // an -ing opening is a participle; the past tense of the same verb is the stronger form
      const gerund = value.match(/^(\w+)ing\b/i);
      if (gerund) {
        const stem = gerund[1];
        const candidate = ACTION_VERBS.find((verb) => verb.startsWith(stem.toLowerCase().slice(0, 4)));
        if (candidate) return capitalise(value.replace(/^\w+ing\b/i, capitalise(candidate)));
      }
      return null;
    },
  },

  dropPronouns: {
    label: "Remove I and we",
    hint: "Resume bullets drop the pronoun",
    run(text) {
      const out = tidy(String(text)
        .replace(/^\s*(?:I|We)\s+/i, "")
        .replace(/\b(?:my|our)\s+/gi, "")
        .replace(/\b(?:me|us)\b/gi, "")
        .replace(/\b(?:I|we)\s+/gi, ""));
      const capped = capitalise(out);
      return capped && capped !== String(text).trim() ? capped : null;
    },
  },

  plainText: {
    label: "Make ATS plain",
    hint: "Strip characters a parser may drop",
    run(text) {
      const out = tidy(String(text)
        .replace(DECORATIVE, "")
        .replace(/[‘’‛]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, "-"));
      return out !== String(text).trim() ? out : null;
    },
  },

  sentenceCase: {
    label: "Sentence case",
    hint: "Fix an all caps or lower case line",
    run(text) {
      const value = String(text).trim();
      if (!/^[^a-z]+$/.test(value) && !/^[a-z]/.test(value)) return null;
      const lower = /^[^a-z]+$/.test(value) ? value.toLowerCase() : value;
      return capitalise(lower);
    },
  },
};

// what a bullet is missing against Situation, Task, Action, Result. this is a prompt rather than
// a rewrite: the missing parts are facts only the author has
export function starCoverage(text) {
  const value = String(text || "");
  const first = tokenize(value)[0] || "";

  return [
    {
      part: "Action",
      present: VERB_SET.has(first),
      prompt: "Open with what you did: built, cut, led, shipped.",
    },
    {
      part: "Context",
      present: /\b(?:for|across|within|during|while|on the|at the|as part of)\b/i.test(value),
      prompt: "Say where it happened: which team, system or programme.",
    },
    {
      part: "Method",
      present: /\b(?:using|with|via|through|by)\b/i.test(value),
      prompt: "Name the tool or approach you used.",
    },
    {
      part: "Result",
      present: MEASURABLE.test(value) || /\b(?:resulting in|which|so that|enabling|reducing|increasing|improving|saving)\b/i.test(value),
      prompt: "Finish with what changed, ideally a number.",
    },
  ];
}

// prompts for the kind of number that would fit this particular sentence
export function quantifyPrompts(text) {
  const value = String(text || "").toLowerCase();
  const prompts = [];
  const add = (prompt) => { if (!prompts.includes(prompt)) prompts.push(prompt); };

  if (/\b(?:built|developed|created|designed|implemented|shipped|launched)\b/.test(value)) {
    add("How many people use it, or how often does it run?");
  }
  if (/\b(?:improved|optimi[sz]ed|reduced|cut|increased|accelerated|streamlined)\b/.test(value)) {
    add("By how much, and from what to what?");
  }
  if (/\b(?:led|managed|supervised|mentored|coordinated|trained)\b/.test(value)) {
    add("How many people, and over what period?");
  }
  if (/\b(?:tested|audited|reviewed|analy[sz]ed|processed|migrated)\b/.test(value)) {
    add("How many items, records or cases?");
  }
  if (/\b(?:presented|published|spoke|taught|demonstrated)\b/.test(value)) {
    add("To how large an audience?");
  }
  if (!prompts.length) add("What changed because of this, and can it be counted?");
  return prompts;
}

// verbs already used elsewhere, so a suggested replacement does not repeat the resume
export function unusedVerbs(usedVerbs, limit = 8) {
  const used = new Set(usedVerbs.map((verb) => verb.toLowerCase()));
  return ACTION_VERBS.filter((verb) => !used.has(verb)).slice(0, limit).map(capitalise);
}

export { MEASURABLE, FILLER };
