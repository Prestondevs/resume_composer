import { h, announce, prefersReducedMotion } from "../lib/dom.js";

const host = () => document.getElementById("toasts");
const active = new Map();

// string, onClick: Function}, key?: string}} options
export function toast(options) {
  const { title, message, tone = "info", duration = tone === "bad" ? 9000 : 4800, action, key } = options;

  if (key && active.has(key)) dismiss(active.get(key), true);

  const el = h("div", { class: `toast toast-${tone}`, role: tone === "bad" ? "alert" : "status" },
    h("span", { class: "toast-dot", "aria-hidden": "true" }),
    h("div", { class: "toast-text" },
      title && h("strong", null, title),
      message && h("span", null, message)),
    action
      ? h("button", {
          class: "toast-act",
          onclick: () => { action.onClick(); dismiss(el); },
        }, action.label)
      : h("button", { class: "toast-act", "aria-label": "Dismiss", onclick: () => dismiss(el) }, "Close"),
  );

  host().appendChild(el);
  if (key) active.set(key, el);
  announce([title, message].filter(Boolean).join(". "));

  if (duration > 0) {
    const timer = setTimeout(() => dismiss(el), duration);
    el.addEventListener("pointerenter", () => clearTimeout(timer));
  }

  return el;
}

function dismiss(el, immediate = false) {
  if (!el?.isConnected) return;
  for (const [key, value] of active) if (value === el) active.delete(key);
  if (immediate || prefersReducedMotion()) {
    el.remove();
    return;
  }
  el.classList.add("is-out");
  el.addEventListener("animationend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 400);
}

// toast that stays until `update` reports completion. Used by imports
export function progressToast(title) {
  const label = h("span", null, "Starting…");
  const el = h("div", { class: "toast toast-info", role: "status" },
    h("span", { class: "toast-dot", "aria-hidden": "true" }),
    h("div", { class: "toast-text" }, h("strong", null, title), label));
  host().appendChild(el);

  return {
    update(message) { label.textContent = message; },
    done(finalOptions) {
      dismiss(el, true);
      if (finalOptions) toast(finalOptions);
    },
  };
}
