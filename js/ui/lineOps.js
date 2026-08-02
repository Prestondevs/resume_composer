import { store } from "../store.js";
import { createItem } from "../schema.js";

// structural edits made from the page itself: splitting a line in two, joining it back onto the
// one above, adding and removing lines and entries
// each operation returns where the caret should end up, because every one of these changes the
// shape of the document and so forces a repaint that throws away the node being edited. the
// caller hands that intent to pageEdit, which finds the new node once the page has been rebuilt

const bulletsOf = (section, itemId) =>
  (itemId ? section.items?.find((i) => i.id === itemId)?.bullets : section.bullets) || null;

function locate(doc, descriptor) {
  const section = doc.sections.find((s) => s.id === descriptor.sectionId);
  if (!section) return null;
  const item = descriptor.itemId ? section.items?.find((i) => i.id === descriptor.itemId) : null;
  if (descriptor.itemId && !item) return null;
  return { section, item };
}

const kindFor = (itemId) => (itemId ? "bullet" : "sectionBullet");

// a bullet may carry a right hand column stored after a tab. the split only ever touches the
// left half, so the tail travels with whichever piece keeps the text it was set against
const halves = (line) => {
  const at = String(line ?? "").indexOf("\t");
  return at === -1 ? [String(line ?? ""), ""] : [line.slice(0, at), line.slice(at + 1)];
};
const join = (text, tail) => (tail.trim() ? `${text.trim()}\t${tail.trim()}` : text.trim());

// splits the line at the caret, leaving the text before it in place and starting a new line with
// the rest. this is what Enter does in the middle of a sentence in any editor
export function splitLine(descriptor, offset) {
  const { sectionId, itemId, index } = descriptor;
  let caret = null;

  const ok = store.commit("Split line", (doc) => {
    const found = locate(doc, descriptor);
    if (!found) return false;
    const bullets = bulletsOf(found.section, itemId);
    if (!bullets || bullets[index] == null) return false;

    const [text, tail] = halves(bullets[index]);
    const cut = Math.max(0, Math.min(offset, text.length));

    // the tail was set against the end of the line, so it stays with the half that keeps the end
    bullets[index] = text.slice(0, cut).trim();
    bullets.splice(index + 1, 0, join(text.slice(cut), tail));

    caret = { sectionId, itemId, kind: kindFor(itemId), field: null, index: index + 1, offset: 0 };
  });

  return ok ? caret : null;
}

// joins this line onto the end of the one above and puts the caret at the seam, so a person
// holding Backspace walks back through the list the way they expect
export function mergeBack(descriptor) {
  const { sectionId, itemId, index } = descriptor;
  let caret = null;

  const ok = store.commit("Join lines", (doc) => {
    const found = locate(doc, descriptor);
    if (!found) return false;
    const bullets = bulletsOf(found.section, itemId);
    if (!bullets || index <= 0 || bullets[index] == null) return false;

    const [prevText, prevTail] = halves(bullets[index - 1]);
    const [text, tail] = halves(bullets[index]);
    const seam = prevText.trim();
    const merged = [seam, text.trim()].filter(Boolean).join(" ");

    bullets[index - 1] = join(merged, prevTail || tail);
    bullets.splice(index, 1);

    // land where the two lines meet, not at the end of the merged result
    caret = {
      sectionId,
      itemId,
      kind: kindFor(itemId),
      field: null,
      index: index - 1,
      offset: seam.length ? seam.length + (text.trim() ? 1 : 0) : 0,
    };
  });

  return ok ? caret : null;
}

// pulls the following line up onto this one, which is what Delete at the end of a line means
export function mergeForward(descriptor) {
  const { index } = descriptor;
  const next = { ...descriptor, index: index + 1 };
  const doc = store.doc;
  const found = locate(doc, descriptor);
  if (!found) return null;
  const bullets = bulletsOf(found.section, descriptor.itemId);
  if (!bullets || bullets[index + 1] == null) return null;
  return mergeBack(next);
}

// removes the line outright and puts the caret at the end of the previous one
export function removeLine(descriptor) {
  const { sectionId, itemId, index } = descriptor;
  let caret = null;

  const ok = store.commit("Delete line", (doc) => {
    const found = locate(doc, descriptor);
    if (!found) return false;
    const bullets = bulletsOf(found.section, itemId);
    if (!bullets || bullets.length <= 1 || bullets[index] == null) return false;
    bullets.splice(index, 1);
    const target = Math.max(0, index - 1);
    caret = { sectionId, itemId, kind: kindFor(itemId), field: null, index: target, offset: "end" };
  });

  return ok ? caret : null;
}

