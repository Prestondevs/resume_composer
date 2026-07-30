# Resume Composer

Import a finished resume, break it back into editable cards, rearrange it against a
specific job posting, and export to PDF, Word, Markdown or plain text.

Everything runs in the browser. No build step, no server, no account, no upload.

## Running it

It is a static site, so any static host works and no tooling is required.

```bash
python -m http.server 8123
```

Then open <http://localhost:8123>.

Opening `index.html` straight off the filesystem will not work: the app is built
from ES modules, and browsers refuse to load modules over `file://`.

### GitHub Pages

Settings, Pages, then set Source to "Deploy from a branch", branch `main`, folder
`/ (root)`. There is nothing to build, so the site is live a minute later.

`.nojekyll` is included so Jekyll does not touch the output. Every path in the app
is relative and the pdf.js worker is resolved from `import.meta.url`, so it works
from a project subpath such as `prestondevs.github.io/resume_composer/` as well as
from a user site at the domain root.

## The interface

The page sits in the middle of the window at all times. Two panels float over it:
sections on the left, tools on the right. Both collapse to a handle, and every
group inside them folds independently, with the open set remembered between
visits. A single bar at the bottom carries the page or ATS view switch, zoom and
the live word and page count.

## Importing

| Format | Notes |
| --- | --- |
| PDF | Text layer only. Two-column layouts, repeated page headers and words hyphenated across a line break are all handled. |
| DOCX | Read straight from the OOXML, so real heading styles and list levels survive. |
| LaTeX | `.tex` and `.latex`. A `.txt` containing `\documentclass` is detected too. |
| Markdown | `.md`, `.markdown` |
| Plain text | `.txt` |

Legacy `.doc` is not supported. Scanned PDFs have no text layer and cannot be
read; the app says so rather than importing an empty document.

### Fonts are preserved

An imported resume keeps the typeface it arrived with. PDF font names are
subset-prefixed and often name a font the reader does not have, so each detected
font becomes a CSS stack: the real name first, then close metric substitutes,
then the correct generic family. LaTeX sources are read from the preamble
(`\setmainfont`, or packages such as `helvet`, `mathptmx`, `lmodern`), and DOCX
from `w:rFonts` plus the document default.

The font is applied as an inline custom property, which outranks the template
stylesheet. Switching layouts therefore rearranges the page without restyling the
text. Layout, Typeface has a switch to fall back to the layout's own font.

## How it fits together

```
index.html          static shell; everything else is built at runtime
css/                tokens, app chrome, cards, page preview, templates, print
js/
  store.js          document state, undo/redo, versions, autosave
  schema.js         section model and the layout table everything agrees on
  import/           pdf, docx, latex and text readers, font detection, section parser
  export/           pdf (print pipeline), docx (OOXML), markdown, plain text
  analysis/         job-description keyword extraction and resume scoring
  templates/        renderer and measured pagination
  ui/               cards, drag and drop, preview, panels, palette, overlays
vendor/pdfjs/       Mozilla pdf.js, vendored so the app works offline
vendor/vov/         vov.css, the entrance animations used on load
```

On load each region arrives from the edge it sits on, staggered so the page itself
lands first. The classes are removed once they finish, because the library leaves
its final transform applied and a settled transform on a dock would create a
containing block that interferes with dragging and with the collapse transition.
The view bar is centred with a transform of its own, so it only fades rather than
sliding. Everything is skipped under `prefers-reduced-motion`, which the library
handles itself.

### Decisions worth knowing

**Sections have a layout, not a type-specific shape.** Every section is one of
five layouts (contact, dated entries, bullets, labelled groups, prose). The
editor, four exporters and eight layouts all read that one table, so they cannot
drift apart.

**Pagination is measured, not estimated.** The document is laid out once in a
hidden host at true page width, block heights are read back, and blocks are then
distributed across real page elements. The preview breaks where the PDF breaks.

**PDF export goes through the browser's print pipeline.** Text stays selectable
and vector-sharp. A rasterised export would look fine and be unreadable to every
applicant tracking system.

**DOCX is generated directly as OOXML.** The ZIP reader and writer in
`js/lib/zip.js` use the browser's native `CompressionStream`, so producing a real
Word file needs no third-party library.

**The job-description analysis is a lexicon plus statistics**, not a model. It
runs in milliseconds, works offline, and you can read exactly why a term scored
the way it did. It will suggest reordering, revealing or emphasising what you
already wrote, and will never add a skill for you.

**Undo is snapshot-based.** Resumes are tens of kilobytes, so snapshotting the
whole document per commit is cheaper than maintaining inverse operations, and it
stays correct across merges, splits and imports. Rapid text edits coalesce so
typing does not fill the history.

**Extractors mark column gaps with a tab.** PDF wide gaps, DOCX tab stops and
LaTeX macro arguments all become tabs, and the section parser reads those as
field separators. That is why `cleanLine` exists alongside `cleanText`: the
ordinary cleaner collapses tabs, which would merge a job title, its dates and its
location into one string.

**No em or en dashes appear anywhere in the source.** The parser still accepts
every dash variant in imported text, but it builds those character classes from
codepoints, and all generated output uses a plain hyphen.

### Known rough edges

When a PDF lists an employer on its own line above several roles at that
employer, the employer becomes its own entry rather than being attached to each
role. Nothing is lost, and one drag fixes it, but the parser cannot tell that
case apart from a genuinely separate entry.

Two-column layouts (Creative, Sidebar) do not reflow across pages. If the content
exceeds one page the preview marks the overflow instead of breaking the columns
somewhere wrong.

## Storage

Everything lives in this browser's `localStorage` under `resume-composer/v1`.
Clearing site data clears your resumes. Export anything you want to keep.

## Browser support

Word import and export need `CompressionStream` and `DecompressionStream`:
Chrome and Edge 103+, Firefox 113+, Safari 16.4+. Everything else works further
back.

## Licence

`vendor/pdfjs` is Mozilla's pdf.js, Apache 2.0, licence included alongside it.
`vendor/vov` is vov.css by Vaibhav Tandon, MIT, licence header kept in the file.
Both are vendored unmodified so they can be swapped for a newer release.
