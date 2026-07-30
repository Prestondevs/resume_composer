import { toMarkdown, toPlainText } from "./serialize.js";
import { toDocx } from "./docx.js";
import { renderResume, pageMetrics } from "../templates/render.js";
import { downloadBlob, slugify } from "../lib/util.js";
import { h } from "../lib/dom.js";
import { PAGE_SIZES } from "../schema.js";

export const EXPORT_FORMATS = [
  { id: "pdf", label: "PDF", blurb: "Print-quality, selectable text", ext: "pdf" },
  { id: "docx", label: "Word", blurb: "Editable .docx", ext: "docx" },
  { id: "md", label: "Markdown", blurb: "Plain structure for the web", ext: "md" },
  { id: "txt", label: "Plain text", blurb: "What an ATS sees", ext: "txt" },
];

export function exportFileName(doc, extension) {
  const name = doc.sections.find((s) => s.type === "contact")?.contact?.name;
  const base = name ? `${slugify(name)}-resume` : slugify(doc.name);
  return `${base}.${extension}`;
}

export async function exportDocument(doc, format) {
  switch (format) {
    case "md": {
      downloadBlob(new Blob([toMarkdown(doc)], { type: "text/markdown;charset=utf-8" }), exportFileName(doc, "md"));
      return { kind: "download" };
    }
    case "txt": {
      downloadBlob(new Blob([toPlainText(doc, { width: 96 })], { type: "text/plain;charset=utf-8" }), exportFileName(doc, "txt"));
      return { kind: "download" };
    }
    case "docx": {
      const blob = await toDocx(doc);
      downloadBlob(blob, exportFileName(doc, "docx"));
      return { kind: "download" };
    }
    case "pdf":
      return printPdf(doc);
    default:
      throw new Error(`Unknown export format: ${format}`);
  }
}

// PDF goes through the browser's print pipeline. It keeps text selectable and vector-sharp,
// honours real page breaks, and produces a file that an ATS can actually read, none of which is
// true of a canvas-rasterised export
async function printPdf(doc) {
  const root = document.getElementById("print-root");
  if (!root) throw new Error("Print surface is unavailable.");

  const size = PAGE_SIZES[doc.settings.pageSize] || PAGE_SIZES.letter;
  const metrics = pageMetrics(doc);

  const pageRule = document.createElement("style");
  pageRule.id = "print-page-rule";
  pageRule.textContent = `@page { size: ${metrics.widthIn}in ${metrics.heightIn}in; margin: 0; }`;
  document.head.appendChild(pageRule);

  const surface = h("div");
  root.replaceChildren(surface);
  const result = renderResume(doc, surface);

  if (!result.pages) {
    cleanUp();
    throw new Error("There is nothing visible to export yet.");
  }

  // browsers use the document title for the suggested PDF filename
  const previousTitle = document.title;
  document.title = exportFileName(doc, "pdf").replace(/\.pdf$/, "");

  function cleanUp() {
    document.title = previousTitle;
    root.replaceChildren();
    pageRule.remove();
    window.removeEventListener("afterprint", cleanUp);
  }

  window.addEventListener("afterprint", cleanUp, { once: true });

  // give the clone one frame to lay out before the print dialog snapshots it
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    window.print();
  } catch (error) {
    cleanUp();
    throw new Error("The browser blocked the print dialog. Allow pop-ups for this page and try again.");
  }

  // safari never fires afterprint reliably; clean up on a timer as a backstop
  setTimeout(cleanUp, 60_000);

  return { kind: "print", pages: result.pages, sizeLabel: size.label };
}

export { toMarkdown, toPlainText };
