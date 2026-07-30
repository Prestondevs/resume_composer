import { sectionText, documentText, isSectionEmpty, sectionCount } from "../schema.js";
import { analyzeJobDescription, countTerm, canonical, WEAK_OPENERS, VERB_SET, tokenize } from "./keywords.js";
import { countWords } from "../lib/util.js";

// scoring and suggestions
// two rules shape everything here. Scores must come with a reason a person can act on, and no
// suggestion may ever invent experience. Every action either reorders, reveals or focuses
// content the user already wrote. Adding a skill is only ever proposed as a prompt to the user,
// never applied automatically

const MEASURABLE = /(\$\s?[\d,.]+|\b\d+(?:\.\d+)?\s?(?:%|percent|x\b)|\b\d[\d,]*\+?\s*(?:users|customers|clients|people|students|hours|days|weeks|months|records|requests|transactions|tickets|lines|tests|queries|rows|models|projects|members|attendees|downloads|installs)\b|\bby\s+\d|\bfrom\s+\d[\d,.]*\s+to\s+\d)/i;

export function reviewDocument(doc) {
  const sections = doc.sections.filter((s) => s.visible);
  const bullets = collectBullets(doc);
  const text = documentText(doc);
  const words = countWords(text);
  const job = analyzeJobDescription(doc.job?.description || "");
  const match = job.terms.length ? matchKeywords(doc, job) : null;

  const categories = [
    scoreCompleteness(doc, sections),
    scoreFormatting(doc, sections, bullets),
    scoreReadability(doc, bullets, words),
    scoreAts(doc, sections),
    scoreKeywords(match, job),
    scoreRelevance(doc, "experience", "Experience relevance", match, job),
    scoreRelevance(doc, "projects", "Project relevance", match, job),
    scoreRelevance(doc, "education", "Education relevance", match, job),
  ].filter(Boolean);

  const weighted = categories.reduce((sum, c) => sum + c.score * c.weight, 0);
  const totalWeight = categories.reduce((sum, c) => sum + c.weight, 0) || 1;
  const overall = Math.round(weighted / totalWeight);

  return {
    overall,
    categories,
    job,
    match,
    stats: { words, bullets: bullets.length, sections: sections.length },
    suggestions: buildSuggestions(doc, { sections, bullets, match, job, words }),
  };
}

function collectBullets(doc) {
  const out = [];
  for (const section of doc.sections) {
    if (!section.visible) continue;
    if (section.layout === "entries") {
      for (const item of section.items || []) {
        for (const line of item.bullets || []) out.push({ text: line, section, item });
      }
    } else if (section.layout === "bullets") {
      for (const line of section.bullets || []) out.push({ text: line, section, item: null });
    }
  }
  return out;
}

const tone = (score) => (score >= 78 ? "good" : score >= 55 ? "warn" : "bad");

// categories

function scoreCompleteness(doc, sections) {
  const present = new Set(sections.filter((s) => !isSectionEmpty(s)).map((s) => s.type));
  const contact = doc.sections.find((s) => s.type === "contact")?.contact || {};

  const checks = [
    { ok: Boolean(contact.name), label: "your name" },
    { ok: Boolean(contact.email || contact.phone), label: "an email or phone number" },
    { ok: present.has("experience") || present.has("projects") || present.has("research"), label: "experience or projects" },
    { ok: present.has("education"), label: "education" },
    { ok: present.has("skills"), label: "a skills section" },
  ];
  const missing = checks.filter((check) => !check.ok);
  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);

  return {
    id: "completeness",
    label: "Completeness",
    score,
    weight: 1.2,
    tone: tone(score),
    note: missing.length
      ? `Still missing ${listPhrase(missing.map((m) => m.label))}.`
      : "Every section a recruiter looks for first is present.",
  };
}

