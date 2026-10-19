/**
 * Agent-facing extraction limits — llms.txt, searchGuidance, skills.
 * One local pipeline: AnyDoc + pdf-inspector. No Tesseract, no LaTeX.
 */
export const EXTRACTION_LIMITS_FOR_AGENTS = [
  "content.md is local AnyDoc / pdf-inspector markdown — not LaTeX $...$.",
  "PDFs: pdf-inspector (layout, tables, reading order). Image-only pages are marked _(image-only page — no text layer)_.",
  "PPTX/DOCX/XLSX: AnyDoc native conversion. No LibreOffice, no unzip XML fallback.",
  "No Tesseract / no cloud OCR. Scanned pages have no text — open the original file.",
  "Formulas and diagrams: open the source PDF/PPTX; do not invent math from markdown.",
  "corpus.jsonl is for keyword discovery, not for answering from image-only pages.",
] as const;
