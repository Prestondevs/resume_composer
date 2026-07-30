import { h, qs, qsa, icon, announce, clear } from "./lib/dom.js";
import { debounce, plural } from "./lib/util.js";
import { store } from "./store.js";
import { typeInfo, blankDocument, isSectionEmpty, TEMPLATES } from "./schema.js";
import { CardsView } from "./ui/cards.js";
import { PreviewView } from "./ui/preview.js";
import { PanelHost, TOOL_PANELS } from "./ui/panels.js";
import { openPalette, closePalette, isPaletteOpen } from "./ui/palette.js";
import { openMenu, openDialog, promptDialog, closeTopOverlay, hasOverlay } from "./ui/overlay.js";
import { toast, progressToast } from "./ui/toasts.js";
import { importFile, isAcceptedFile, ACCEPTED_EXTENSIONS } from "./import/index.js";
import { exportDocument, EXPORT_FORMATS, exportFileName } from "./export/index.js";

const el = {};
let cards;
let preview;
let panels;

function boot() {
  cacheElements();
  store.load();
  applyTheme();

  panels = new PanelHost(el.panel, {
    onFocusSection: (id) => focusSection(id),
    onApplyAction: applySuggestion,
  });

  cards = new CardsView(el.cards, { onFocusSection: (id) => preview.highlightSection(id) });

  preview = new PreviewView({
    canvas: el.canvas,
    scroll: el.canvasScroll,
    atsOut: el.atsOut,
    meta: el.canvasMeta,
    zoomSelect: el.zoomSelect,
    zoomIn: el.zoomIn,
    zoomOut: el.zoomOut,
    modeButtons: qsa("#viewbar .seg-btn"),
    onFocusSection: (id) => focusSection(id),
    onImport: () => el.fileInput.click(),
    onStart: () => startBlank(),
  });

  paintIcons();
  wireTopbar();
  wireDocks();
  wireFiles();
  wireShortcuts();

  store.subscribe(onStoreChange);

  applyUi();
  renderAll();

  el.app.hidden = false;
  playEntrance();
  el.boot.classList.add("is-gone");
  setTimeout(() => el.boot.remove(), 400);

  if (store.isFirstRun) welcome();
}

// each region arrives from the edge it lives on, staggered so the eye lands on the page first.
// the classes are stripped once they finish: the library sets animation-fill-mode to both, and a
// settled transform on a dock would leave a containing block that interferes with dragging and
// with the width transition used when it collapses
function playEntrance() {
  const entrance = [
    [el.canvasScroll, "fade-in", 0],
    [qs(".topbar"), "fade-in-down", 40],
    [el.dockLeft, "fade-in-left", 110],
    [el.dockRight, "fade-in-right", 110],
    // the view bar is centred with a transform of its own, and a transform based entrance would
    // replace it for the duration and snap back at the end, so it only fades
    [qs("#viewbar"), "fade-in", 200],
  ];

  for (const [node, effect, delay] of entrance) {
    if (!node) continue;
    node.classList.add("vov", "faster", effect);
    node.style.animationDelay = `${delay}ms`;

    const done = () => {
      node.classList.remove("vov", "faster", effect);
      node.style.animationDelay = "";
    };
    node.addEventListener("animationend", done, { once: true });
    // animations never fire when the user asks for reduced motion, so clean up regardless
    setTimeout(done, delay + 900);
  }
}

function cacheElements() {
  Object.assign(el, {
    app: qs("#app"),
    boot: qs("#boot"),
    stage: qs("#stage"),
    panel: qs("#panel"),
    cards: qs("#cards"),
    canvas: qs("#canvas"),
    canvasScroll: qs("#canvas-scroll"),
    canvasMeta: qs("#canvas-meta"),
    atsOut: qs("#ats-out"),
    zoomSelect: qs("#zoom-select"),
    zoomIn: qs("#zoom-in"),
    zoomOut: qs("#zoom-out"),
    dockLeft: qs("#dock-left"),
    dockRight: qs("#dock-right"),
    dockLeftToggle: qs("#dock-left-toggle"),
    dockRightToggle: qs("#dock-right-toggle"),
    dockLeftCount: qs("#dock-left-count"),
    dockRightTitle: qs("#dock-right-title"),
    dockTabs: qs("#dock-tabs"),
    docNameBtn: qs("#doc-name-btn"),
    docNameText: qs("#doc-name-text"),
    saveState: qs("#save-state"),
    undoBtn: qs("#undo-btn"),
    redoBtn: qs("#redo-btn"),
    importBtn: qs("#import-btn"),
    exportBtn: qs("#export-btn"),
    themeBtn: qs("#theme-btn"),
    paletteBtn: qs("#palette-btn"),
    fileInput: qs("#file-input"),
    dropVeil: qs("#drop-veil"),
    collapseAllBtn: qs("#collapse-all-btn"),
  });
}