function scoreFormatting(doc, sections, bullets) {
  const issues = [];
  let score = 100;

  const entrySections = sections.filter((s) => s.layout === "entries");
  const undatedItems = entrySections.flatMap((s) => (s.items || []).filter((item) => !item.start && !item.end));
  const totalItems = entrySections.reduce((sum, s) => sum + (s.items?.length || 0), 0);
  if (totalItems && undatedItems.length) {
    const share = undatedItems.length / totalItems;
    score -= Math.round(share * 30);
    issues.push(`${undatedItems.length} of ${totalItems} entries have no dates`);
  }

  const empties = sections.filter(isSectionEmpty);
  if (empties.length) {
    score -= Math.min(20, empties.length * 7);
    issues.push(`${empties.length} visible section${empties.length > 1 ? "s are" : " is"} empty`);
  }

  const longBullets = bullets.filter((b) => countWords(b.text) > 34);
  if (longBullets.length) {
    score -= Math.min(18, longBullets.length * 4);
    issues.push(`${longBullets.length} bullet${longBullets.length > 1 ? "s run" : " runs"} past two lines`);
  }

  const inconsistent = hasInconsistentDates(entrySections);
  if (inconsistent) {
    score -= 8;
    issues.push("date formats are mixed");
  }

  score = clampScore(score);
  return {
    id: "formatting",
    label: "Formatting",
    score,
    weight: 1,
    tone: tone(score),
    note: issues.length ? `${capitalize(listPhrase(issues))}.` : "Dates, section lengths and bullet lengths are consistent.",
  };
}

function scoreReadability(doc, bullets, words) {
  let score = 100;
  const issues = [];

  if (!bullets.length) {
    return { id: "readability", label: "Readability", score: 40, weight: 1, tone: "bad", note: "There are no bullet points yet. Recruiters skim these first." };
  }

  const weak = bullets.filter((b) => WEAK_OPENERS.some((opener) => b.text.toLowerCase().startsWith(opener)));
  if (weak.length) {
    score -= Math.min(28, weak.length * 8);
    issues.push(`${weak.length} bullet${weak.length > 1 ? "s start" : " starts"} with a passive phrase`);
  }

  const withNumbers = bullets.filter((b) => MEASURABLE.test(b.text));
  const numberShare = withNumbers.length / bullets.length;
  if (numberShare < 0.3) {
    score -= Math.round((0.3 - numberShare) * 70);
    issues.push(`only ${Math.round(numberShare * 100)}% of bullets carry a measurable result`);
  }

  const openers = new Map();
  for (const bullet of bullets) {
    const first = tokenize(bullet.text)[0];
    if (!first) continue;
    openers.set(first, (openers.get(first) || 0) + 1);
  }
  const repeated = Array.from(openers.entries()).filter(([, count]) => count >= 3);
  if (repeated.length) {
    score -= Math.min(14, repeated.length * 5);
    issues.push(`"${repeated[0][0]}" opens ${repeated[0][1]} bullets`);
  }

  if (words > 900) { score -= 10; issues.push(`${words} words is long for a resume`); }
  if (words < 180) { score -= 20; issues.push("there is very little content to read"); }

  score = clampScore(score);
  return {
    id: "readability",
    label: "Readability",
    score,
    weight: 1.1,
    tone: tone(score),
    note: issues.length ? `${capitalize(listPhrase(issues))}.` : "Bullets are varied, concise and results-led.",
  };
}

function scoreAts(doc, sections) {
  const report = atsReport(doc, sections);
  const penalty = report.reduce((sum, item) => sum + (item.tone === "bad" ? 22 : item.tone === "warn" ? 9 : 0), 0);
  const score = clampScore(100 - penalty);
  const problems = report.filter((item) => item.tone !== "good");

  return {
    id: "ats",
    label: "ATS compatibility",
    score,
    weight: 1.3,
    tone: tone(score),
    note: problems.length ? problems[0].text : "Headings, dates and layout should parse cleanly.",
    report,
  };
}

