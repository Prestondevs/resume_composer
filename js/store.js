import { deepClone, debounce, uid } from "./lib/util.js";
import { normalizeDocument, blankDocument, createSection } from "./schema.js";

const STORAGE_KEY = "resume-composer/v1";
const HISTORY_LIMIT = 120;
const COALESCE_MS = 650;

// one document is active at a time; the rest sit in `versions`. History is a stack of
// whole-document snapshots. Resumes are small enough (tens of KB) that snapshotting beats
// maintaining inverse operations for every mutation, and it makes undo correct by construction
// across merges, splits and imports

const defaultUi = {
  theme: "system",
  panel: "sections",
  leftOpen: true,
  rightOpen: true,
  leftWidth: 322,
  rightWidth: 322,
  zoom: "fit",
  view: "paper",
  // open state of the collapsible groups inside the tool panels, keyed by group id
  groups: {},
};

class Store {
  constructor() {
    this.versions = [];
    this.activeId = null;
    this.ui = { ...defaultUi };
    this.past = [];
    this.future = [];
    this.listeners = new Set();
    this.lastCommit = { key: null, at: 0 };
    this.saveState = "idle";
    // what the caret is in on the page. transient, never persisted, never in the document
    this.selection = null;
    this.storageAvailable = true;

    this.persist = debounce(() => this.saveNow(), 450);
  }

  // lifecycle