function paintIcons() {
  el.undoBtn.appendChild(icon("undo", 15));
  el.redoBtn.appendChild(icon("restore", 15));
  el.collapseAllBtn.appendChild(icon("fold", 14));
  el.zoomIn.appendChild(icon("plus", 14));
  el.zoomOut.appendChild(icon("minus", 14));
}

/* rendering */

function renderAll() {
  cards.render();
  preview.render();
  panels.render();
  paintChrome();
}

function paintChrome() {
  const doc = store.doc;
  el.docNameText.textContent = doc.name;
  el.undoBtn.disabled = !store.canUndo;
  el.redoBtn.disabled = !store.canRedo;

  const visible = doc.sections.filter((s) => s.visible).length;
  const hidden = doc.sections.length - visible;
  el.dockLeftCount.textContent = hidden ? `${visible} on, ${hidden} off` : plural(visible, "section");

  const labels = { saving: "Saving", saved: "Saved", error: "Save failed", quota: "Storage full", idle: "" };
  el.saveState.textContent = labels[store.saveState] ?? "";
  el.saveState.style.color = store.saveState === "quota" || store.saveState === "error" ? "var(--bad)" : "";
}

function onStoreChange(event) {
  switch (event.reason) {
    case "edit":
      cards.refreshHeaders(event.changed);
      preview.render();
      panels.invalidate();
      paintChrome();
      break;
    case "ui":
    case "zoom":
    case "view":
    // collapsing a dock changes how much room the page has, so fit has to be recomputed
    case "panel":
      preview.render();
      break;
    case "group":
      break;
    case "theme":
      applyTheme();
      panels.render();
      break;
    case "save-state":
      paintChrome();
      break;
    case "save-failed":
      reportSaveFailure(event.error);
      break;
    case "doc-quiet":
      break;
    case "version":
    case "replace":
    case "history":
      renderAll();
      panels.invalidate();
      break;
    default:
      cards.render();
      preview.render();
      panels.invalidate();
      if (store.ui.panel === "sections") panels.render();
      paintChrome();
  }
}

let saveFailureShown = false;
function reportSaveFailure(error) {
  if (saveFailureShown) return;
  saveFailureShown = true;
  toast({
    tone: "bad",
    title: store.saveState === "quota" ? "Local storage is full" : "Could not save",
    message: store.saveState === "quota"
      ? "Delete an old version, or export this one before making more changes."
      : (error?.message || "Your browser blocked local storage. Editing still works, but nothing will be kept."),
    duration: 0,
  });
}

/* top bar */

function wireTopbar() {
  el.docNameBtn.addEventListener("click", async () => {
    const name = await promptDialog({
      title: "Rename this version",
      label: "Name",
      value: store.doc.name,
      placeholder: "Google resume",
    });
    if (name) store.renameVersion(store.doc.id, name);
  });

  el.undoBtn.addEventListener("click", doUndo);
  el.redoBtn.addEventListener("click", doRedo);
  el.importBtn.addEventListener("click", () => el.fileInput.click());
  el.exportBtn.addEventListener("click", (event) => openExportMenu(event.currentTarget));
  el.paletteBtn.addEventListener("click", () => openPalette(buildCommands));

  el.themeBtn.addEventListener("click", (event) => {
    openMenu(event.currentTarget, [
      { heading: "Appearance" },
      { label: "Match system", icon: icon("monitor", 15), checked: store.ui.theme === "system", onClick: () => store.setUi({ theme: "system" }, { reason: "theme" }) },
      { label: "Light", icon: icon("sun", 15), checked: store.ui.theme === "light", onClick: () => store.setUi({ theme: "light" }, { reason: "theme" }) },
      { label: "Dark", icon: icon("moon", 15), checked: store.ui.theme === "dark", onClick: () => store.setUi({ theme: "dark" }, { reason: "theme" }) },
    ]);
  });
}

