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
  "Lecture recordings (audio, video): a speech-model transcript in ## hh:mm:ss sections of about two minutes, made on this machine once imstudium setup speech has run, or read from a transcript.json another runner left; the header names the model and says whether it ran on this machine. It is model output: check names, numbers and formulas against the recording at the cited time.",
  "corpus.jsonl is for keyword discovery, not for answering from image-only pages.",
] as const;
