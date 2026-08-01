import { h, clear, qs, icon } from "../lib/dom.js";
import { escapeHtml, countWords, throttleFrame, clamp } from "../lib/util.js";
import { store } from "../store.js";
import { renderResume, renderEmptyState, pageMetrics } from "../templates/render.js";
import { toPlainText } from "../export/serialize.js";
import { atsReport } from "../analysis/review.js";
import { documentText } from "../schema.js";
import { attachPageEditing } from "./pageEdit.js";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5];
const SEPARATOR = "  ·  ";

export class PreviewView {
  constructor({ canvas, scroll, atsOut, meta, zoomSelect, zoomIn, zoomOut, modeButtons, onFocusSection, onImport, onStart, onSelect }) {
    this.canvas = canvas;
    this.scroll = scroll;
    this.atsOut = atsOut;
    this.meta = meta;
    this.zoomSelect = zoomSelect;
    this.onFocusSection = onFocusSection;
    this.onImport = onImport;
    this.onStart = onStart;

    this.doc = h("div", { class: "r-doc" });
    this.canvas.appendChild(this.doc);

    this.lastResult = { pages: 0 };
    this.schedule = throttleFrame(() => this.paint());

    // typing on the page must not repaint the page, or the caret is lost on every keystroke. the
    // repaint is deferred until focus leaves, and only then if something actually changed
    this.editing = false;
    this.pendingRepaint = false;
    attachPageEditing(this.canvas, {
      onSelect,
      onEdit: () => { this.pendingRepaint = true; this.paintMeta(store.doc); },
      onFocusChange: (editing) => {
        this.editing = editing;
        if (!editing && this.pendingRepaint) {
          this.pendingRepaint = false;
          this.render();
        }
      },
    });

    zoomSelect.addEventListener("change", () => {
      const value = zoomSelect.value;
      store.setUi({ zoom: value === "fit" ? "fit" : Number(value) }, { reason: "zoom" });
    });
    zoomIn.addEventListener("click", () => this.stepZoom(1));
    zoomOut.addEventListener("click", () => this.stepZoom(-1));

    for (const button of modeButtons) {
      button.addEventListener("click", () => {
        for (const other of modeButtons) other.classList.toggle("is-on", other === button);
        store.setUi({ view: button.dataset.view }, { reason: "view" });
      });
    }

    this.canvas.addEventListener("click", (event) => {
      const section = event.target.closest("[data-jump][data-section]");
      if (!section) return;
      this.onFocusSection?.(section.dataset.section);
    });

    // ctrl/Cmd + wheel zooms, matching every other canvas tool
    this.scroll.addEventListener("wheel", (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      this.stepZoom(event.deltaY < 0 ? 1 : -1);
    }, { passive: false });

    // applyZoom resizes the canvas, which would retrigger this observer; only react when the
    // container's own width really changed, and never re-enter while applying
    this.lastFitWidth = 0;
    this.resizeObserver = new ResizeObserver(() => {
      if (store.ui.zoom !== "fit" || this.applyingZoom) return;
      const width = this.scroll.clientWidth;
      if (Math.abs(width - this.lastFitWidth) < 2) return;
      this.lastFitWidth = width;
      // resizing the canvas from inside the callback would resize an element the observer is
      // watching, which the browser reports as an undelivered notification loop. deferring to the
      // next frame keeps the work outside the observation pass
      cancelAnimationFrame(this.fitFrame);
      this.fitFrame = requestAnimationFrame(() => this.applyZoom());
    });
    this.resizeObserver.observe(this.scroll);
  }

