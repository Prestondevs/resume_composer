import { h, clear, icon, trapFocus, prefersReducedMotion } from "../lib/dom.js";
import { fuzzyMatch, highlight } from "../lib/util.js";

// command palette. Commands are supplied by main.js so this file stays a pure picker: filter,
// keyboard navigation, run

let open = null;

export function isPaletteOpen() {
  return Boolean(open);
}

export function closePalette() {
  if (!open) return false;
  const { node, scrim, release, onKeyDown } = open;
  open = null;
  release();
  document.removeEventListener("keydown", onKeyDown, true);
  if (prefersReducedMotion()) { node.remove(); scrim.remove(); }
  else {
    node.classList.add("is-out");
    scrim.classList.add("is-out");
    setTimeout(() => { node.remove(); scrim.remove(); }, 180);
  }
  return true;
}

// Function}>} getCommands
export function openPalette(getCommands) {
  if (open) { closePalette(); return; }

  const commands = getCommands();
  let filtered = commands;
  let cursor = 0;

  const input = h("input", {
    class: "palette-input",
    type: "text",
    placeholder: "Search sections, run a command…",
    "aria-label": "Command palette",
    autocomplete: "off",
    spellcheck: "false",
  });
  const list = h("div", { class: "palette-list", role: "listbox" });
  const node = h("div", { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": "Command palette" },
    input,
    list,
    h("div", { class: "palette-foot" },
      h("span", null, h("kbd", null, "↑"), h("kbd", null, "↓"), " navigate"),
      h("span", null, h("kbd", null, "↵"), " run"),
      h("span", null, h("kbd", null, "esc"), " close")));

  const scrim = h("div", { class: "scrim", onclick: () => closePalette() });

  const paint = () => {
    clear(list);
    if (!filtered.length) {
      list.appendChild(h("div", { class: "palette-empty" }, "No matches."));
      return;
    }

    let lastGroup = null;
    filtered.forEach((command, index) => {
      if (command.group && command.group !== lastGroup) {
        lastGroup = command.group;
        list.appendChild(h("div", { class: "menu-label" }, command.group));
      }
      list.appendChild(h("button", {
        class: `palette-item${index === cursor ? " is-active" : ""}`,
        role: "option",
        "aria-selected": String(index === cursor),
        onmousemove: () => { if (cursor !== index) { cursor = index; paint(); } },
        onclick: () => run(command),
      },
        h("span", { class: "p-glyph" }, command.icon ? icon(command.icon, 15) : h("span", null, "›")),
        h("span", { class: "p-body" },
          h("span", { class: "p-title", _html: highlight(command.title, command.hits) }),
          command.subtitle && h("span", { class: "p-sub" }, command.subtitle)),
        command.keys && h("span", { class: "p-keys" }, command.keys.map((key) => h("kbd", null, key)))));
    });

    list.children[cursor]?.scrollIntoView?.({ block: "nearest" });
  };

  const filter = () => {
    const query = input.value.trim();
    if (!query) {
      filtered = commands;
    } else {
      filtered = commands
        .map((command) => {
          const primary = fuzzyMatch(query, command.title);
          const secondary = command.subtitle ? fuzzyMatch(query, command.subtitle) : null;
          if (!primary && !secondary) return null;
          return { ...command, score: (primary?.score || 0) + (secondary?.score || 0) * 0.4, hits: primary?.hits, group: null };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40);
    }
    cursor = 0;
    paint();
  };

  const run = (command) => {
    closePalette();
    // let the overlay tear down before the command moves focus
    requestAnimationFrame(() => command.run());
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); closePalette(); return; }
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      cursor = Math.min(cursor + 1, filtered.length - 1);
      paint();
    } else if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      cursor = Math.max(cursor - 1, 0);
      paint();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[cursor]) run(filtered[cursor]);
    } else if (event.key === "Home") {
      cursor = 0; paint();
    } else if (event.key === "End") {
      cursor = filtered.length - 1; paint();
    }
  };

  input.addEventListener("input", filter);
  document.addEventListener("keydown", onKeyDown, true);

  document.getElementById("overlays").append(scrim, node);
  open = { node, scrim, onKeyDown, release: trapFocus(node) };

  paint();
  input.focus();
}
