import { h, clear, trapFocus, qs, prefersReducedMotion } from "../lib/dom.js";

// modal dialogs and popover menus. Both close on Escape, restore focus to their opener, and
// stack correctly if one opens another

const overlays = () => document.getElementById("overlays");
const stack = [];

function close(entry, result) {
  const index = stack.indexOf(entry);
  if (index === -1) return;
  stack.splice(index, 1);

  entry.release?.();
  document.removeEventListener("keydown", entry.onKeyDown, true);

  const finish = () => {
    entry.node.remove();
    entry.scrim?.remove();
  };

  if (prefersReducedMotion()) finish();
  else {
    entry.node.classList.add("is-out");
    entry.scrim?.classList.add("is-out");
    setTimeout(finish, 200);
  }

  entry.resolve?.(result);
}

export function closeTopOverlay() {
  if (!stack.length) return false;
  close(stack[stack.length - 1], null);
  return true;
}

export function hasOverlay() {
  return stack.length > 0;
}

// opens a modal dialog
// `done`
export function openDialog({ title, description, body, actions = [], width, onMount }) {
  return new Promise((resolve) => {
    const node = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title });
    if (width) node.style.width = `min(${width}px, calc(100vw - 32px))`;

    const entry = { node, resolve };
    const done = (value) => close(entry, value);

    const head = h("div", { class: "dialog-head" },
      h("h2", null, title),
      description && h("p", null, description));
    const content = h("div", { class: "dialog-body" });
    if (typeof body === "function") content.appendChild(body(done));
    else if (body) content.appendChild(body);

    const foot = h("div", { class: "dialog-foot" });
    for (const action of actions) {
      foot.appendChild(h("button", {
        class: `btn ${action.variant || "btn-ghost"}${action.spread ? " spread" : ""}`,
        onclick: () => (action.onClick ? action.onClick(done) : done(action.value ?? null)),
      }, action.label));
    }

    node.append(head, content, actions.length ? foot : "");

    const scrim = h("div", { class: "scrim", onclick: () => done(null) });
    entry.scrim = scrim;

    entry.onKeyDown = (event) => {
      if (event.key === "Escape" && stack[stack.length - 1] === entry) {
        event.preventDefault();
        event.stopPropagation();
        done(null);
      }
    };
    document.addEventListener("keydown", entry.onKeyDown, true);

    overlays().append(scrim, node);
    stack.push(entry);
    entry.release = trapFocus(node);

    onMount?.(node, done);
    const focusTarget = qs("[data-autofocus]", node) || qs("input, textarea, select, button", node);
    focusTarget?.focus();
    if (focusTarget?.select) focusTarget.select();
  });
}

export function confirmDialog({ title, description, confirmLabel = "Confirm", danger = false }) {
  return openDialog({
    title,
    description,
    width: 420,
    actions: [
      { label: "Cancel", variant: "btn-ghost", value: false },
      { label: confirmLabel, variant: danger ? "btn-danger" : "btn-primary", value: true },
    ],
  }).then((value) => value === true);
}

export function promptDialog({ title, description, label, value = "", placeholder = "", confirmLabel = "Save" }) {
  let input;
  return openDialog({
    title,
    description,
    width: 440,
    body: (done) => {
      input = h("input", { class: "input", value, placeholder, "data-autofocus": "1",
        onkeydown: (event) => { if (event.key === "Enter") { event.preventDefault(); done(input.value.trim()); } } });
      return h("div", { class: "field" }, label && h("label", null, label), input);
    },
    actions: [
      { label: "Cancel", variant: "btn-ghost", value: null },
      { label: confirmLabel, variant: "btn-primary", onClick: (done) => done(input.value.trim()) },
    ],
  });
}

// opens a popover menu anchored to an element. `items` accepts { label, icon, hint, onClick,
// danger, disabled } or { separator } or { label, heading }
export function openMenu(anchor, items, { align = "end" } = {}) {
  const node = h("div", { class: "menu", role: "menu" });
  const entry = { node };
  const done = () => close(entry, null);

  const buttons = [];
  for (const item of items) {
    if (!item) continue;
    if (item.separator) { node.appendChild(h("div", { class: "menu-sep" })); continue; }
    if (item.heading) { node.appendChild(h("div", { class: "menu-label" }, item.heading)); continue; }

    const button = h("button", {
      class: `menu-item${item.danger ? " is-danger" : ""}`,
      role: "menuitem",
      "aria-disabled": item.disabled ? "true" : null,
      onclick: () => { done(); item.onClick?.(); },
    },
      item.icon || null,
      h("span", { class: "grow" }, item.label),
      item.hint && h("span", { class: "tail" }, item.hint),
      item.checked ? h("span", { class: "tail" }, "✓") : null);
    node.appendChild(button);
    if (!item.disabled) buttons.push(button);
  }

  const scrim = h("div", {
    class: "scrim",
    style: { background: "transparent", backdropFilter: "none" },
    onpointerdown: (event) => { event.preventDefault(); done(); },
  });
  entry.scrim = scrim;

  let cursor = -1;
  entry.onKeyDown = (event) => {
    if (stack[stack.length - 1] !== entry) return;
    if (event.key === "Escape") { event.preventDefault(); done(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      cursor = (cursor + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[cursor]?.focus();
    }
  };
  document.addEventListener("keydown", entry.onKeyDown, true);

  overlays().append(scrim, node);
  stack.push(entry);
  entry.release = trapFocus(node);

  positionMenu(node, anchor, align);
  return entry;
}

function positionMenu(node, anchor, align) {
  const rect = anchor.getBoundingClientRect();
  const menu = node.getBoundingClientRect();
  const gap = 6;

  let left = align === "start" ? rect.left : rect.right - menu.width;
  left = Math.max(8, Math.min(left, window.innerWidth - menu.width - 8));

  let top = rect.bottom + gap;
  if (top + menu.height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - menu.height - gap);
  }

  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}