  load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      this.storageAvailable = false;
    }

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        this.versions = (parsed.versions || []).map(normalizeDocument);
        this.ui = { ...defaultUi, ...(parsed.ui || {}) };
        this.activeId = this.versions.some((v) => v.id === parsed.activeId)
          ? parsed.activeId
          : this.versions[0]?.id || null;
      } catch {
        // a corrupt payload should not lock the user out; start clean but keep
        // the bad copy around so nothing is silently destroyed
        try { localStorage.setItem(`${STORAGE_KEY}/recovered-${Date.now()}`, raw); } catch { /* full */ }
        this.versions = [];
      }
    }

    if (!this.versions.length) {
      const doc = blankDocument("My resume");
      this.versions = [doc];
      this.activeId = doc.id;
      this.isFirstRun = true;
    }
    return this;
  }

  saveNow() {
    if (!this.storageAvailable) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        activeId: this.activeId,
        ui: this.ui,
        versions: this.versions,
      }));
      this.setSaveState("saved");
    } catch (error) {
      const isQuota = error?.name === "QuotaExceededError" || error?.code === 22;
      this.setSaveState(isQuota ? "quota" : "error");
      this.storageAvailable = !isQuota;
      this.notify({ reason: "save-failed", error });
    }
  }

  setSaveState(state) {
    if (this.saveState === state) return;
    this.saveState = state;
    this.notify({ reason: "save-state" });
  }

  // subscriptions

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event = {}) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Store listener failed", error);
      }
    }
  }

  // document access

  get doc() {
    return this.versions.find((v) => v.id === this.activeId) || this.versions[0];
  }

  section(id) {
    return this.doc.sections.find((s) => s.id === id);
  }

  sectionIndex(id) {
    return this.doc.sections.findIndex((s) => s.id === id);
  }

  // applies `mutator` to a draft of the active document and records history. `coalesce` merges
  // rapid edits to the same target into one undo step so that typing does not produce one
  // history entry per keystroke
  commit(label, mutator, options = {}) {
    const doc = this.doc;
    const before = deepClone(doc);
    const result = mutator(doc);
    if (result === false) return false;

    doc.updatedAt = Date.now();

    const now = Date.now();
    const canCoalesce = options.coalesce
      && this.lastCommit.key === options.coalesce
      && now - this.lastCommit.at < COALESCE_MS
      && this.past.length > 0;

    if (!canCoalesce) {
      this.past.push(before);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.lastCommit = { key: options.coalesce || null, at: now };
    this.future.length = 0;

    this.setSaveState("saving");
    this.persist();
    this.notify({ reason: options.reason || "doc", label, changed: options.changed, silent: options.silent });
    return true;
  }

  // state that should persist but never occupy an undo slot
  touch(mutator, options = {}) {
    const result = mutator(this.doc);
    if (result === false) return false;
    this.persist();
    this.notify({ reason: options.reason || "doc-quiet", changed: options.changed });
    return true;
  }

  // the inspector listens for this; it is deliberately not part of the document so selecting
  // something never lands in undo
  setSelection(selection) {
    const same = JSON.stringify(selection) === JSON.stringify(this.selection);
    this.selection = selection;
    if (!same) this.notify({ reason: "selection" });
  }

  setUi(patch, options = {}) {
    Object.assign(this.ui, patch);
    this.persist();
    this.notify({ reason: options.reason || "ui", keys: Object.keys(patch) });
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  undo() {
    if (!this.past.length) return false;
    const index = this.versions.findIndex((v) => v.id === this.activeId);
    this.future.push(deepClone(this.versions[index]));
    this.versions[index] = this.past.pop();
    this.activeId = this.versions[index].id;
    this.lastCommit = { key: null, at: 0 };
    this.persist();
    this.notify({ reason: "history" });
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    const index = this.versions.findIndex((v) => v.id === this.activeId);
    this.past.push(deepClone(this.versions[index]));
    this.versions[index] = this.future.pop();
    this.activeId = this.versions[index].id;
    this.lastCommit = { key: null, at: 0 };
    this.persist();
    this.notify({ reason: "history" });
    return true;
  }

  // versions

  createVersion(name, source) {
    const doc = source ? deepClone(source) : blankDocument(name);
    doc.id = uid("doc");
    doc.name = name || doc.name;
    doc.createdAt = Date.now();
    doc.updatedAt = Date.now();
    if (source) {
      // fresh identifiers keep cross-version drag state and DOM keys distinct
      doc.sections = doc.sections.map((section) => ({
        ...section,
        id: uid("s"),
        items: (section.items || []).map((item) => ({ ...item, id: uid("i") })),
      }));
    }
    this.versions.push(doc);
    this.switchVersion(doc.id);
    return doc;
  }

  switchVersion(id) {
    if (!this.versions.some((v) => v.id === id) || id === this.activeId) return false;
    this.activeId = id;
    this.past.length = 0;
    this.future.length = 0;
    this.persist();
    this.notify({ reason: "version" });
    return true;
  }

  renameVersion(id, name) {
    const doc = this.versions.find((v) => v.id === id);
    if (!doc) return false;
    doc.name = name.trim().slice(0, 120) || doc.name;
    doc.updatedAt = Date.now();
    this.persist();
    this.notify({ reason: "version" });
    return true;
  }

  deleteVersion(id) {
    if (this.versions.length <= 1) return false;
    const index = this.versions.findIndex((v) => v.id === id);
    if (index === -1) return false;
    const [removed] = this.versions.splice(index, 1);
    if (this.activeId === id) {
      this.activeId = this.versions[Math.max(0, index - 1)].id;
      this.past.length = 0;
      this.future.length = 0;
    }
    this.persist();
    this.notify({ reason: "version" });
    return removed;
  }

  // replaces the active document wholesale. Used by the importers
  replaceDocument(next, label = "Import resume") {
    const index = this.versions.findIndex((v) => v.id === this.activeId);
    const before = deepClone(this.versions[index]);
    const doc = normalizeDocument(next);
    doc.id = this.activeId;
    this.versions[index] = doc;
    this.past.push(before);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
    this.lastCommit = { key: null, at: 0 };
    this.persist();
    this.notify({ reason: "replace", label });
    return doc;
  }

  // section helpers used across the UI

  addSection(type, options = {}) {
    const section = createSection(type, { collapsed: false, ...options.patch });
    this.commit(`Add ${section.title}`, (doc) => {
      const at = options.index != null ? options.index : doc.sections.length;
      doc.sections.splice(Math.max(1, at), 0, section);
    });
    return section;
  }

  removeSection(id) {
    const section = this.section(id);
    if (!section || section.type === "contact") return null;
    this.commit(`Delete ${section.title}`, (doc) => {
      const index = doc.sections.findIndex((s) => s.id === id);
      if (index === -1) return false;
      const [removed] = doc.sections.splice(index, 1);
      doc.trash.unshift(removed);
      doc.trash.length = Math.min(doc.trash.length, 30);
    });
    return section;
  }

  restoreFromTrash(id) {
    return this.commit("Restore section", (doc) => {
      const index = doc.trash.findIndex((s) => s.id === id);
      if (index === -1) return false;
      const [section] = doc.trash.splice(index, 1);
      section.visible = true;
      doc.sections.push(section);
    });
  }

  moveSection(id, toIndex) {
    return this.commit("Reorder sections", (doc) => {
      const from = doc.sections.findIndex((s) => s.id === id);
      if (from === -1) return false;
      const target = Math.max(1, Math.min(doc.sections.length - 1, toIndex));
      if (from === target) return false;
      const [section] = doc.sections.splice(from, 1);
      doc.sections.splice(target, 0, section);
    });
  }

  // moves several sections at once, preserving their relative order
  moveSections(ids, toIndex) {
    return this.commit("Reorder sections", (doc) => {
      const moving = doc.sections.filter((s) => ids.includes(s.id) && s.type !== "contact");
      if (!moving.length) return false;
      const anchor = doc.sections[toIndex];
      const rest = doc.sections.filter((s) => !moving.includes(s));
      let target = anchor && !moving.includes(anchor) ? rest.indexOf(anchor) : rest.length;
      if (target < 1) target = 1;
      rest.splice(target, 0, ...moving);
      doc.sections = rest;
    });
  }
}

export const store = new Store();
