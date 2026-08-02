import { store } from "../store.js";
import { cleanLine } from "../lib/util.js";
import {
  splitLine, splitProse, mergeBack, mergeForward, removeLine,
  appendLine, appendGroup, addEntryAfter, removeEntry, toggleRule,
} from "./lineOps.js";

// direct editing on the rendered page
// the renderer marks each piece of text with where its value lives, and this reads those markers
// back. plain typing commits without repainting the page, because rebuilding the node under the
// caret would drop it. anything that changes the shape of the document does force a repaint, so
// those operations return an address for the caret and it is placed again once the page is back

// every dash variant is folded to a hyphen on the way in, so one is all this has to match
const SEPARATOR = /\s*-\s*|\s+to\s+/i;

export function describeField(field) {
  if (!field) return null;
  const { edit: kind, section, item, field: name } = field.dataset;
  return {
    kind,
    sectionId: section || null,
    itemId: item || null,
    field: name || null,
    index: field.dataset.index == null ? null : Number(field.dataset.index),
    text: field.textContent.trim(),
  };
}

// how far into the field the caret sits, counted in characters rather than DOM offsets so it
// survives the browser splitting a text node mid-edit
function caretOffset(field) {
  const selection = getSelection();
  if (!selection?.rangeCount) return 0;
  const range = selection.getRangeAt(0);
  if (!field.contains(range.endContainer)) return 0;
  const measure = range.cloneRange();
  measure.selectNodeContents(field);
  measure.setEnd(range.endContainer, range.endOffset);
  return measure.toString().length;
}

function collapsedAt(field, where) {
  const selection = getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return false;
  const at = caretOffset(field);
  return where === "start" ? at === 0 : at === field.textContent.length;
}

export function placeCaret(field, offset = 0) {
  if (!field) return false;
  field.focus({ preventScroll: true });
  const range = document.createRange();
  const node = field.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    range.selectNodeContents(field);
    range.collapse(true);
  } else {
    const length = node.textContent.length;
    const at = offset === "end" ? length : Math.max(0, Math.min(Number(offset) || 0, length));
    range.setStart(node, at);
    range.collapse(true);
  }
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

// an address is the same data a descriptor carries, so a field can be found again after the page
// has been rebuilt from scratch
function selectorFor(address) {
  let selector = `[data-edit="${address.kind}"]`;
  if (address.sectionId) selector += `[data-section="${address.sectionId}"]`;
  if (address.itemId) selector += `[data-item="${address.itemId}"]`;
  if (address.field) selector += `[data-field="${address.field}"]`;
  if (address.index != null) selector += `[data-index="${address.index}"]`;
  return selector;
}

export function findField(root, address) {
  if (!root || !address?.kind) return null;
  return root.querySelector(selectorFor(address))
    // a bullet with a right hand column is two fields; the left half is the one to type in
    || (address.field ? null : root.querySelector(selectorFor({ ...address, field: "text" })));
}

let pendingCaret = null;

export function requestCaret(address) {
  if (address) pendingCaret = address;
}

// where the caret is right now, in the same terms as an address, so a repaint that was forced
// for some other reason can still put it back
export function captureCaret(root) {
  const active = document.activeElement;
  if (!active || !root?.contains(active)) return null;
  const field = active.closest("[data-edit]");
  if (!field) return null;
  return { ...describeField(field), offset: caretOffset(field) };
}

// called by the preview once the page has been repainted
export function restoreCaret(root) {
  if (!pendingCaret) return false;
  const address = pendingCaret;
  pendingCaret = null;
  const field = findField(root, address);
  if (!field) return false;
  placeCaret(field, address.offset ?? 0);
  return true;
}