function applyTheme() {
  const preference = store.ui.theme || "system";
  const dark = preference === "dark"
    || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  clear(el.themeBtn);
  el.themeBtn.appendChild(icon(preference === "system" ? "monitor" : dark ? "moon" : "sun", 16));
  el.themeBtn.title = `Appearance: ${preference}`;
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if ((store.ui.theme || "system") === "system") applyTheme();
});

/* docks */

const isNarrow = () => window.matchMedia("(max-width: 760px)").matches;

function wireDocks() {
  el.dockLeftToggle.addEventListener("click", () => toggleDock("left"));
  el.dockRightToggle.addEventListener("click", () => toggleDock("right"));

  for (const tool of TOOL_PANELS) {
    el.dockTabs.appendChild(h("button", {
      class: "dock-tab",
      role: "tab",
      "data-panel": tool.id,
      "aria-selected": "false",
      title: tool.blurb,
      onclick: () => {
        store.setUi({ panel: tool.id, rightOpen: true }, { reason: "panel" });
        applyUi();
        panels.render();
      },
    }, icon(tool.icon, 15), h("span", null, tool.label)));
  }

  el.collapseAllBtn.addEventListener("click", () => {
    const anyOpen = store.doc.sections.some((section) => !section.collapsed);
    store.touch((doc) => {
      for (const section of doc.sections) section.collapsed = anyOpen;
    });
    cards.render();
    announce(anyOpen ? "All cards collapsed" : "All cards expanded");
  });
}

function toggleDock(side) {
  const key = side === "left" ? "leftOpen" : "rightOpen";
  const other = side === "left" ? "rightOpen" : "leftOpen";
  const next = { [key]: !store.ui[key] };
  // a phone has no room for both docks over the page at once
  if (next[key] && isNarrow()) next[other] = false;
  store.setUi(next, { reason: "panel" });
  applyUi();
  if (next[key] && side === "right") panels.render();
}

function applyUi() {
  const leftOpen = store.ui.leftOpen !== false;
  const rightOpen = store.ui.rightOpen !== false;

  el.dockLeft.dataset.collapsed = String(!leftOpen);
  el.dockRight.dataset.collapsed = String(!rightOpen);
  el.dockLeftToggle.setAttribute("aria-expanded", String(leftOpen));
  el.dockRightToggle.setAttribute("aria-expanded", String(rightOpen));
  el.dockLeftToggle.title = leftOpen ? "Collapse sections" : "Expand sections";
  el.dockRightToggle.title = rightOpen ? "Collapse tools" : "Expand tools";

  const active = TOOL_PANELS.find((tool) => tool.id === store.ui.panel) || TOOL_PANELS[0];
  el.dockRightTitle.textContent = active.label;
  for (const tab of qsa(".dock-tab", el.dockTabs)) {
    tab.setAttribute("aria-selected", String(tab.dataset.panel === active.id));
  }

  for (const button of qsa("#viewbar .seg-btn")) {
    button.classList.toggle("is-on", button.dataset.view === (store.ui.view || "paper"));
  }
}

/* files */

function wireFiles() {
  el.fileInput.addEventListener("change", async () => {
    const files = Array.from(el.fileInput.files || []);
    el.fileInput.value = "";
    for (const file of files) await runImport(file);
  });

  let depth = 0;
  const isFileDrag = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");

  window.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event)) return;
    depth += 1;
    el.dropVeil.hidden = false;
  });
  window.addEventListener("dragover", (event) => {
    if (isFileDrag(event)) event.preventDefault();
  });
  window.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) el.dropVeil.hidden = true;
  });
  window.addEventListener("drop", async (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depth = 0;
    el.dropVeil.hidden = true;

    const files = Array.from(event.dataTransfer.files);
    const accepted = files.filter(isAcceptedFile);
    const rejected = files.filter((file) => !isAcceptedFile(file));

    if (rejected.length) {
      toast({
        tone: "warn",
        title: `Skipped ${plural(rejected.length, "file")}`,
        message: `Supported formats are ${ACCEPTED_EXTENSIONS.join(", ")}.`,
      });
    }
    for (const file of accepted) await runImport(file);
  });
}