// starts a new line at the end of a list, used by the add control under an entry
export function appendLine(sectionId, itemId) {
  let caret = null;

  const ok = store.commit("Add line", (doc) => {
    const section = doc.sections.find((s) => s.id === sectionId);
    if (!section) return false;
    const item = itemId ? section.items?.find((i) => i.id === itemId) : null;
    if (itemId && !item) return false;
    const target = item || section;
    target.bullets ||= [];
    // an empty line already waiting at the end is the one to go to
    const last = target.bullets[target.bullets.length - 1];
    if (last != null && !String(last).trim()) {
      caret = { sectionId, itemId, kind: kindFor(itemId), field: null, index: target.bullets.length - 1, offset: 0 };
      return false;
    }
    target.bullets.push("");
    caret = { sectionId, itemId, kind: kindFor(itemId), field: null, index: target.bullets.length - 1, offset: 0 };
  });

  // a caret with no commit still points somewhere real when the empty line already existed
  return ok || caret ? caret : null;
}

// adds an entry directly below the one being edited and puts the caret in its first field
export function addEntryAfter(sectionId, itemId) {
  let caret = null;

  const ok = store.commit("Add entry", (doc) => {
    const section = doc.sections.find((s) => s.id === sectionId);
    if (!section || section.layout !== "entries") return false;
    section.items ||= [];
    const at = itemId ? section.items.findIndex((i) => i.id === itemId) : section.items.length - 1;
    const item = createItem({ bullets: [""] });
    section.items.splice(at === -1 ? section.items.length : at + 1, 0, item);
    caret = { sectionId, itemId: item.id, kind: "item", field: "org", index: null, offset: 0 };
  });

  return ok ? caret : null;
}

export function removeEntry(sectionId, itemId) {
  let caret = null;

  const ok = store.commit("Delete entry", (doc) => {
    const section = doc.sections.find((s) => s.id === sectionId);
    const at = section?.items?.findIndex((i) => i.id === itemId) ?? -1;
    if (at === -1) return false;
    section.items.splice(at, 1);
    const previous = section.items[at - 1];
    caret = previous
      ? { sectionId, itemId: previous.id, kind: "item", field: "org", index: null, offset: "end" }
      : { sectionId, itemId: null, kind: "sectionTitle", field: null, index: null, offset: "end" };
  });

  return ok ? caret : null;
}

// adds a paragraph to a prose section, splitting the current one at the caret
export function splitProse(descriptor, offset) {
  const { sectionId, index } = descriptor;
  let caret = null;

  const ok = store.commit("Split paragraph", (doc) => {
    const section = doc.sections.find((s) => s.id === sectionId);
    if (!section) return false;
    const parts = String(section.body || "").split(/\n{2,}/);
    const current = parts[index];
    if (current == null) return false;
    const cut = Math.max(0, Math.min(offset, current.length));
    parts.splice(index, 1, current.slice(0, cut).trim(), current.slice(cut).trim());
    section.body = parts.join("\n\n");
    caret = { sectionId, itemId: null, kind: "prose", field: null, index: index + 1, offset: 0 };
  });

  return ok ? caret : null;
}

// turns the line under one heading on or off. the first click commits to the opposite of what is
// currently drawn, so the section stops following the document-wide setting from then on
export function toggleRule(sectionId, drawnNow) {
  return store.commit("Section line", (doc) => {
    const section = doc.sections.find((s) => s.id === sectionId);
    if (!section) return false;
    section.rule = section.rule === null ? !drawnNow : !section.rule;
  });
}

// adds a skills row, or moves to the empty one already waiting
export function appendGroup(sectionId) {
  let caret = null;

  const ok = store.commit("Add row", (doc) => {
    const section = doc.sections.find((s) => s.id === sectionId);
    if (!section || section.layout !== "inline") return false;
    section.groups ||= [];
    const last = section.groups[section.groups.length - 1];
    if (last && !last.label?.trim() && !last.items?.trim()) return false;
    section.groups.push({ label: "", items: "" });
    caret = { sectionId, itemId: null, kind: "group", field: "label", index: section.groups.length - 1, offset: 0 };
  });

  return ok ? caret : null;
}