// shared by the score panel and the ATS preview so they never disagree
export function atsReport(doc, sections = doc.sections.filter((s) => s.visible)) {
  const items = [];
  const contact = doc.sections.find((s) => s.type === "contact")?.contact || {};
  const twoColumn = doc.template === "sidebar" || doc.template === "creative";

  items.push(contact.email
    ? { tone: "good", text: "An email address was found in the header." }
    : { tone: "bad", text: "No email address. Many parsers reject a resume without one." });

  items.push(contact.phone
    ? { tone: "good", text: "A phone number was found." }
    : { tone: "warn", text: "No phone number in the contact block." });

  items.push(twoColumn
    ? { tone: "warn", text: `The ${doc.template === "sidebar" ? "Sidebar" : "Creative"} template uses two columns. Older parsers read across columns and scramble the order. Switch to ATS Friendly when applying through a portal.` }
    : { tone: "good", text: "Single-column layout reads top to bottom." });

  const unknownHeadings = sections.filter((s) => s.type === "custom" && s.title);
  items.push(unknownHeadings.length
    ? { tone: "warn", text: `Non-standard heading${unknownHeadings.length > 1 ? "s" : ""}: ${unknownHeadings.map((s) => `"${s.title}"`).join(", ")}. Parsers key off familiar names like Experience, Education and Skills.` }
    : { tone: "good", text: "All section headings use recognised names." });

  const entrySections = sections.filter((s) => s.layout === "entries");
  const undated = entrySections.flatMap((s) => (s.items || []).filter((item) => !item.start && !item.end));
  items.push(undated.length
    ? { tone: "warn", text: `${undated.length} entr${undated.length > 1 ? "ies have" : "y has"} no dates. Parsers use dates to build your work history.` }
    : { tone: "good", text: "Every entry has a date range." });

  const glyphs = findUnparseableGlyphs(documentText(doc));
  items.push(glyphs.length
    ? { tone: "warn", text: `Symbols that some parsers drop: ${glyphs.join(" ")}. Replace them with plain text where they carry meaning.` }
    : { tone: "good", text: "No decorative glyphs or icons in the text." });

  const contactInHeader = false; // The renderer always writes contact into the body flow.
  if (!contactInHeader) items.push({ tone: "good", text: "Contact details sit in the document body, not a header or footer." });

  return items;
}

function findUnparseableGlyphs(text) {
  const found = new Set();
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 0x2019) continue;
    if (/[\p{L}\p{N}\p{P}\s]/u.test(char) && code < 0x2100) continue;
    if (/[℀-➿-\u{1F000}-\u{1FAFF}]/u.test(char)) found.add(char);
  }
  return Array.from(found).slice(0, 8);
}

function scoreKeywords(match, job) {
  if (!match) {
    return {
      id: "keywords",
      label: "Keyword match",
      score: 0,
      weight: 0,
      tone: "warn",
      inactive: true,
      note: "Paste a job description in Optimize to score keyword coverage.",
    };
  }
  const score = Math.round(match.coverage * 100);
  return {
    id: "keywords",
    label: "Keyword match",
    score,
    weight: 1.6,
    tone: tone(score),
    note: `${match.hits.length} of ${job.terms.length} important terms appear in your resume.`,
  };
}

function scoreRelevance(doc, type, label, match, job) {
  const sections = doc.sections.filter((s) => s.visible && s.type === type);
  if (!sections.length) return null;
  if (!match) {
    return {
      id: `relevance-${type}`,
      label,
      score: 0,
      weight: 0,
      tone: "warn",
      inactive: true,
      note: "Needs a job description to compare against.",
    };
  }

  const text = sections.map(sectionText).join("\n").toLowerCase();
  let earned = 0;
  let possible = 0;
  const found = [];
  for (const term of job.terms.slice(0, 30)) {
    possible += term.weight;
    if (countTerm(text, term.term) > 0) {
      earned += term.weight;
      found.push(term.term);
    }
  }

  const score = possible ? Math.round(Math.min(1, earned / (possible * 0.55)) * 100) : 0;
  return {
    id: `relevance-${type}`,
    label,
    score,
    weight: type === "experience" ? 1.3 : 0.8,
    tone: tone(score),
    note: found.length
      ? `Picks up ${found.slice(0, 4).join(", ")}${found.length > 4 ? ` and ${found.length - 4} more` : ""}.`
      : "None of the posting's key terms appear here yet.",
  };
}

// keyword matching