async function runImport(file) {
  const progress = progressToast(`Importing ${file.name}`);
  let result;

  try {
    result = await importFile(file, (fraction, label) => progress.update(`${label}, ${Math.round(fraction * 100)}%`));
  } catch (error) {
    progress.done({ tone: "bad", title: "Import failed", message: error.message, duration: 11000 });
    return;
  }

  progress.done();

  const current = store.doc;
  const currentHasContent = current.sections.some((section) => !isSectionEmpty(section));

  let mode = "replace";
  if (currentHasContent) {
    mode = await openDialog({
      title: "Where should this go?",
      description: `"${file.name}" parsed into ${plural(result.doc.sections.length, "section")}.`,
      width: 460,
      actions: [
        { label: "Cancel", variant: "btn-ghost", value: null },
        { label: "New version", variant: "btn-ghost", value: "version" },
        { label: "Replace current", variant: "btn-primary", value: "replace" },
      ],
      body: () => h("p", { class: "hint", style: { lineHeight: "1.55" } },
        `Replacing overwrites "${current.name}", and undo will bring it back. A new version keeps both side by side.`),
    });
    if (!mode) return;
  }

  if (mode === "version") {
    const created = store.createVersion(result.doc.name, result.doc);
    store.replaceDocument({ ...result.doc, id: created.id }, "Import resume");
  } else {
    store.replaceDocument(result.doc, "Import resume");
  }

  renderAll();
  reportImport(result, file);
}

function reportImport(result, file) {
  const errors = result.warnings.filter((warning) => warning.level === "error");
  const notices = result.warnings.filter((warning) => warning.level !== "error");

  if (errors.length) {
    toast({ tone: "bad", title: errors[0].title, message: errors[0].detail, duration: 14000 });
    return;
  }

  const fonts = result.doc.settings.fonts;
  const fontNote = fonts?.body ? ` Keeping ${fonts.body.label}.` : "";

  toast({
    tone: "good",
    title: `Imported ${file.name}`,
    message: `${plural(result.doc.sections.length, "section")} ready to edit.${fontNote}`,
    action: notices.length
      ? { label: `${notices.length} note${notices.length > 1 ? "s" : ""}`, onClick: () => showImportNotes(result.warnings) }
      : undefined,
  });
}

function showImportNotes(warnings) {
  openDialog({
    title: "Import notes",
    description: "Nothing was discarded. These are the places worth a second look.",
    width: 540,
    actions: [{ label: "Got it", variant: "btn-primary", value: true }],
    body: () => h("div", { style: { display: "grid", gap: "8px" } },
      ...warnings.map((warning) => h("div", {
        class: "tip",
        "data-tone": warning.level === "error" ? "bad" : warning.level === "warn" ? "warn" : "good",
      },
        h("div", { class: "tip-top" }, h("span", { class: "tip-kind" }, warning.title)),
        h("div", { class: "tip-text" }, warning.detail)))),
  });
}

/* export */

function openExportMenu(anchor) {
  const doc = store.doc;
  openMenu(anchor, [
    { heading: "Export" },
    ...EXPORT_FORMATS.map((format) => ({
      label: format.label,
      icon: icon(format.id === "pdf" ? "file" : "download", 15),
      hint: format.blurb,
      onClick: () => runExport(format.id),
    })),
    { separator: true },
    {
      label: "Copy as plain text",
      icon: icon("copy", 15),
      onClick: async () => {
        const { toPlainText } = await import("./export/serialize.js");
        try {
          await navigator.clipboard.writeText(toPlainText(doc, { width: 96 }));
          toast({ tone: "good", title: "Copied", message: "Plain text is on your clipboard." });
        } catch {
          toast({ tone: "warn", title: "Clipboard blocked", message: "Use the plain text export instead." });
        }
      },
    },
  ]);
}

