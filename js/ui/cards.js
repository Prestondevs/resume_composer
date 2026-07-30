import { h, clear, icon, qs, announce } from "../lib/dom.js";
import { uid, plural } from "../lib/util.js";
import { store } from "../store.js";
import { SECTION_TYPES, typeInfo, createItem, createSection, sectionCount, isSectionEmpty, convertLayout, LAYOUTS } from "../schema.js";
import { SortableList } from "./dnd.js";
import { openMenu, confirmDialog } from "./overlay.js";
import { toast } from "./toasts.js";

// the composer list
// collapsed cards render their header only, so a resume with fifty sections still mounts a
// small tree; bodies are built on expand and torn down on collapse. Text edits commit with a
// coalesce key and never trigger a re-render of the list, which is what keeps focus and caret
// position stable while typing

export class CardsView {
  constructor(root, { onFocusSection } = {}) {
    this.root = root;
    this.onFocusSection = onFocusSection;
    this.selection = new Set();
    this.nested = [];

    this.sortable = new SortableList({
      container: root,
      item: ".card",
      handle: ".drag-grip",
      pinFirst: true,
      canDrag: (id) => {
        const section = store.section(id);
        return Boolean(section) && section.type !== "contact" && !section.locked;
      },
      getSelection: () => Array.from(this.selection),
      onReorder: (ids, index) => {
        if (ids.length > 1) store.moveSections(ids, index);
        else store.moveSection(ids[0], index);
      },
    });

    root.addEventListener("click", (event) => {
      const card = event.target.closest(".card");
      if (!card || event.target.closest("button, input, textarea, [contenteditable]")) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        this.toggleSelection(card.dataset.id, event.shiftKey);
      } else if (this.selection.size) {
        this.clearSelection();
      }
    });
  }

  clearSelection() {
    this.selection.clear();
    for (const el of this.root.querySelectorAll(".card.is-multi")) el.classList.remove("is-multi");
  }

  toggleSelection(id, range) {
    const section = store.section(id);
    if (!section || section.type === "contact") return;

    if (range && this.selection.size) {
      const order = store.doc.sections.map((s) => s.id);
      const last = Array.from(this.selection).pop();
      const [from, to] = [order.indexOf(last), order.indexOf(id)].sort((a, b) => a - b);
      for (let i = from; i <= to; i += 1) {
        if (store.doc.sections[i].type !== "contact") this.selection.add(order[i]);
      }
    } else if (this.selection.has(id)) {
      this.selection.delete(id);
    } else {
      this.selection.add(id);
    }

    for (const el of this.root.querySelectorAll(".card")) {
      el.classList.toggle("is-multi", this.selection.has(el.dataset.id));
    }
    announce(this.selection.size ? `${plural(this.selection.size, "section")} selected` : "Selection cleared");
  }

  // header-only refresh for edits that cannot change structure
  refreshHeaders(ids) {
    for (const id of ids || []) {
      const card = this.root.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
      const section = store.section(id);
      if (!card || !section) continue;
      const count = qs(".card-count", card);
      if (count) count.textContent = countLabel(section);
      card.classList.toggle("is-hidden", !section.visible);
    }
  }

  render() {
    for (const list of this.nested) list.destroy();
    this.nested = [];

    const doc = store.doc;
    const scrollTop = this.root.scrollTop;
    clear(this.root);

    for (const section of doc.sections) {
      this.root.appendChild(this.buildCard(section));
    }

    if (doc.trash.length) {
      this.root.appendChild(this.buildTrashRow(doc.trash));
    }

    this.root.scrollTop = scrollTop;
    for (const id of this.selection) {
      if (!doc.sections.some((s) => s.id === id)) this.selection.delete(id);
    }
  }

  buildTrashRow(trash) {
    return h("button", {
      class: "empty-note",
      style: { width: "100%", marginTop: "10px", cursor: "pointer" },
      onclick: (event) => openMenu(event.currentTarget, [
        { heading: "Recently deleted" },
        ...trash.map((section) => ({
          label: section.title,
          icon: icon("restore", 15),
          hint: typeInfo(section.type).label,
          onClick: () => {
            store.restoreFromTrash(section.id);
            toast({ title: "Restored", message: section.title, tone: "good" });
          },
        })),
      ], { align: "start" }),
    }, `${plural(trash.length, "deleted section")} · click to restore`);
  }

  buildCard(section) {
    const info = typeInfo(section.type);
    const isContact = section.type === "contact";
    const open = !section.collapsed;

    const card = h("div", {
      class: ["card", open && "is-open", !section.visible && "is-hidden", section.locked && "is-locked", this.selection.has(section.id) && "is-multi"],
      "data-id": section.id,
      role: "listitem",
    });

    const grip = h("button", {
      class: "drag-grip",
      "aria-label": `Reorder ${section.title}`,
      title: isContact ? "Contact stays at the top" : "Drag to reorder, or press space",
      disabled: isContact || section.locked,
      tabindex: isContact || section.locked ? -1 : 0,
    }, icon("grip", 15));

    const toggle = h("button", {
      class: "card-toggle",
      "aria-expanded": String(open),
      "aria-label": `${open ? "Collapse" : "Expand"} ${section.title}`,
      onclick: () => this.setCollapsed(section, !section.collapsed),
    }, icon("chevronRight", 14));

    const name = h("div", {
      class: "card-name",
      contenteditable: "plaintext-only",
      spellcheck: "false",
      role: "textbox",
      "aria-label": "Section heading",
      onblur: (event) => {
        const value = event.target.textContent.trim();
        if (value === section.title) return;
        if (!value) { event.target.textContent = section.title; return; }
        store.commit("Rename section", (doc) => {
          const target = doc.sections.find((s) => s.id === section.id);
          if (target) target.title = value.slice(0, 90);
        }, { reason: "edit", changed: [section.id] });
      },
      onkeydown: (event) => {
        if (event.key === "Enter") { event.preventDefault(); event.target.blur(); }
        if (event.key === "Escape") { event.target.textContent = section.title; event.target.blur(); }
      },
    }, section.title);

    const flags = [];
    if (section.confidence < 0.7) {
      flags.push(h("span", {
        class: "card-flag is-warn",
        title: section.note || "This section was hard to read during import. Check it.",
      }, icon("warn", 13)));
    }
    if (section.locked) flags.push(h("span", { class: "card-flag", title: "Locked" }, icon("lock", 13)));

    const head = h("div", { class: "card-head" },
      grip,
      toggle,
      h("div", { class: "card-title" }, name, h("span", { class: "card-count" }, countLabel(section)), ...flags),
      h("div", { class: "card-acts" },
        h("button", {
          class: `icon-btn sm${section.visible ? "" : " is-on"}`,
          "aria-label": section.visible ? `Hide ${section.title}` : `Show ${section.title}`,
          title: section.visible ? "Hide from resume" : "Show in resume",
          disabled: isContact,
          onclick: () => this.toggleVisible(section),
        }, icon(section.visible ? "eye" : "eyeOff", 15)),
        h("button", {
          class: "icon-btn sm",
          "aria-label": `More actions for ${section.title}`,
          onclick: (event) => this.openCardMenu(event.currentTarget, section),
        }, icon("more", 15))),
    );

    card.appendChild(head);
    if (open) card.appendChild(this.buildBody(section));
    return card;
  }

  setCollapsed(section, collapsed) {
    store.touch((doc) => {
      const target = doc.sections.find((s) => s.id === section.id);
      if (target) target.collapsed = collapsed;
    });
    const card = this.root.querySelector(`.card[data-id="${CSS.escape(section.id)}"]`);
    if (!card) return;

    card.classList.toggle("is-open", !collapsed);
    qs(".card-toggle", card)?.setAttribute("aria-expanded", String(!collapsed));
    const existing = qs(".card-body", card);
    if (collapsed) existing?.remove();
    else if (!existing) card.appendChild(this.buildBody(section));
  }

  toggleVisible(section) {
    store.commit(section.visible ? `Hide ${section.title}` : `Show ${section.title}`, (doc) => {
      const target = doc.sections.find((s) => s.id === section.id);
      if (target) target.visible = !target.visible;
    });
  }

  openCardMenu(anchor, section) {
    const doc = store.doc;
    const index = doc.sections.findIndex((s) => s.id === section.id);
    const isContact = section.type === "contact";
    const neighbours = doc.sections.filter((s) => s.id !== section.id && s.type !== "contact" && s.layout === section.layout);

    openMenu(anchor, [
      {
        label: "Duplicate",
        icon: icon("copy", 15),
        hint: "Ctrl D",
        disabled: isContact,
        onClick: () => this.duplicate(section),
      },
      {
        label: section.locked ? "Unlock" : "Lock",
        icon: icon(section.locked ? "unlock" : "lock", 15),
        onClick: () => store.commit(section.locked ? "Unlock" : "Lock", (d) => {
          const target = d.sections.find((s) => s.id === section.id);
          if (target) target.locked = !target.locked;
        }),
      },
      { separator: true },
      {
        label: "Split into two cards",
        icon: icon("split", 15),
        disabled: isContact || sectionCount(section) < 2,
        onClick: () => this.split(section),
      },
      {
        label: "Merge into…",
        icon: icon("merge", 15),
        disabled: isContact || !neighbours.length,
        onClick: () => openMenu(anchor, [
          { heading: "Merge this card into" },
          ...neighbours.map((other) => ({
            label: other.title,
            onClick: () => this.merge(section, other),
          })),
        ]),
      },
      {
        label: "Change layout",
        icon: icon("layers", 15),
        disabled: isContact,
        onClick: () => openMenu(anchor, [
          { heading: "Content shape" },
          ...Object.keys(LAYOUTS).filter((layout) => layout !== "contact").map((layout) => ({
            label: LAYOUT_LABELS[layout],
            checked: section.layout === layout,
            onClick: () => this.convert(section, layout),
          })),
        ]),
      },
      { separator: true },
      {
        label: "Move to top",
        icon: icon("arrowUp", 15),
        disabled: isContact || index <= 1,
        onClick: () => store.moveSection(section.id, 1),
      },
      {
        label: "Move to bottom",
        icon: icon("arrowDown", 15),
        disabled: isContact || index === doc.sections.length - 1,
        onClick: () => store.moveSection(section.id, doc.sections.length - 1),
      },
      { separator: true },
      {
        label: "Delete",
        icon: icon("trash", 15),
        danger: true,
        disabled: isContact,
        onClick: () => this.remove(section),
      },
    ]);
  }

  duplicate(section) {
    const copy = JSON.parse(JSON.stringify(section));
    copy.id = uid("s");
    copy.title = `${section.title} copy`;
    copy.collapsed = false;
    copy.items = (copy.items || []).map((item) => ({ ...item, id: uid("i") }));
    copy.groups = (copy.groups || []).map((group) => ({ ...group, id: uid("g") }));
    store.commit(`Duplicate ${section.title}`, (doc) => {
      const index = doc.sections.findIndex((s) => s.id === section.id);
      doc.sections.splice(index + 1, 0, copy);
    });
  }

  split(section) {
    const count = sectionCount(section);
    const half = Math.ceil(count / 2);
    const field = LAYOUTS[section.layout].field;

    store.commit(`Split ${section.title}`, (doc) => {
      const target = doc.sections.find((s) => s.id === section.id);
      if (!target || !Array.isArray(target[field])) return false;
      const tail = target[field].splice(half);
      if (!tail.length) return false;
      const clone = createSection(target.type, {
        title: `${target.title} (continued)`,
        layout: target.layout,
        collapsed: false,
      });
      clone[field] = tail;
      const index = doc.sections.findIndex((s) => s.id === section.id);
      doc.sections.splice(index + 1, 0, clone);
    });
  }

  merge(section, other) {
    const field = LAYOUTS[section.layout].field;
    store.commit(`Merge into ${other.title}`, (doc) => {
      const source = doc.sections.find((s) => s.id === section.id);
      const target = doc.sections.find((s) => s.id === other.id);
      if (!source || !target) return false;

      if (field === "body") target.body = [target.body, source.body].filter(Boolean).join("\n\n");
      else target[field] = [...(target[field] || []), ...(source[field] || [])];

      target.collapsed = false;
      doc.sections = doc.sections.filter((s) => s.id !== section.id);
      doc.trash.unshift(source);
    });
    toast({ title: "Merged", message: `${section.title} moved into ${other.title}`, tone: "good" });
  }

  convert(section, layout) {
    store.commit("Change layout", (doc) => {
      const index = doc.sections.findIndex((s) => s.id === section.id);
      if (index === -1) return false;
      doc.sections[index] = convertLayout(doc.sections[index], layout);
      doc.sections[index].collapsed = false;
    });
  }

  async remove(section) {
    const populated = !isSectionEmpty(section);
    if (populated) {
      const ok = await confirmDialog({
        title: `Delete ${section.title}?`,
        description: "It moves to recently deleted, so you can put it back. Undo also works.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
    }
    store.removeSection(section.id);
    toast({
      title: "Section deleted",
      message: section.title,
      action: { label: "Undo", onClick: () => store.undo() },
    });
  }

  // bodies

  buildBody(section) {
    const body = h("div", { class: "card-body" });

    if (section.confidence < 0.7 && section.note) {
      body.appendChild(h("div", { class: "confidence-note" },
        icon("warn", 14),
        h("span", null, section.note, " ",
          h("button", {
            onclick: () => store.commit("Confirm section", (doc) => {
              const target = doc.sections.find((s) => s.id === section.id);
              if (target) { target.confidence = 1; target.note = ""; }
            }),
          }, "Looks right"))));
    }

    switch (section.layout) {
      case "contact": body.appendChild(this.buildContactEditor(section)); break;
      case "entries": body.appendChild(this.buildEntriesEditor(section)); break;
      case "bullets": body.appendChild(this.buildBulletsEditor(section)); break;
      case "inline": body.appendChild(this.buildGroupsEditor(section)); break;
      case "prose": body.appendChild(this.buildProseEditor(section)); break;
    }

    return body;
  }

  field(section, path, label, placeholder, extra = {}) {
    return h("label", { class: "mini-label" },
      h("span", null, label),
      h("input", {
        class: "mini-input",
        value: getPath(store.section(section.id), path) || "",
        placeholder,
        ...extra,
        oninput: (event) => {
          store.commit(`Edit ${label}`, (doc) => {
            const target = doc.sections.find((s) => s.id === section.id);
            if (target) setPath(target, path, event.target.value);
          }, { reason: "edit", changed: [section.id], coalesce: `${section.id}:${path}` });
        },
      }));
  }

  buildContactEditor(section) {
    const wrap = h("div", { style: { display: "grid", gap: "8px" } });
    wrap.appendChild(h("div", { class: "grid-2" },
      wrapWide(this.field(section, "contact.name", "Full name", "Alex Rivera")),
      wrapWide(this.field(section, "contact.headline", "Headline", "Computer Science student · Backend")),
      this.field(section, "contact.email", "Email", "alex@example.com", { type: "email", inputmode: "email" }),
      this.field(section, "contact.phone", "Phone", "+1 555 010 4477", { inputmode: "tel" }),
      wrapWide(this.field(section, "contact.location", "Location", "Austin, TX"))));

    const links = h("div", { style: { display: "grid", gap: "6px" } });
    const renderLinks = () => {
      clear(links);
      const current = store.section(section.id).contact.links || [];
      current.forEach((link, index) => {
        links.appendChild(h("div", { class: "skill-group" },
          h("input", {
            class: "mini-input",
            value: link.label,
            placeholder: "Label",
            oninput: (event) => this.editLink(section, index, "label", event.target.value),
          }),
          h("input", {
            class: "mini-input",
            value: link.url,
            placeholder: "github.com/you",
            oninput: (event) => this.editLink(section, index, "url", event.target.value),
          }),
          h("button", {
            class: "icon-btn sm",
            "aria-label": "Remove link",
            onclick: () => {
              store.commit("Remove link", (doc) => {
                doc.sections.find((s) => s.id === section.id).contact.links.splice(index, 1);
              });
              renderLinks();
            },
          }, icon("x", 14))));
      });
      links.appendChild(h("button", {
        class: "add-row",
        onclick: () => {
          store.commit("Add link", (doc) => {
            doc.sections.find((s) => s.id === section.id).contact.links.push({ label: "", url: "" });
          });
          renderLinks();
          links.querySelectorAll("input")[Math.max(0, (store.section(section.id).contact.links.length - 1) * 2)]?.focus();
        },
      }, icon("plus", 13), "Add link"));
    };
    renderLinks();

    wrap.append(h("span", { class: "label", style: { marginTop: "4px" } }, "Links"), links);
    return wrap;
  }

  editLink(section, index, key, value) {
    store.commit("Edit link", (doc) => {
      const link = doc.sections.find((s) => s.id === section.id).contact.links[index];
      if (link) link[key] = value;
    }, { reason: "edit", changed: [section.id], coalesce: `${section.id}:link:${index}:${key}` });
  }

  buildEntriesEditor(section) {
    const list = h("div", { style: { display: "grid", gap: "6px" } });

    for (const item of section.items || []) {
      list.appendChild(this.buildEntry(section, item));
    }

    list.appendChild(h("button", {
      class: "add-row",
      onclick: () => {
        const item = createItem({ bullets: [""] });
        store.commit("Add entry", (doc) => {
          doc.sections.find((s) => s.id === section.id).items.push(item);
        });
        this.rerenderBody(section.id);
        this.focusFirstInput(section.id, item.id);
      },
    }, icon("plus", 13), "Add entry"));

    this.attachNested(list, ".entry", (ids, index) => {
      store.commit("Reorder entries", (doc) => {
        const target = doc.sections.find((s) => s.id === section.id);
        const from = target.items.findIndex((item) => item.id === ids[0]);
        if (from === -1) return false;
        const [moved] = target.items.splice(from, 1);
        target.items.splice(Math.min(index, target.items.length), 0, moved);
      });
      this.rerenderBody(section.id);
    });

    return list;
  }

  buildEntry(section, item) {
    const open = item.open !== false;
    const label = [item.title, item.org].filter(Boolean).join(" · ") || "Untitled entry";
    const dates = [item.start, item.end].filter(Boolean).join(" - ");

    const entry = h("div", { class: `entry${open ? " is-open" : ""}`, "data-id": item.id },
      h("div", { class: "entry-head" },
        h("button", { class: "entry-grip", "aria-label": "Reorder entry", title: "Drag to reorder" }, icon("grip", 13)),
        h("button", {
          class: "entry-label",
          "aria-expanded": String(open),
          onclick: (event) => {
            const node = event.target.closest(".entry");
            node.classList.toggle("is-open");
            item.open = node.classList.contains("is-open");
          },
        },
          h("span", { class: "e-title" }, label),
          dates && h("span", { class: "e-sep" }, "·"),
          dates && h("span", null, dates)),
        h("div", { class: "entry-acts" },
          h("button", {
            class: "icon-btn sm",
            "aria-label": "Duplicate entry",
            onclick: () => {
              store.commit("Duplicate entry", (doc) => {
                const target = doc.sections.find((s) => s.id === section.id);
                const index = target.items.findIndex((i) => i.id === item.id);
                target.items.splice(index + 1, 0, { ...JSON.parse(JSON.stringify(item)), id: uid("i") });
              });
              this.rerenderBody(section.id);
            },
          }, icon("copy", 14)),
          h("button", {
            class: "icon-btn sm",
            "aria-label": "Delete entry",
            onclick: () => {
              store.commit("Delete entry", (doc) => {
                const target = doc.sections.find((s) => s.id === section.id);
                target.items = target.items.filter((i) => i.id !== item.id);
              });
              this.rerenderBody(section.id);
            },
          }, icon("trash", 14)))),
      h("div", { class: "entry-body" },
        h("div", { class: "grid-2" },
          wrapWide(this.itemField(section, item, "title", "Title or role", "Software Engineering Intern")),
          this.itemField(section, item, "org", "Organisation", "Acme Corp"),
          this.itemField(section, item, "location", "Location", "Austin, TX"),
          this.itemField(section, item, "start", "Start", "May 2025"),
          this.itemField(section, item, "end", "End", "Aug 2025"),
          wrapWide(this.itemField(section, item, "meta", "Detail line", "GPA 3.8 · Dean's List")),
          wrapWide(this.itemField(section, item, "link", "Link", "github.com/you/project"))),
        this.buildBulletList(section, item)),
    );

    return entry;
  }

  itemField(section, item, key, label, placeholder) {
    return h("label", { class: "mini-label" },
      h("span", null, label),
      h("input", {
        class: "mini-input",
        value: item[key] || "",
        placeholder,
        oninput: (event) => {
          store.commit(`Edit ${label}`, (doc) => {
            const target = doc.sections.find((s) => s.id === section.id);
            const entry = target?.items.find((i) => i.id === item.id);
            if (entry) entry[key] = event.target.value;
          }, { reason: "edit", changed: [section.id], coalesce: `${item.id}:${key}` });
          if (key === "title" || key === "org") this.refreshEntryLabel(section.id, item.id);
        },
      }));
  }

  refreshEntryLabel(sectionId, itemId) {
    const node = this.root.querySelector(`.entry[data-id="${CSS.escape(itemId)}"] .e-title`);
    const item = store.section(sectionId)?.items.find((i) => i.id === itemId);
    if (node && item) node.textContent = [item.title, item.org].filter(Boolean).join(" · ") || "Untitled entry";
  }

  buildBulletList(section, item) {
    const container = h("div", { class: "bullets" });

    const commitBullets = (mutate, options) => {
      store.commit("Edit bullets", (doc) => {
        const target = doc.sections.find((s) => s.id === section.id);
        const entry = item ? target?.items.find((i) => i.id === item.id) : target;
        if (!entry) return false;
        return mutate(entry);
      }, options);
    };

    const source = item ? item.bullets : section.bullets;

    source.forEach((text, index) => {
      container.appendChild(this.buildBulletRow(section, item, index, text, commitBullets));
    });

    container.appendChild(h("button", {
      class: "add-row",
      onclick: () => {
        commitBullets((entry) => { entry.bullets ? entry.bullets.push("") : entry.push(""); });
        this.rerenderBody(section.id);
        const rows = this.root.querySelectorAll(`.card[data-id="${CSS.escape(section.id)}"] .bullet-text`);
        rows[rows.length - 1]?.focus();
      },
    }, icon("plus", 13), "Add bullet"));

    return container;
  }

  buildBulletRow(section, item, index, text, commitBullets) {
    const editor = h("div", {
      class: "bullet-text",
      contenteditable: "plaintext-only",
      role: "textbox",
      "aria-label": `Bullet ${index + 1}`,
      "data-placeholder": "Describe what you did and what changed because of it",
      oninput: (event) => {
        const value = event.target.textContent;
        commitBullets((entry) => {
          const list = entry.bullets || entry;
          list[index] = value;
        }, { reason: "edit", changed: [section.id], coalesce: `${item?.id || section.id}:bullet:${index}` });
      },
      onkeydown: (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          commitBullets((entry) => {
            const list = entry.bullets || entry;
            list.splice(index + 1, 0, "");
          });
          this.rerenderBody(section.id);
          const rows = this.root.querySelectorAll(`.card[data-id="${CSS.escape(section.id)}"] .bullet-text`);
          rows[index + 1]?.focus();
        }
        if (event.key === "Backspace" && !event.target.textContent) {
          event.preventDefault();
          commitBullets((entry) => {
            const list = entry.bullets || entry;
            if (list.length <= 1) return false;
            list.splice(index, 1);
          });
          this.rerenderBody(section.id);
          const rows = this.root.querySelectorAll(`.card[data-id="${CSS.escape(section.id)}"] .bullet-text`);
          const previous = rows[Math.max(0, index - 1)];
          if (previous) { previous.focus(); placeCaretAtEnd(previous); }
        }
      },
      onpaste: (event) => {
        // multi-line pastes become multiple bullets rather than one blob
        const clipboard = event.clipboardData?.getData("text/plain") || "";
        const lines = clipboard.split(/\n+/).map((line) => line.replace(/^\s*[•▪-]\s*/, "").trim()).filter(Boolean);
        if (lines.length <= 1) return;
        event.preventDefault();
        commitBullets((entry) => {
          const list = entry.bullets || entry;
          list.splice(index, 1, ...lines);
        });
        this.rerenderBody(section.id);
      },
    }, text);

    return h("div", { class: "bullet-row", "data-id": `${item?.id || section.id}:${index}` },
      h("span", { class: "bullet-dot", "aria-hidden": "true" }, "•"),
      editor,
      h("button", {
        class: "icon-btn sm",
        "aria-label": `Delete bullet ${index + 1}`,
        onclick: () => {
          commitBullets((entry) => {
            const list = entry.bullets || entry;
            list.splice(index, 1);
          });
          this.rerenderBody(section.id);
        },
      }, icon("x", 13)));
  }

  buildBulletsEditor(section) {
    return this.buildBulletList(section, null);
  }

  buildGroupsEditor(section) {
    const list = h("div", { style: { display: "grid", gap: "6px" } });

    (section.groups || []).forEach((group, index) => {
      list.appendChild(h("div", { class: "skill-group" },
        h("input", {
          class: "mini-input",
          value: group.label,
          placeholder: "Languages",
          "aria-label": "Group label",
          oninput: (event) => this.editGroup(section, index, "label", event.target.value),
        }),
        h("input", {
          class: "mini-input",
          value: group.items,
          placeholder: "Python, TypeScript, Go",
          "aria-label": "Group items",
          oninput: (event) => this.editGroup(section, index, "items", event.target.value),
        }),
        h("button", {
          class: "icon-btn sm",
          "aria-label": "Remove group",
          onclick: () => {
            store.commit("Remove group", (doc) => {
              doc.sections.find((s) => s.id === section.id).groups.splice(index, 1);
            });
            this.rerenderBody(section.id);
          },
        }, icon("x", 14))));
    });

    list.appendChild(h("button", {
      class: "add-row",
      onclick: () => {
        store.commit("Add group", (doc) => {
          doc.sections.find((s) => s.id === section.id).groups.push({ id: uid("g"), label: "", items: "" });
        });
        this.rerenderBody(section.id);
      },
    }, icon("plus", 13), "Add group"));

    return list;
  }

  editGroup(section, index, key, value) {
    store.commit("Edit skills", (doc) => {
      const group = doc.sections.find((s) => s.id === section.id).groups[index];
      if (group) group[key] = value;
    }, { reason: "edit", changed: [section.id], coalesce: `${section.id}:group:${index}:${key}` });
  }

  buildProseEditor(section) {
    return h("div", {
      class: "prose-edit",
      contenteditable: "plaintext-only",
      role: "textbox",
      "aria-label": `${section.title} text`,
      "data-placeholder": "Two or three lines on what you do and what you are looking for",
      oninput: (event) => {
        store.commit("Edit text", (doc) => {
          const target = doc.sections.find((s) => s.id === section.id);
          if (target) target.body = event.target.textContent;
        }, { reason: "edit", changed: [section.id], coalesce: `${section.id}:body` });
      },
    }, section.body);
  }

  attachNested(container, itemSelector, onReorder) {
    const list = new SortableList({
      container,
      item: itemSelector,
      handle: itemSelector === ".entry" ? ".entry-grip" : ".bullet-dot",
      getSelection: () => [],
      onReorder,
    });
    this.nested.push(list);
  }

  rerenderBody(sectionId) {
    const card = this.root.querySelector(`.card[data-id="${CSS.escape(sectionId)}"]`);
    const section = store.section(sectionId);
    if (!card || !section) return;
    qs(".card-body", card)?.remove();
    card.appendChild(this.buildBody(section));
    const count = qs(".card-count", card);
    if (count) count.textContent = countLabel(section);
  }

  focusFirstInput(sectionId, itemId) {
    const selector = itemId
      ? `.card[data-id="${CSS.escape(sectionId)}"] .entry[data-id="${CSS.escape(itemId)}"] .mini-input`
      : `.card[data-id="${CSS.escape(sectionId)}"] .mini-input`;
    this.root.querySelector(selector)?.focus();
  }

  focusSection(sectionId) {
    const card = this.root.querySelector(`.card[data-id="${CSS.escape(sectionId)}"]`);
    if (!card) return;
    const section = store.section(sectionId);
    if (section?.collapsed) this.setCollapsed(section, false);
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.classList.add("is-selected");
    setTimeout(() => card.classList.remove("is-selected"), 1400);
    qs(".card-name", card)?.focus();
  }
}

const LAYOUT_LABELS = {
  entries: "Dated entries",
  bullets: "Bullet list",
  inline: "Labelled groups",
  prose: "Paragraph",
};

function countLabel(section) {
  if (section.layout === "prose") {
    const words = section.body ? section.body.trim().split(/\s+/).filter(Boolean).length : 0;
    return words ? `${words}w` : "";
  }
  const count = sectionCount(section);
  return count ? String(count) : "";
}

const wrapWide = (node) => { node.classList.add("field-wide"); return node; };

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((value, key) => (value[key] ??= {}), object);
  target[last] = value;
}

function placeCaretAtEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

export { SECTION_TYPES };
