/**
 * Agent-facing extraction limits — llms.txt, searchGuidance, skills.
 * Local poppler/Tesseract only; no LaTeX-in-markdown pipeline.
 */
export const EXTRACTION_LIMITS_FOR_AGENTS = [
  "content.md is plain text (poppler) or OCR (Tesseract) — not LaTeX $...$ markdown.",
  "Typed PDFs: Unicode math at best (e.g. β, ∑); subscripts often appear as x1 not x_1.",
  "Scanned/handwritten pages: OCR is unreliable for formulas — treat _(OCR)_ blocks as low trust.",
  "PPTX native-xml fallback skips Office Math; prefer LibreOffice+poppler path or page PNGs.",
  "Formulas, diagrams, plots, tables: read pages/*.png or viewer.html before explaining — mandatory.",
  "corpus.jsonl text is for keyword discovery; do not answer math from indexed OCR alone.",
] as const;