async function runExport(format) {
  const doc = store.doc;
  if (!doc.sections.some((section) => section.visible && !isSectionEmpty(section))) {
    toast({ tone: "warn", title: "Nothing to export", message: "Add some content first." });
    return;
  }

  try {
    const result = await exportDocument(doc, format);
    if (result.kind === "print") {
      toast({
        tone: "info",
        title: "Print dialog open",
        message: `Choose "Save as PDF" and turn off headers and footers for a clean ${result.pages}-page file.`,
        duration: 9000,
      });
    } else {
      toast({ tone: "good", title: "Exported", message: exportFileName(doc, format === "md" ? "md" : format) });
    }
  } catch (error) {
    toast({ tone: "bad", title: "Export failed", message: error.message, duration: 11000 });
  }
}

/* actions and commands */

function focusSection(id) {
  if (store.ui.leftOpen === false) {
    store.setUi({ leftOpen: true, rightOpen: isNarrow() ? false : store.ui.rightOpen }, { reason: "panel" });
    applyUi();
  }
  cards.focusSection(id);
}

function applySuggestion(action) {
  const doc = store.doc;
  switch (action.type) {
    case "move": {
      const targetIndex = doc.sections.findIndex((s) => s.id === action.beforeId);
      if (targetIndex === -1) return;
      store.moveSection(action.sectionId, targetIndex);
      toast({ title: "Moved", message: "Undo if that is not what you wanted.", action: { label: "Undo", onClick: doUndo } });
      break;
    }
    case "show":
      store.commit("Show section", (d) => {
        const target = d.sections.find((s) => s.id === action.sectionId);
        if (target) target.visible = true;
      });
      break;
    case "hide-empty":
      store.commit("Hide empty sections", (d) => {
        for (const section of d.sections) {
          if (section.type !== "contact" && section.visible && isSectionEmpty(section)) section.visible = false;
        }
      });
      break;
    case "focus":
      focusSection(action.sectionId);
      break;
    case "focus-skills": {
      const skills = doc.sections.find((s) => s.type === "skills");
      if (skills) focusSection(skills.id);
      else toast({ title: "No skills section yet", message: "Add one from the Library tab." });
      break;
    }
  }
}

function buildCommands() {
  const doc = store.doc;
  const commands = [
    { id: "import", title: "Import a resume", subtitle: "PDF, Word, LaTeX, Markdown or text", group: "Actions", icon: "download", keys: ["Ctrl O"], run: () => el.fileInput.click() },
    ...EXPORT_FORMATS.map((format) => ({
      id: `export-${format.id}`,
      title: `Export as ${format.label}`,
      subtitle: format.blurb,
      group: "Actions",
      icon: "file",
      run: () => runExport(format.id),
    })),
    { id: "undo", title: "Undo", group: "Actions", icon: "undo", keys: ["Ctrl Z"], run: doUndo },
    { id: "redo", title: "Redo", group: "Actions", icon: "restore", keys: ["Ctrl Shift Z"], run: doRedo },
    { id: "toggle-left", title: "Toggle the sections panel", group: "Actions", icon: "fold", keys: ["Ctrl Shift \\"], run: () => toggleDock("left") },
    { id: "toggle-right", title: "Toggle the tools panel", group: "Actions", icon: "fold", keys: ["Ctrl \\"], run: () => toggleDock("right") },
  ];

  for (const tool of TOOL_PANELS) {
    commands.push({
      id: `panel-${tool.id}`,
      title: `Open ${tool.label}`,
      subtitle: tool.blurb,
      group: "Panels",
      icon: tool.icon,
      run: () => {
        store.setUi({ panel: tool.id, rightOpen: true }, { reason: "panel" });
        applyUi();
        panels.render();
      },
    });
  }

  for (const template of TEMPLATES) {
    commands.push({
      id: `template-${template.id}`,
      title: `Layout: ${template.name}`,
      subtitle: template.blurb,
      group: "Layouts",
      icon: "layers",
      run: () => store.commit("Change layout", (d) => { d.template = template.id; }),
    });
  }

  for (const section of doc.sections) {
    commands.push({
      id: `jump-${section.id}`,
      title: section.title,
      subtitle: `${typeInfo(section.type).label}${section.visible ? "" : ", hidden"}`,
      group: "Sections",
      icon: "pin",
      run: () => focusSection(section.id),
    });
  }

  for (const version of store.versions) {
    if (version.id === store.activeId) continue;
    commands.push({
      id: `version-${version.id}`,
      title: `Switch to ${version.name}`,
      group: "Versions",
      icon: "copy",
      run: () => store.switchVersion(version.id),
    });
  }

  return commands;
}