export function attachPageEditing(root, { onEdit, onFocusChange, onSelect, onStructure } = {}) {
  let active = null;

  const fieldOf = (node) => node?.closest?.("[data-edit]");

  // a structural change rebuilds the page, so the caret is booked in advance and the preview is
  // asked to repaint now rather than waiting for focus to leave
  const restructure = (address) => {
    if (!address) return false;
    requestCaret(address);
    active = null;
    onStructure?.(address);
    return true;
  };

  root.addEventListener("focusin", (event) => {
    const field = fieldOf(event.target);
    if (!field) return;
    active = field;
    onFocusChange?.(true);
    onSelect?.(describeField(field));
  });

  root.addEventListener("focusout", (event) => {
    const field = fieldOf(event.target);
    if (!field) return;
    commit(field, { final: true });
    if (active === field) active = null;
    // the blur may be a click into another field, so settle before repainting
    setTimeout(() => { if (!active) onFocusChange?.(false); }, 0);
  });

  root.addEventListener("input", (event) => {
    const field = fieldOf(event.target);
    if (!field) return;
    commit(field, { final: false });
    onEdit?.();
    onSelect?.(describeField(field));
  });

  root.addEventListener("keydown", (event) => {
    const field = fieldOf(event.target);
    if (!field) return;
    const descriptor = describeField(field);

    if (event.key === "Escape") {
      event.preventDefault();
      field.blur();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      step(root, field, event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      // whatever is in the node has to reach the document before the shape around it changes
      flush(field);
      handleEnter(root, field, descriptor, event, restructure);
      return;
    }

    if (event.key === "Backspace" && collapsedAt(field, "start")) {
      if (handleBackspace(field, descriptor, event, restructure)) event.preventDefault();
      return;
    }

    if (event.key === "Delete" && collapsedAt(field, "end")) {
      if (isLine(descriptor.kind)) {
        flush(field);
        if (restructure(mergeForward(descriptor))) event.preventDefault();
      }
    }
  });

  // clicking a link on the page should place the caret, not navigate away from the editor
  root.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[data-edit]");
    if (anchor) event.preventDefault();
  });

  // the controls the renderer puts beside each block. pressing one must not blur the field the
  // caret is in first, or the page would commit and repaint out from under the click
  root.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-line-action], [data-rule-toggle]")) event.preventDefault();
  });

  root.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-rule-toggle]");
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      toggleRule(toggle.dataset.ruleToggle, toggle.getAttribute("aria-pressed") === "true");
      onStructure?.(null);
      return;
    }

    const control = event.target.closest("[data-line-action]");
    if (!control) return;
    event.preventDefault();
    event.stopPropagation();
    const { lineAction: action, section, item } = control.dataset;
    if (action === "add-bullet") restructure(appendLine(section, item || null));
    else if (action === "add-entry") restructure(addEntryAfter(section, item || null));
    else if (action === "remove-entry") restructure(removeEntry(section, item));
    else if (action === "add-group") restructure(appendGroup(section));
  });

  return () => { active = null; };
}

const isLine = (kind) => kind === "bullet" || kind === "sectionBullet";

function handleEnter(root, field, descriptor, event, restructure) {
  const { kind } = descriptor;
  const offset = caretOffset(field);

  // a new entry is a bigger move than a new line, so it takes the modifier
  if ((event.ctrlKey || event.metaKey) && descriptor.sectionId) {
    if (restructure(addEntryAfter(descriptor.sectionId, descriptor.itemId))) return;
  }

  if (isLine(kind) && descriptor.field !== "tail") {
    if (restructure(splitLine(descriptor, offset))) return;
  }

  if (kind === "prose") {
    if (restructure(splitProse(descriptor, offset))) return;
  }

  if (kind === "group") {
    // the label leads into its own list of skills, and the list leads into a new row
    if (descriptor.field === "label") { step(root, field, 1); return; }
    if (restructure(appendGroup(descriptor.sectionId))) return;
  }

  // everything else behaves like a form: Enter moves on to the next thing to fill in
  step(root, field, 1);
}

function handleBackspace(field, descriptor, event, restructure) {
  if (!isLine(descriptor.kind) || descriptor.field === "tail") return false;

  // an empty line disappears; a line with words joins the one above it
  if (!field.textContent.trim() && descriptor.index > 0) {
    return restructure(removeLine(descriptor));
  }
  if (descriptor.index > 0) {
    flush(field);
    return restructure(mergeBack(descriptor));
  }
  return false;
}

