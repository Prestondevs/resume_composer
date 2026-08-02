# Plan

Written after reading the whole repository. Sizes below are lines of code.

## Where it stands

```
js/main.js          912   boot, chrome, docks, files, export, shortcuts, commands
js/ui/cards.js      895   the section list and every inline editor
js/import/parse.js  802   lines -> structured sections
js/ui/panels.js     681   six tool panels
js/schema.js        667   document model, layouts, style knobs
js/analysis/*       743   keyword extraction, scoring, suggestions
js/templates/*      610   renderer, measured pagination, date/location formatting
                   ----
                   9147   JavaScript, 2333 CSS
```

Strong already: one document model every consumer agrees on, measured pagination so the
preview breaks where the PDF breaks, in-place editing on the page, lossless import from
PDF/DOCX/LaTeX/Markdown, real OOXML export, undo/redo, versions, autosave, command palette,
drag and drop, thirteen layouts.

Weak:

1. **`main.js` does eight jobs.** Boot, chrome painting, dock geometry, file handling, export,
   shortcuts, command registry, first run. It should be a composition root only.
2. **`cards.js` mixes three concerns.** List rendering, per-layout editors, and section
   operations (split/merge/convert/duplicate). The operations belong on the store.
3. **No selection model.** Nothing knows what the user is currently working on, which is
   exactly what a context-aware panel needs.
4. **Writing help is document-wide only.** The review panel scores the whole resume; there is
   nothing that helps with the sentence under the caret.
5. **No test harness.** Everything has been verified by driving a live browser, which does not
   survive a refactor.

## Three decisions that change the brief

### Staying vanilla, not moving to React + Framer Motion

The app is zero-build ES modules served as static files. That is why `git push` puts it live on
GitHub Pages with no CI, and why it runs offline. React and Framer Motion need npm, a bundler
and a build step. Node is not installed on this machine, so the practical result would be an app
that can no longer be run or deployed here.

The outcomes asked for do not require the framework:

- 60fps animation comes from compositor-only properties (`transform`, `opacity`), which is what
  the current transitions already use.
- Componentisation is a code organization question, addressed by splitting the large modules.
- Avoiding needless re-render is already handled by targeted updates: a text edit repaints one
  card header, not the list.

If the project ever gains a backend, revisiting this is reasonable. Today it would cost the
deployment story and buy nothing the user can see.

### AI features are local and deterministic, not model calls

There is no backend and no API key, and the privacy claim in the README is that nothing leaves
the browser. So the writing tools are built on the existing lexicon and analysis engine:
detecting weak openers, missing quantification, passive voice, repetition, first person, filler,
and rewriting mechanically where a rewrite is safe.

Two things this deliberately will not do:

- **Invent experience.** "Expand this bullet" cannot be honest without knowing facts the resume
  does not contain, so it is built as a checklist of what is missing rather than generated prose.
- **Claim to be a language model.** Everything is labelled as a rule, and every suggestion is
  proposed for approval rather than applied.

Adding a real model later means one adapter module and an API key, and it would need the privacy
wording changed to match.

### Some requested features need a server

Cloud sync, LinkedIn import and an account system need a backend and OAuth. Shareable links can
be done without one by compressing the document into the URL, which is on the list below.

## Order of work

Each step ships on its own and leaves the app working.

1. **Selection model and context-aware Inspector.** A selection is recorded whenever the caret
   enters the page; the right dock offers tools for whatever is selected. This is the largest
   missing feature and everything below leans on it.
2. **Writing tools.** Shorten, strengthen the opening, make ATS-plain, STAR coverage,
   quantification prompts, repetition across bullets. Proposed as diffs to accept or reject.
3. **Split `main.js` and `cards.js`.** Composition root plus focused modules; section operations
   move onto the store where undo already lives.
4. **A test harness that runs in the browser** with no build step, covering the parser, the
   exporters, pagination and the writing tools.
5. **Polish pass.** Skeletons while a large import parses, success states, tooltips, focus
   visible everywhere, contrast audit against WCAG AA.
6. **Cover letter and summary generation** from the resume and the pasted job description.
7. **Shareable links** by compressing the document into the URL fragment.