function doUndo() {
  if (store.undo()) announce("Undone");
  else toast({ title: "Nothing to undo", duration: 1800, key: "history" });
}

function doRedo() {
  if (store.redo()) announce("Redone");
  else toast({ title: "Nothing to redo", duration: 1800, key: "history" });
}

/* shortcuts */

function wireShortcuts() {
  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const target = event.target;
    const typing = target.matches?.("input, textarea, [contenteditable='true'], [contenteditable='plaintext-only']");

    if (mod && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette(buildCommands);
      return;
    }

    if (event.key === "Escape") {
      if (isPaletteOpen()) { closePalette(); return; }
      if (hasOverlay()) { closeTopOverlay(); return; }
      if (typing) { target.blur(); return; }
      cards.clearSelection();
      return;
    }

    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      doRedo();
      return;
    }
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      openExportMenu(el.exportBtn);
      return;
    }
    if (mod && event.key.toLowerCase() === "o") {
      event.preventDefault();
      el.fileInput.click();
      return;
    }
    if (mod && event.key === "\\") {
      event.preventDefault();
      toggleDock(event.shiftKey ? "left" : "right");
      return;
    }
    if (mod && (event.key === "=" || event.key === "+")) {
      event.preventDefault();
      preview.stepZoom(1);
      return;
    }
    if (mod && event.key === "-") {
      event.preventDefault();
      preview.stepZoom(-1);
      return;
    }
    if (mod && event.key === "0") {
      event.preventDefault();
      store.setUi({ zoom: 1 }, { reason: "zoom" });
      return;
    }

    if (typing) return;

    if (event.key === "?") {
      event.preventDefault();
      store.setUi({ panel: "help", rightOpen: true }, { reason: "panel" });
      applyUi();
      panels.render();
      return;
    }
    if (mod && event.key.toLowerCase() === "d") {
      const card = document.activeElement?.closest?.(".card");
      if (!card) return;
      event.preventDefault();
      const section = store.section(card.dataset.id);
      if (section && section.type !== "contact") cards.duplicate(section);
    }
  });
}

/* first run */

function welcome() {
  openDialog({
    title: "Resume Composer",
    description: "Turn a finished resume back into parts you can rearrange.",
    width: 480,
    actions: [
      { label: "Start blank", variant: "btn-ghost", value: "blank" },
      { label: "Import a resume", variant: "btn-primary", value: "import" },
    ],
    body: () => h("div", { style: { display: "grid", gap: "9px" } },
      ...[
        "Every section becomes a card you can reorder, hide, duplicate, merge or split.",
        "The page in the middle is exactly what exports: same font, same page breaks, same spacing.",
        "Paste a job description under Optimize to see which of its terms your resume already covers.",
        "Nothing leaves your browser. There is no account and no upload.",
      ].map((line) => h("p", { class: "hint", style: { lineHeight: "1.55" } }, line))),
  }).then((choice) => {
    if (choice === "import") el.fileInput.click();
  });
}

function startBlank() {
  store.replaceDocument(blankDocument(store.doc.name), "Start blank");
  renderAll();
}

/* resilience */

window.addEventListener("beforeunload", () => {
  store.persist.flush?.();
});

window.addEventListener("error", (event) => {
  console.error(event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  toast({
    tone: "bad",
    title: "Something went wrong",
    message: String(event.reason?.message || event.reason || "Unknown error").slice(0, 180),
  });
});

window.addEventListener("resize", debounce(() => preview?.render(), 160));

try {
  boot();
} catch (error) {
  console.error(error);
  const bootEl = document.getElementById("boot");
  if (bootEl) {
    clear(bootEl);
    bootEl.appendChild(h("div", { class: "boot-inner" },
      h("p", { class: "boot-error" }, "Resume Composer could not start."),
      h("p", null, String(error.message || error))));
  }
}
