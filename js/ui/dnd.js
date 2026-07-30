import { h, announce, prefersReducedMotion } from "../lib/dom.js";
import { clamp, throttleFrame } from "../lib/util.js";

// sortable card list
// pointer Events cover mouse, touch and pen from one code path. The dragged card is lifted out
// of flow into a fixed-position element while a placeholder of the same height holds its place,
// so the remaining cards reflow naturally; FLIP then animates that reflow instead of letting
// rows jump
// keyboard users get the same operation without a pointer: focus a grip, press Space to pick
// up, arrows to move, Space to drop, Escape to cancel

const DRAG_THRESHOLD = 4;
const AUTOSCROLL_ZONE = 64;
const AUTOSCROLL_MAX = 18;

export class SortableList {
  // boolean, getSelection: () => string[], onReorder: (ids: string[], toIndex: number) => void,
  // onActivate?: (id: string) => void}} options
  constructor(options) {
    this.options = options;
    this.container = options.container;
    this.state = null;
    this.keyboard = null;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = throttleFrame(this.handleMove.bind(this));
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);

    this.container.addEventListener("pointerdown", this.onPointerDown);
    this.container.addEventListener("keydown", this.onKeyDown);
  }

  destroy() {
    this.container.removeEventListener("pointerdown", this.onPointerDown);
    this.container.removeEventListener("keydown", this.onKeyDown);
    this.cancel();
  }

  items() {
    return Array.from(this.container.querySelectorAll(this.options.item));
  }

  // pointer

  onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const handle = event.target.closest(this.options.handle);
    if (!handle || !this.container.contains(handle)) return;

    const card = handle.closest(this.options.item);
    if (!card) return;
    const id = card.dataset.id;
    if (this.options.canDrag && !this.options.canDrag(id)) return;

    event.preventDefault();

    this.pending = {
      id,
      card,
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };

    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", this.onPointerMove);
    handle.addEventListener("pointerup", this.onPointerUp);
    handle.addEventListener("pointercancel", this.onPointerUp);
  }

  handleMove(event) {
    if (!this.pending || event.pointerId !== this.pending.pointerId) return;

    if (!this.state) {
      const moved = Math.hypot(event.clientX - this.pending.startX, event.clientY - this.pending.startY);
      if (moved < DRAG_THRESHOLD) return;
      this.begin(event);
    }

    const state = this.state;
    if (!state) return;

    state.pointerX = event.clientX;
    state.pointerY = event.clientY;

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    state.lift.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${state.scale})`;

    this.updateAutoScroll();
    this.updateTarget(event.clientY);
  }

  begin(event) {
    const { card, id } = this.pending;
    const selection = this.options.getSelection?.() || [];
    const ids = selection.includes(id) && selection.length > 1 ? selection : [id];

    const cards = this.items();
    const moving = cards.filter((el) => ids.includes(el.dataset.id));
    const rect = card.getBoundingClientRect();

    // a slot the same height as everything being moved keeps the scroll
    // position stable while the rest of the list reflows
    const totalHeight = moving.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0)
      + (moving.length - 1) * 9;

    const slot = h("div", { class: "drag-slot" });
    slot.style.height = `${totalHeight}px`;
    card.parentElement.insertBefore(slot, card);

    const before = this.snapshot(cards.filter((el) => !moving.includes(el)));

    for (const el of moving) {
      if (el !== card) el.style.display = "none";
    }

    card.classList.add("is-dragging");
    card.style.width = `${rect.width}px`;
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    card.style.setProperty("--grab-x", `${((event.clientX - rect.left) / rect.width) * 100}%`);
    card.style.setProperty("--grab-y", `${((event.clientY - rect.top) / rect.height) * 100}%`);

    if (ids.length > 1) {
      card.appendChild(h("div", { class: "drag-stack-count" }, String(ids.length)));
    }

    this.container.classList.add("is-dragging");
    document.body.style.userSelect = "none";

    this.state = {
      ids,
      moving,
      lift: card,
      slot,
      startX: event.clientX,
      startY: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      scale: prefersReducedMotion() ? 1 : 1.015,
      originIndex: cards.indexOf(card),
      scroller: this.container,
    };

    this.animateFrom(before);
    announce(`Picked up ${ids.length > 1 ? `${ids.length} sections` : "section"}. Move to reorder.`);
  }

  snapshot(elements) {
    return elements.map((el) => ({ el, top: el.getBoundingClientRect().top }));
  }

  // FLIP: invert the positions we just changed, then let CSS play them out
  animateFrom(before) {
    if (prefersReducedMotion()) return;
    for (const record of before) {
      if (!record.el.isConnected || record.el.style.display === "none") continue;
      const delta = record.top - record.el.getBoundingClientRect().top;
      if (!delta) continue;
      record.el.style.transition = "none";
      record.el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        record.el.style.transition = "";
        record.el.classList.add("is-shifting");
        record.el.style.transform = "";
      });
    }
  }

  updateTarget(pointerY) {
    const state = this.state;
    const candidates = this.items().filter((el) => !state.moving.includes(el) && el.style.display !== "none");

    let insertBefore = null;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (pointerY < rect.top + rect.height / 2) { insertBefore = el; break; }
    }

    const currentNext = state.slot.nextElementSibling === state.lift
      ? state.lift.nextElementSibling
      : state.slot.nextElementSibling;
    if (currentNext === insertBefore) return;

    // the first card is the contact block and never moves
    if (insertBefore && candidates.indexOf(insertBefore) === 0 && this.options.pinFirst) return;

    const before = this.snapshot(candidates);
    if (insertBefore) state.slot.parentElement.insertBefore(state.slot, insertBefore);
    else state.slot.parentElement.appendChild(state.slot);
    this.animateFrom(before);
  }

  updateAutoScroll() {
    const state = this.state;
    const rect = this.container.getBoundingClientRect();
    let speed = 0;

    if (state.pointerY < rect.top + AUTOSCROLL_ZONE) {
      speed = -AUTOSCROLL_MAX * (1 - (state.pointerY - rect.top) / AUTOSCROLL_ZONE);
    } else if (state.pointerY > rect.bottom - AUTOSCROLL_ZONE) {
      speed = AUTOSCROLL_MAX * (1 - (rect.bottom - state.pointerY) / AUTOSCROLL_ZONE);
    }

    speed = clamp(speed, -AUTOSCROLL_MAX, AUTOSCROLL_MAX);

    if (!speed) {
      cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = null;
      return;
    }
    if (this.scrollFrame) return;

    const step = () => {
      if (!this.state) { this.scrollFrame = null; return; }
      this.container.scrollTop += speed;
      this.updateTarget(this.state.pointerY);
      this.scrollFrame = requestAnimationFrame(step);
    };
    this.scrollFrame = requestAnimationFrame(step);
  }

  onPointerUp(event) {
    const pending = this.pending;
    if (pending) {
      pending.handle.removeEventListener("pointermove", this.onPointerMove);
      pending.handle.removeEventListener("pointerup", this.onPointerUp);
      pending.handle.removeEventListener("pointercancel", this.onPointerUp);
      if (pending.handle.hasPointerCapture?.(pending.pointerId)) {
        pending.handle.releasePointerCapture(pending.pointerId);
      }
    }
    this.pending = null;
    if (!this.state) return;

    const dropped = event.type === "pointercancel" ? null : this.commitTarget();
    this.finish(dropped);
  }

  commitTarget() {
    const state = this.state;
    const order = this.items()
      .filter((el) => el.style.display !== "none")
      .map((el) => el.dataset.id);

    const slotIndex = Array.from(state.slot.parentElement.children)
      .filter((el) => el.matches(this.options.item) || el === state.slot)
      .indexOf(state.slot);

    return { order, index: Math.max(0, slotIndex) };
  }

  // animates the lifted card into the slot, then hands the new order upward
  finish(dropped) {
    const state = this.state;
    if (!state) return;

    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = null;

    const slotRect = state.slot.getBoundingClientRect();
    const liftRect = state.lift.getBoundingClientRect();
    const settle = () => {
      state.lift.classList.remove("is-dragging", "is-returning");
      state.lift.style.cssText = "";
      state.lift.querySelector(".drag-stack-count")?.remove();
      for (const el of state.moving) el.style.display = "";
      state.slot.remove();
      this.container.classList.remove("is-dragging");
      document.body.style.userSelect = "";
      for (const el of this.items()) el.classList.remove("is-shifting");

      if (dropped) {
        state.lift.classList.add("is-settling");
        setTimeout(() => state.lift.classList.remove("is-settling"), 340);
        this.options.onReorder(state.ids, dropped.index);
        announce("Section moved.");
      } else {
        announce("Move cancelled.");
      }
      this.state = null;
    };

    if (prefersReducedMotion()) { settle(); return; }

    state.lift.classList.add("is-returning");
    state.lift.style.transform = `translate3d(${slotRect.left - liftRect.left}px, ${slotRect.top - liftRect.top}px, 0) scale(1)`;

    let done = false;
    const once = () => { if (done) return; done = true; settle(); };
    state.lift.addEventListener("transitionend", once, { once: true });
    setTimeout(once, 380);
  }

  cancel() {
    if (this.state) this.finish(null);
  }

  // keyboard

  onKeyDown(event) {
    const handle = event.target.closest(this.options.handle);

    if (this.keyboard) {
      const { card } = this.keyboard;
      if (event.key === "Escape") {
        event.preventDefault();
        this.endKeyboard(false);
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        this.endKeyboard(true);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const cards = this.items();
        const index = cards.indexOf(card);
        const target = index + (event.key === "ArrowDown" ? 1 : -1);
        const floor = this.options.pinFirst ? 1 : 0;
        if (target < floor || target >= cards.length) return;

        const before = this.snapshot(cards);
        if (event.key === "ArrowDown") card.parentElement.insertBefore(cards[target], card);
        else card.parentElement.insertBefore(card, cards[target]);
        this.animateFrom(before);
        card.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        announce(`Position ${target + 1} of ${cards.length}.`);
        return;
      }
      return;
    }

    if (!handle) return;
    if (event.key !== " " && event.key !== "Enter") return;

    const card = handle.closest(this.options.item);
    if (!card) return;
    const id = card.dataset.id;
    if (this.options.canDrag && !this.options.canDrag(id)) return;

    event.preventDefault();
    this.keyboard = { card, id, originalNext: card.nextElementSibling };
    card.classList.add("is-keyboard-grabbed");
    announce("Grabbed. Use arrow keys to move, space to drop, escape to cancel.");
  }

  endKeyboard(commit) {
    const { card, id, originalNext } = this.keyboard;
    card.classList.remove("is-keyboard-grabbed");
    this.keyboard = null;

    if (!commit) {
      card.parentElement.insertBefore(card, originalNext);
      announce("Move cancelled.");
      return;
    }

    const index = this.items().indexOf(card);
    this.options.onReorder([id], index);
    announce(`Dropped at position ${index + 1}.`);
  }
}