// moves the caret to the next or previous editable thing on the page
function step(root, field, direction) {
  const fields = Array.from(root.querySelectorAll("[data-edit]"));
  const at = fields.indexOf(field);
  if (at === -1) return;
  const next = fields[at + direction];
  if (next) placeCaret(next, direction > 0 ? 0 : "end");
  else field.blur();
}

function commit(field, { final }) {
  writeValue(describeField(field), field.textContent, { final });
}

// pushes what is in the node into the document before the shape around it changes. every writer
// below returns false when the value already matches, so this cannot open an empty undo step
function flush(field) {
  commit(field, { final: false });
}

// the single write path for a field on the page, shared by typing into it and by the inspector
// applying a suggestion, so both take the same route through undo
export function writeValue(descriptor, rawValue, { final = true } = {}) {
  if (!descriptor) return false;
  const value = cleanLine(rawValue).trim();
  const { kind, sectionId, itemId, field: name, index } = descriptor;
  const coalesce = `page:${sectionId}:${itemId || ""}:${name || ""}:${index ?? ""}`;

  return store.commit("Edit resume", (doc) => {
    const section = doc.sections.find((s) => s.id === sectionId);
    if (!section) return false;

    switch (kind) {
      case "sectionTitle":
        // a heading with no text would leave nothing to click back into
        if (!value || section.title === value) return false;
        section.title = value;
        return;

      case "contact":
        section.contact ||= {};
        if (section.contact[name] === value) return false;
        section.contact[name] = value;
        return;

      case "link": {
        const link = section.contact?.links?.[index];
        if (!link) return false;
        // the visible half of a link is its label, unless it never had one and is showing the
        // address itself, in which case that is what an edit is aimed at
        const key = !link.label && name !== "label" ? "url" : "label";
        if (link[key] === value) return false;
        link[key] = value;
        return;
      }

      case "item": {
        const item = section.items?.find((i) => i.id === itemId);
        if (!item || item[name] === value) return false;
        item[name] = value;
        return;
      }

      case "dates": {
        const item = section.items?.find((i) => i.id === itemId);
        if (!item) return false;
        // one field holds both ends, so it is split back apart on the way in
        const parts = value.split(SEPARATOR).map((part) => part.trim()).filter(Boolean);
        const start = parts.length > 1 ? parts[0] : "";
        const end = parts.length > 1 ? parts.slice(1).join(" ") : parts[0] || "";
        if (item.start === start && item.end === end) return false;
        item.start = start;
        item.end = end;
        return;
      }

      case "meta": {
        const item = section.items?.find((i) => i.id === itemId);
        if (!item) return false;
        const lines = String(item.meta || "").split("\n");
        if (lines[index] === value) return false;
        lines[index] = value;
        item.meta = lines.filter((line, i) => line.trim() || i !== index).join("\n");
        return;
      }

      case "bullet": {
        const item = section.items?.find((i) => i.id === itemId);
        if (!item?.bullets) return false;
        const next = joinTail(item.bullets[index], name, value);
        if (item.bullets[index] === next) return false;
        item.bullets[index] = next;
        return;
      }

      case "sectionBullet": {
        if (!section.bullets) return false;
        const next = joinTail(section.bullets[index], name, value);
        if (section.bullets[index] === next) return false;
        section.bullets[index] = next;
        return;
      }

      case "group": {
        const group = section.groups?.[index];
        if (!group || group[name] === value) return false;
        group[name] = value;
        return;
      }

      case "prose": {
        const parts = String(section.body || "").split(/\n{2,}/);
        if (parts[index] === value) return false;
        parts[index] = value;
        section.body = parts.join("\n\n");
        return;
      }

      default:
        return false;
    }
  }, { reason: "page-edit", changed: [sectionId], coalesce: final ? undefined : coalesce });
}

// a bullet with a right hand column is stored as "text<tab>tail", and only one half is being
// edited at a time
function joinTail(current, half, value) {
  const existing = String(current ?? "");
  if (!half) return value;
  const at = existing.indexOf("\t");
  const text = at === -1 ? existing : existing.slice(0, at);
  const tail = at === -1 ? "" : existing.slice(at + 1);
  const next = half === "text" ? [value, tail] : [text, value];
  return next[1].trim() ? `${next[0].trim()}\t${next[1].trim()}` : next[0].trim();
}