  stepZoom(direction) {
    const current = store.ui.zoom === "fit" ? this.fitScale() : store.ui.zoom;
    const index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001);
    const next = ZOOM_STEPS[clamp((index === -1 ? ZOOM_STEPS.length - 1 : index) + direction, 0, ZOOM_STEPS.length - 1)];
    store.setUi({ zoom: next }, { reason: "zoom" });
  }

  // the docks float over the page, so fit measures the gap they leave rather than the
  // whole stage. the page still sits in the centre; it is just scaled to stay readable
  fitScale() {
    const metrics = pageMetrics(store.doc);
    let widest = 0;
    for (const dock of document.querySelectorAll(".dock")) {
      if (dock.dataset.collapsed === "true") continue;
      widest = Math.max(widest, dock.getBoundingClientRect().width);
    }
    const gutter = widest ? widest * 2 + 48 : 56;
    const available = this.scroll.clientWidth - gutter;
    return clamp(available / metrics.widthPx, 0.3, 2);
  }

  applyZoom() {
    this.applyingZoom = true;
    try {
      const scale = store.ui.zoom === "fit" ? this.fitScale() : Number(store.ui.zoom) || 1;
      const metrics = pageMetrics(store.doc);

      this.doc.style.transformOrigin = "top left";
      this.doc.style.transform = `scale(${scale})`;

      // the sizer reserves the post-scale footprint so scrollbars stay honest
      const height = this.doc.scrollHeight || metrics.heightPx;
      this.canvas.style.width = `${Math.ceil(metrics.widthPx * scale)}px`;
      this.canvas.style.height = `${Math.ceil(height * scale)}px`;

      const label = store.ui.zoom === "fit" ? "fit" : String(store.ui.zoom);
      if (this.zoomSelect.value !== label) this.zoomSelect.value = label;
    } finally {
      this.applyingZoom = false;
    }
  }

  render() {
    // a repaint while the caret is on the page would rebuild the node being typed into
    if (this.editing) {
      this.pendingRepaint = true;
      this.paintMeta(store.doc);
      return;
    }
    this.schedule();
  }

  paint() {
    const doc = store.doc;
    const view = store.ui.view || "paper";

    this.atsOut.hidden = view !== "ats";
    this.canvas.hidden = view === "ats";
    qs(".ats-report", this.scroll)?.remove();

    if (view === "ats") {
      this.paintAts(doc);
      this.paintMeta(doc);
      return;
    }

    const hasAnything = doc.sections.some((section) => section.visible);
    if (!hasAnything) {
      clear(this.canvas);
      this.canvas.style.width = "";
      this.canvas.style.height = "";
      renderEmptyState(this.canvas, this.onImport, this.onStart);
      this.canvas.className = "canvas";
      this.doc = h("div", { class: "r-doc" });
      this.lastResult = { pages: 0 };
      this.paintMeta(doc);
      return;
    }

    if (!this.doc.isConnected) {
      clear(this.canvas);
      this.canvas.className = "canvas";
      this.canvas.appendChild(this.doc);
    }

    this.lastResult = renderResume(doc, this.doc);
    if (!this.lastResult.pages) {
      clear(this.canvas);
      renderEmptyState(this.canvas, this.onImport, this.onStart);
      this.doc = h("div", { class: "r-doc" });
      this.paintMeta(doc);
      return;
    }

    this.applyZoom();
    this.paintMeta(doc);
  }

  paintAts(doc) {
    const text = toPlainText(doc, { width: 92 });
    const report = atsReport(doc);

    const flagged = escapeHtml(text)
      .split("\n")
      .map((line) => {
        if (/^[A-Z][A-Z0-9 &,'/-]{2,}$/.test(line.trim()) && line.trim().length < 46) {
          return `<span class="ats-h">${line}</span>`;
        }
        return line
          .replace(/([℀-➿])/gu, '<span class="ats-bad">$1</span>')
          .replace(/(\t)/g, '<span class="ats-flag">→</span>');
      })
      .join("\n");

    this.atsOut.innerHTML = flagged;

    const list = h("div", { class: "ats-report" },
      h("h3", null, "What a parser sees"),
      h("ul", null, report.map((item) => h("li", { "data-tone": item.tone },
        icon(item.tone === "good" ? "checkCircle" : item.tone === "bad" ? "warn" : "info", 15),
        h("span", null, item.text)))));

    this.scroll.insertBefore(list, this.atsOut);
  }

  paintMeta(doc) {
    const text = documentText(doc);
    const words = countWords(text);
    const pages = this.lastResult.pages || 0;
    const overflowing = this.lastResult.overflow && this.lastResult.columnsFixed;

    clear(this.meta);
    const bits = [
      pages ? `${pages} page${pages > 1 ? "s" : ""}` : "empty",
      `${words} words`,
      `${text.replace(/\s/g, "").length} characters`,
    ];

    // the separator is real text, not an empty styled element. an element only carries the gap
    // visually, so anything reading the bar back gets "2 pages578 words3758 characters"
    this.meta.appendChild(document.createTextNode(bits.join(SEPARATOR)));

    const warning = overflowing ? "content runs past one page" : pages > 2 ? "over two pages" : "";
    if (warning) {
      this.meta.appendChild(document.createTextNode(SEPARATOR));
      this.meta.appendChild(h("span", { class: "over" }, warning));
    }
  }

  highlightSection(sectionId) {
    for (const el of this.canvas.querySelectorAll(".r-section.is-linked")) el.classList.remove("is-linked");
    const target = this.canvas.querySelector(`.r-section[data-section="${CSS.escape(sectionId)}"]`);
    if (!target) return;
    target.classList.add("is-linked");
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => target.classList.remove("is-linked"), 1600);
  }
}