export function matchKeywords(doc, job) {
  const perSection = doc.sections
    .filter((s) => s.visible)
    .map((section) => ({ section, text: sectionText(section).toLowerCase() }));
  const full = perSection.map((entry) => entry.text).join("\n");

  const hits = [];
  const misses = [];

  for (const term of job.terms) {
    const count = countTerm(full, term.term);
    const where = count
      ? perSection.filter((entry) => countTerm(entry.text, term.term) > 0).map((entry) => entry.section)
      : [];
    const record = { ...term, resumeCount: count, sections: where };
    if (count > 0) hits.push(record);
    else misses.push(record);
  }

  const earned = hits.reduce((sum, term) => sum + term.weight, 0);
  const possible = job.terms.reduce((sum, term) => sum + term.weight, 0) || 1;

  return {
    hits: hits.sort((a, b) => b.weight - a.weight),
    misses: misses.sort((a, b) => b.weight - a.weight),
    coverage: Math.min(1, earned / (possible * 0.7)),
    buried: hits.filter((term) => term.count >= 3 && term.resumeCount === 1 && term.sections.length === 1),
  };
}

// suggestions

function buildSuggestions(doc, { sections, bullets, match, job }) {
  const out = [];
  const order = doc.sections.map((s) => s.id);
  const add = (suggestion) => out.push({ id: suggestion.id, tone: "warn", ...suggestion });

  // ordering: put whichever of experience / projects / education carries more of
  // the posting's language nearer the top
  if (match) {
    const ranked = ["experience", "projects", "education", "leadership", "research"]
      .map((type) => {
        const section = doc.sections.find((s) => s.type === type && s.visible);
        if (!section) return null;
        const text = sectionText(section).toLowerCase();
        const relevance = job.terms.slice(0, 25).reduce((sum, term) => sum + (countTerm(text, term.term) ? term.weight : 0), 0);
        return { section, relevance, index: order.indexOf(section.id) };
      })
      .filter(Boolean);

    for (const candidate of ranked) {
      const above = ranked.filter((other) => other.index < candidate.index && other.relevance < candidate.relevance * 0.6);
      if (!above.length) continue;
      const target = above[0];
      add({
        id: `move-${candidate.section.id}`,
        kind: "Ordering",
        tone: "warn",
        text: `<b>${candidate.section.title}</b> matches this posting more closely than <b>${target.section.title}</b>. Move it above.`,
        action: { type: "move", sectionId: candidate.section.id, beforeId: target.section.id, label: `Move ${candidate.section.title} up` },
      });
      break;
    }

    for (const term of match.misses.slice(0, 4)) {
      if (term.count < 2) continue;
      add({
        id: `missing-${term.term}`,
        kind: "Keyword",
        tone: "bad",
        text: `<b>${term.term}</b> appears ${term.count} time${term.count > 1 ? "s" : ""} in the posting but not in your resume. Add it only if you have actually used it.`,
        action: { type: "focus-skills", label: "Open Skills" },
      });
    }

    for (const term of match.buried.slice(0, 3)) {
      add({
        id: `buried-${term.term}`,
        kind: "Emphasis",
        tone: "warn",
        text: `<b>${term.term}</b> is repeated ${term.count} times in the posting but appears once in your resume, inside <b>${term.sections[0].title}</b>. Consider pulling it into a bullet a recruiter reads first.`,
        action: { type: "focus", sectionId: term.sections[0].id, label: `Open ${term.sections[0].title}` },
      });
    }

    const strongest = match.hits.find((term) => term.resumeCount >= 2 && term.sections.some((s) => s.type === "experience" || s.type === "projects"));
    if (strongest) {
      const host = strongest.sections.find((s) => s.type === "experience" || s.type === "projects");
      add({
        id: `strength-${strongest.term}`,
        kind: "Strength",
        tone: "good",
        text: `<b>${host.title}</b> already speaks to <b>${strongest.term}</b>, one of the posting's most repeated terms. Keep it prominent.`,
        action: { type: "focus", sectionId: host.id, label: `Open ${host.title}` },
      });
    }
  }

  const weak = bullets.filter((b) => WEAK_OPENERS.some((opener) => b.text.toLowerCase().startsWith(opener)));
  if (weak.length >= 2) {
    const opener = WEAK_OPENERS.find((o) => weak[0].text.toLowerCase().startsWith(o));
    add({
      id: "weak-openers",
      kind: "Wording",
      tone: "warn",
      text: `${weak.length} bullet points begin with a passive phrase like <b>"${opener}"</b>. Lead with what you did: built, shipped, cut, led.`,
      action: { type: "focus", sectionId: weak[0].section.id, label: `Open ${weak[0].section.title}` },
    });
  }

  const noNumbers = bullets.filter((b) => !MEASURABLE.test(b.text));
  if (bullets.length >= 4 && noNumbers.length / bullets.length > 0.7) {
    add({
      id: "measurable",
      kind: "Impact",
      tone: "warn",
      text: `${noNumbers.length} of ${bullets.length} bullets have no measurable result. Add scale, time saved or percentage change where you know it.`,
      action: { type: "focus", sectionId: noNumbers[0].section.id, label: `Open ${noNumbers[0].section.title}` },
    });
  }

  const skills = doc.sections.find((s) => s.type === "skills" && s.visible);
  if (skills) {
    const total = (skills.groups || []).reduce((sum, group) => sum + group.items.split(",").filter((x) => x.trim()).length, 0);
    if (total > 28 && (skills.groups || []).filter((g) => g.label).length < 3) {
      add({
        id: "skills-long",
        kind: "Structure",
        tone: "warn",
        text: `Your skills section lists ${total} items with little grouping. Group them into three or four labelled rows so a scanner finds the relevant ones.`,
        action: { type: "focus", sectionId: skills.id, label: "Open Skills" },
      });
    }
  }

  const overused = new Map();
  for (const bullet of bullets) {
    for (const token of new Set(tokenize(bullet.text))) {
      if (!VERB_SET.has(token) && token.length < 4) continue;
      overused.set(token, (overused.get(token) || 0) + 1);
    }
  }
  const topRepeat = Array.from(overused.entries())
    .filter(([token, count]) => count >= 5 && !VERB_SET.has(token))
    .sort((a, b) => b[1] - a[1])[0];
  if (topRepeat) {
    add({
      id: `repeat-${topRepeat[0]}`,
      kind: "Wording",
      tone: "warn",
      text: `<b>${topRepeat[0]}</b> appears in ${topRepeat[1]} separate bullets. Vary the language so each line adds something new.`,
    });
  }

  const hidden = doc.sections.filter((s) => !s.visible && !isSectionEmpty(s));
  if (hidden.length && match) {
    for (const section of hidden) {
      const text = sectionText(section).toLowerCase();
      const relevant = job.terms.slice(0, 20).filter((term) => countTerm(text, term.term) > 0);
      if (relevant.length >= 3) {
        add({
          id: `unhide-${section.id}`,
          kind: "Hidden",
          tone: "warn",
          text: `<b>${section.title}</b> is hidden but mentions ${relevant.slice(0, 3).map((t) => t.term).join(", ")}. Turn it back on for this application.`,
          action: { type: "show", sectionId: section.id, label: `Show ${section.title}` },
        });
        break;
      }
    }
  }

  const empties = sections.filter(isSectionEmpty);
  if (empties.length) {
    add({
      id: "empty-sections",
      kind: "Cleanup",
      tone: "warn",
      text: `${empties.map((s) => `<b>${s.title}</b>`).join(", ")} ${empties.length > 1 ? "are" : "is"} visible but empty. Fill ${empties.length > 1 ? "them" : "it"} in or hide ${empties.length > 1 ? "them" : "it"}.`,
      action: { type: "hide-empty", label: `Hide empty section${empties.length > 1 ? "s" : ""}` },
    });
  }

  if (!out.length) {
    out.push({
      id: "all-clear",
      kind: "Looks good",
      tone: "good",
      text: "Nothing stands out as a problem. Paste a job description in Optimize for targeted feedback.",
    });
  }

  return out;
}

// helpers

function hasInconsistentDates(entrySections) {
  const shapes = new Set();
  for (const section of entrySections) {
    for (const item of section.items || []) {
      for (const value of [item.start, item.end]) {
        if (!value || /^present$/i.test(value)) continue;
        if (/^\d{4}$/.test(value)) shapes.add("year");
        else if (/^\d{1,2}\/\d{4}$/.test(value)) shapes.add("numeric");
        else if (/[a-z]{3}/i.test(value)) shapes.add("month");
      }
    }
  }
  return shapes.size > 1;
}

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));
const capitalize = (value) => (value ? value[0].toUpperCase() + value.slice(1) : value);

function listPhrase(items) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export { collectBullets, MEASURABLE };
