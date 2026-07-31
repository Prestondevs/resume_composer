import { extractPdf } from "./pdf.js";
import { extractDocx } from "./docx.js";
import { extractText } from "./text.js";
import { extractLatex } from "./latex.js";
import { parseResume } from "./parse.js";
import { formatBytes } from "../lib/util.js";

const MAX_BYTES = 25 * 1024 * 1024;

// sniffs the container rather than trusting the extension
async function detectKind(file) {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const signature = String.fromCharCode(...header.slice(0, 4));

  if (signature === "%PDF") return "pdf";
  // DOCX and every other OOXML file is a ZIP
  if (header[0] === 0x50 && header[1] === 0x4b) return "docx";
  // old binary .doc
  if (header[0] === 0xd0 && header[1] === 0xcf) return "doc";

  const name = file.name.toLowerCase();
  // a word processor format we cannot read is worth naming, because falling through to the text
  // reader would turn it into a screenful of binary rather than an explanation
  if (/\.(doc|rtf|odt|pages|wpd)$/.test(name)) return "doc";
  if (name.endsWith(".tex") || name.endsWith(".latex")) return "latex";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";

  // a .txt that is really a LaTeX source still deserves the LaTeX reader
  const head = await file.slice(0, 4096).text();
  if (/\\documentclass|\\begin\s*\{document\}|\\usepackage/.test(head)) return "latex";

  return "text";
}

// reads a resume file into a normalised document
// label: string) => void} onProgress
export async function importFile(file, onProgress = () => {}) {
  if (!file) throw new Error("No file was provided.");
  if (file.size === 0) throw new Error(`"${file.name}" is empty.`);
  if (file.size > MAX_BYTES) {
    throw new Error(`"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`);
  }

  onProgress(0.05, "Reading file");
  const kind = await detectKind(file);

  if (kind === "doc") {
    throw new Error(`"${file.name}" is a format this cannot read. Open it and save as .docx, or export a PDF.`);
  }

  let extraction;
  try {
    if (kind === "pdf") {
      extraction = await extractPdf(await file.arrayBuffer(), onProgress);
    } else if (kind === "docx") {
      extraction = await extractDocx(await file.arrayBuffer(), onProgress);
    } else if (kind === "latex") {
      onProgress(0.4, "Reading LaTeX source");
      extraction = extractLatex(await file.text());
    } else {
      onProgress(0.4, "Reading text");
      extraction = extractText(await file.text(), { markdown: kind === "markdown" });
    }
  } catch (error) {
    // surface the specific reason; a generic "import failed" helps nobody
    throw new Error(error?.message || `"${file.name}" could not be read.`);
  }

  onProgress(0.9, "Building sections");
  const { doc, warnings } = parseResume(extraction, { fileName: file.name });

  doc.source = { name: file.name, size: file.size, kind, importedAt: Date.now() };
  onProgress(1, "Done");

  return { doc, warnings, extraction };
}

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".tex", ".latex", ".txt", ".md", ".markdown"];

export function isAcceptedFile(file) {
  const name = (file?.name || "").toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension));
}
