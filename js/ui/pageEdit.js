import { store } from "../store.js";
import { cleanLine } from "../lib/util.js";

// direct editing on the rendered page
// the renderer marks each piece of text with where its value lives, and this reads those markers
// back. edits commit under their own reason so the cards, counts and score keep up while the page
// itself is left alone: repainting it mid-keystroke would drop the caret

const SEPARATOR = /\s*[-–—]\s*|\s+to\s+/i;

export function attachPageEditing(root, { onEdit, onFocusChange } = {}) {
  let active = null;

  const fieldOf = (node) => node?.closest?.("[data-edit]");

  root.addEventListener("focusin", (event) => {
    const field = fieldOf(event.target);
    if (!field) return;
    active = field;
    onFocusChange?.(true);
  });

  root.addEventListener("focusout", (event) => {
    const field = fieldOf(event.target);
    if (!field) return;
    commit(field, { final: true });
    active = null;
    // the blur may be a click into another field, so settle before repainting
    setTimeout(() => { if (!active) onFocusChange?.(false); }, 0);
  });

  root.addEventListener("input", (event) => {
    const field = fieldOf(event.target);
    if (!field) return;
    commit(field, { final: false });
    onEdit?.();
  });

  root.addEventListener("keydown", (event) => {
    const field = fieldOf(event.target);
    if (!field) return;

    if (event.key === "Escape") {
      event.preventDefault();
      field.blur();
      return;
    }
    // a heading or a single line field is one line; Enter would otherwise insert a break that
    // the plain text value cannot represent
    if (event.key === "Enter" && !event.shiftKey && field.dataset.edit !== "prose") {
      event.preventDefault();
      field.blur();
    }
  });

  // clicking a link on the page should place the caret, not navigate away from the editor
  root.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[data-edit]");
    if (anchor) event.preventDefault();
  });

  return () => { active = null; };
}

function commit(field, { final }) {
  const value = cleanLine(field.textContent).trim();
  const { edit: kind, section: sectionId, item: itemId, field: name } = field.dataset;
  const index = field.dataset.index == null ? null : Number(field.dataset.index);
  const coalesce = `page:${sectionId}:${itemId || ""}:${name || ""}:${index ?? ""}`;

  store.commit("Edit resume", (doc) => {
    const section = doc.sections.find((s) => s.id === sectionId);
    if (!section) return false;

    switch (kind) {
      case "sectionTitle":
        if (!value) return false;
        section.title = value;
        return;

      case "contact":
        section.contact ||= {};
        section.contact[name] = value;
        return;

      case "link": {
        const link = section.contact?.links?.[index];
        if (!link) return false;
        link.label = value;
        return;
      }

      case "item": {
        const item = section.items?.find((i) => i.id === itemId);
        if (!item) return false;
        item[name] = value;
        return;
      }

      case "dates": {
        const item = section.items?.find((i) => i.id === itemId);
        if (!item) return false;
        // one field holds both ends, so it is split back apart on the way in
        const parts = value.split(SEPARATOR).map((part) => part.trim()).filter(Boolean);
        item.start = parts.length > 1 ? parts[0] : "";
        item.end = parts.length > 1 ? parts.slice(1).join(" ") : parts[0] || "";
        return;
      }

      case "meta": {
        const item = section.items?.find((i) => i.id === itemId);
        if (!item) return false;
        const lines = String(item.meta || "").split("\n");
        lines[index] = value;
        item.meta = lines.filter((line, i) => line.trim() || i !== index).join("\n");
        return;
      }

      case "bullet": {
        const item = section.items?.find((i) => i.id === itemId);
        if (!item?.bullets) return false;
        item.bullets[index] = joinTail(item.bullets[index], name, value);
        return;
      }

      case "sectionBullet": {
        if (!section.bullets) return false;
        section.bullets[index] = joinTail(section.bullets[index], name, value);
        return;
      }

      case "group": {
        const group = section.groups?.[index];
        if (!group) return false;
        group[name] = value;
        return;
      }

      case "prose": {
        const parts = String(section.body || "").split(/\n{2,}/);
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
