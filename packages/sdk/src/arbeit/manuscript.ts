import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { ImstudiumError } from "../errors.js";
import { cleanDoi } from "./identifiers.js";
import type { CslItem } from "./types.js";
import { readZipEntries } from "./zip.js";

/**
 * Read a manuscript the way `arbeit check` needs it: which sources it cites
 * (and with which locator), its headings, whether it has a bibliography and
 * a declaration, and how long it is. Markdown/Pandoc/Quarto, LaTeX, Typst
 * and Word (.docx, including Zotero and Mendeley citation fields) are read
 * locally; nothing is uploaded.
 */

export type ManuscriptFormat = "markdown" | "latex" | "typst" | "docx" | "text";

export interface ManuscriptCitation {
  /** The citekey, when the manuscript names one (Pandoc, LaTeX, Typst). */
  key: string | null;
  locator?: string;
  line?: number;
  /** key: a citekey in the text · field: a Zotero/Mendeley/Word citation field */
  via: "key" | "field";
  /** From a Word citation field: the item the field carries. */
  item?: Partial<CslItem>;
  /** Word's own source manager: the source tag. */
  tag?: string;
}

export interface ManuscriptScan {
  path: string;
  format: ManuscriptFormat;
  /** Words of the running text (without footnotes, code and markup); an estimate for LaTeX and Typst. */
  words: number;
  /** Characters of the running text, spaces included. */
  chars: number;
  footnoteWords: number;
  headings: string[];
  citations: ManuscriptCitation[];
  /** `\nocite{*}` or similar: every registry entry counts as cited. */
  citesAll: boolean;
  hasBibliography: boolean;
  /** The plain text, for heuristic checks (author and year in running text). */
  text: string;
}

export function detectManuscriptFormat(path: string): ManuscriptFormat {
  const ext = extname(path).toLowerCase();
  if ([".md", ".markdown", ".qmd", ".rmd", ".pmd"].includes(ext)) return "markdown";
  if ([".tex", ".ltx"].includes(ext)) return "latex";
  if (ext === ".typ") return "typst";
  if (ext === ".docx" || ext === ".docm") return "docx";
  return "text";
}

const countWords = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) ?? []).length;

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Blank out a match but keep its newlines, so line numbers stay right. */
const blank = (m: string) => m.replace(/[^\n]/g, " ");

// ── Markdown (Pandoc, Quarto, R Markdown) ──────────────────────────────────

const PANDOC_KEY = String.raw`[A-Za-z0-9_][\w:.#$%&+?<>~/-]*[A-Za-z0-9_]|[A-Za-z0-9_]`;

export function scanMarkdown(src: string, path = "manuskript.md"): ManuscriptScan {
  const yaml = /^---\n([\s\S]*?)\n(?:---|\.\.\.)\n/.exec(src)?.[1] ?? "";
  let text = src.replace(/^---\n[\s\S]*?\n(?:---|\.\.\.)\n/, blank);
  text = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, blank).replace(/`[^`\n]*`/g, blank).replace(/<!--[\s\S]*?-->/g, blank);
  const citations: ManuscriptCitation[] = [];
  // bracketed: [see @key, p. 12; -@other]
  for (const m of text.matchAll(/\[([^[\]]*?@[^[\]]*)\]/g)) {
    for (const part of m[1]!.split(";")) {
      const k = new RegExp(String.raw`(?<![\w.])-?@(${PANDOC_KEY})(?:\s*,\s*(.+))?`).exec(part.trim());
      if (k) citations.push({ key: k[1]!, ...(k[2] ? { locator: k[2].trim() } : {}), line: lineOf(text, m.index!), via: "key" });
    }
  }
  const outside = text.replace(/\[([^[\]]*?@[^[\]]*)\]/g, blank);
  // in-text: @key or @key [p. 12]
  for (const m of outside.matchAll(new RegExp(String.raw`(?<![\w.@])@(${PANDOC_KEY})(?:\s*\[([^\]]*)\])?`, "g"))) {
    citations.push({ key: m[1]!, ...(m[2] ? { locator: m[2].trim() } : {}), line: lineOf(outside, m.index!), via: "key" });
  }
  const headings = [...text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((m) => m[1]!.replace(/\{[^}]*\}\s*$/, "").trim());
  const footnoteDefs = [...text.matchAll(/^\[\^[^\]]+\]:\s*(.+)$/gm)].map((m) => m[1]!);
  const body = text
    .replace(/^\[\^[^\]]+\]:.*$/gm, "")
    .replace(/\[([^[\]]*?@[^[\]]*)\]/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>#|]/g, " ");
  return {
    path,
    format: "markdown",
    words: countWords(body),
    chars: body.replace(/\s+/g, " ").trim().length,
    footnoteWords: countWords(footnoteDefs.join(" ")),
    headings,
    citations,
    citesAll: /nocite:[\s\S]*?@\*/.test(yaml),
    hasBibliography: /::: *\{#refs\}/.test(src) || headings.some(isBibliographyHeading) || /^(?:bibliography|references):/m.test(src.slice(0, 4000)),
    text: body,
  };
}

// ── LaTeX ───────────────────────────────────────────────────────────────────

const CITE_CMD = /\\((?:[a-zA-Z]*cite[a-zA-Z]*|cites|autocites|parencites|textcites|footcites|smartcites))\*?((?:\s*\[[^\]]*\]){0,2}\s*\{[^}]*\}(?:(?:\s*\[[^\]]*\]){0,2}\s*\{[^}]*\})*)/g;

async function readLatexTree(path: string, depth = 0, seen = new Set<string>()): Promise<string> {
  const abs = resolve(path);
  if (seen.has(abs) || depth > 6) return "";
  seen.add(abs);
  let src = await readFile(abs, "utf-8");
  src = src.replace(/(?<!\\)%.*$/gm, "");
  const parts: string[] = [];
  let last = 0;
  for (const m of src.matchAll(/\\(?:input|include|subfile)\{([^}]+)\}/g)) {
    parts.push(src.slice(last, m.index));
    const target = resolve(dirname(abs), m[1]!.endsWith(".tex") ? m[1]! : `${m[1]}.tex`);
    parts.push(existsSync(target) ? await readLatexTree(target, depth + 1, seen) : "");
    last = m.index! + m[0].length;
  }
  parts.push(src.slice(last));
  return parts.join("");
}

export function scanLatexSource(src: string, path = "manuskript.tex"): ManuscriptScan {
  const text = src.replace(/(?<!\\)%.*$/gm, "");
  const citations: ManuscriptCitation[] = [];
  let citesAll = false;
  for (const m of text.matchAll(CITE_CMD)) {
    const cmd = m[1]!;
    const line = lineOf(text, m.index!);
    // groups of [pre][post]{keys}
    for (const g of m[2]!.matchAll(/((?:\s*\[[^\]]*\]){0,2})\s*\{([^}]*)\}/g)) {
      const opts = [...g[1]!.matchAll(/\[([^\]]*)\]/g)].map((o) => o[1]!.trim());
      const locator = opts.length === 2 ? opts[1] : opts[0];
      for (const key of g[2]!.split(",").map((k) => k.trim()).filter(Boolean)) {
        if (key === "*") {
          citesAll = true;
          continue;
        }
        citations.push({ key, ...(locator && cmd !== "nocite" ? { locator: locator.replace(/~/g, " ") } : {}), line, via: "key" });
      }
    }
  }
  const headings = [...text.matchAll(/\\(?:part|chapter|section|subsection|subsubsection|paragraph|addchap|addsec|minisec)\*?(?:\[[^\]]*\])?\{([^}]*)\}/g)].map((m) => m[1]!.trim());
  const footnotes = [...text.matchAll(/\\footnote\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map((m) => m[1]!);
  const doc = /\\begin\{document\}([\s\S]*?)(?:\\end\{document\}|$)/.exec(text)?.[1] ?? text;
  const body = doc
    .replace(/\\footnote\{((?:[^{}]|\{[^{}]*\})*)\}/g, " ")
    .replace(CITE_CMD, " ")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\[[\s\S]*?\\\]/g, " ")
    .replace(/\\begin\{(equation|align|figure|table|tabular|lstlisting|verbatim)\*?\}[\s\S]*?\\end\{\1\*?\}/g, " ")
    .replace(/\\(?:label|ref|cref|Cref|eqref|pageref|includegraphics|bibliography|addbibresource|usepackage|documentclass|printbibliography)(?:\[[^\]]*\])?\{[^}]*\}/g, " ")
    .replace(/\\[a-zA-Z@]+\*?/g, " ")
    .replace(/[{}[\]~\\]/g, " ");
  return {
    path,
    format: "latex",
    words: countWords(body),
    chars: body.replace(/\s+/g, " ").trim().length,
    footnoteWords: countWords(footnotes.join(" ")),
    headings,
    citations,
    citesAll,
    hasBibliography: /\\printbibliography|\\bibliography\{|\\begin\{thebibliography\}/.test(text),
    text: body,
  };
}

// ── Typst ───────────────────────────────────────────────────────────────────

export function scanTypst(src: string, path = "manuskript.typ"): ManuscriptScan {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<!:)\/\/.*$/gm, blank).replace(/```[\s\S]*?```/g, blank).replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => (/^"[\w.-]+\.(?:bib|yml|yaml|csl)"$/.test(m) ? m : blank(m)));
  const citations: ManuscriptCitation[] = [];
  for (const m of text.matchAll(/(?<![\w.@])@([A-Za-z_][\w:.-]*[\w])(?:\[([^\]]*)\])?/g)) {
    citations.push({ key: m[1]!, ...(m[2] ? { locator: m[2].trim() } : {}), line: lineOf(text, m.index!), via: "key" });
  }
  for (const m of text.matchAll(/#cite\(\s*(?:<([^>]+)>|label\(\s*"([^"]+)"\s*\))(?:[^)]*supplement:\s*\[([^\]]*)\])?[^)]*\)/g)) {
    citations.push({ key: (m[1] ?? m[2])!, ...(m[3] ? { locator: m[3].trim() } : {}), line: lineOf(text, m.index!), via: "key" });
  }
  const headings = [...text.matchAll(/^\s*=+\s+(.+)$/gm)].map((m) => m[1]!.replace(/<[^>]+>\s*$/, "").trim());
  const footnotes = [...text.matchAll(/#footnote\[((?:[^[\]]|\[[^\]]*\])*)\]/g)].map((m) => m[1]!);
  const body = text
    .replace(/#footnote\[((?:[^[\]]|\[[^\]]*\])*)\]/g, " ")
    .replace(/#[a-z][\w.-]*(?:\([^)]*\))?/g, " ")
    .replace(/@[\w:.-]+(?:\[[^\]]*\])?/g, " ")
    .replace(/\$[^$]*\$/g, " ")
    .replace(/^\s*=+\s+/gm, "")
    .replace(/[*_[\]<>]/g, " ");
  return {
    path,
    format: "typst",
    words: countWords(body),
    chars: body.replace(/\s+/g, " ").trim().length,
    footnoteWords: countWords(footnotes.join(" ")),
    headings,
    citations,
    citesAll: false,
    hasBibliography: /#bibliography\(/.test(text),
    text: body,
  };
}

// ── Word (.docx) ────────────────────────────────────────────────────────────

function xmlDecode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

interface DocxPart {
  paragraphs: Array<{ style: string | null; text: string }>;
  fields: string[];
}

/** Paragraph texts (field results kept, field codes left out) and the field codes, in order. */
export function readDocxXml(xml: string): DocxPart {
  const paragraphs: DocxPart["paragraphs"] = [];
  const fields: string[] = [];
  for (const s of xml.matchAll(/<w:fldSimple\b[^>]*w:instr="([^"]*)"/g)) fields.push(xmlDecode(s[1]!));
  let instr: string[] = [];
  const stack: string[][] = [];
  for (const p of xml.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const inner = p[1] ?? "";
    const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(inner)?.[1] ?? null;
    let text = "";
    for (const t of inner.matchAll(/<w:fldChar\b[^>]*w:fldCharType="(begin|separate|end)"[^>]*\/?>|<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>|<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
      if (t[1] === "begin") {
        stack.push(instr);
        instr = [];
      } else if (t[1] === "separate" || t[1] === "end") {
        if (instr.length) fields.push(instr.join(""));
        instr = [];
        if (t[1] === "end") {
          instr = stack.pop() ?? [];
        }
      } else if (t[2] !== undefined) {
        instr.push(xmlDecode(t[2]));
      } else if (t[3] !== undefined) {
        text += xmlDecode(t[3]);
      } else {
        text += " ";
      }
    }
    paragraphs.push({ style, text });
  }
  return { paragraphs, fields };
}

/** Zotero (ADDIN ZOTERO_ITEM CSL_CITATION), Mendeley (ADDIN CSL_CITATION) and Word (CITATION tag) fields → citations. */
export function citationsFromFields(fields: string[]): ManuscriptCitation[] {
  const out: ManuscriptCitation[] = [];
  for (const f of fields) {
    const csl = /ADDIN\s+(?:ZOTERO_ITEM\s+)?CSL_CITATION\s*(\{[\s\S]*\})/.exec(f);
    if (csl) {
      try {
        const data = JSON.parse(csl[1]!) as { citationItems?: Array<{ itemData?: Partial<CslItem>; locator?: string; label?: string }> };
        for (const ci of data.citationItems ?? []) {
          const item = ci.itemData ?? {};
          out.push({ key: null, via: "field", item: { ...item, ...(item.DOI ? { DOI: cleanDoi(String(item.DOI)) } : {}) }, ...(ci.locator ? { locator: ci.locator } : {}) });
        }
      } catch {
        // a field cut off mid-JSON: skip it
      }
      continue;
    }
    const word = /^\s*CITATION\s+(\S+)(.*)$/.exec(f);
    if (word) {
      const page = /\\p\s+"?([^"\\]+)"?/.exec(word[2]!)?.[1]?.trim();
      out.push({ key: null, via: "field", tag: word[1]!, ...(page ? { locator: page } : {}) });
    }
  }
  return out;
}

const HEADING_STYLE = /^(?:Heading|berschrift|Titre|Titel|Title)\s*\d*$|^(?:heading|Überschrift)\s*\d$/i;

export function scanDocxBuffer(buf: Buffer, path = "manuskript.docx"): ManuscriptScan {
  let files: Map<string, Buffer>;
  try {
    files = readZipEntries(buf, (n) => /^word\/(document|footnotes|endnotes)\.xml$/.test(n));
  } catch (e) {
    throw new ImstudiumError(`${path} is not a readable .docx: ${e instanceof Error ? e.message : String(e)}`, "BAD_ARGS", undefined, "Save it again as Word document (.docx)");
  }
  const doc = readDocxXml(files.get("word/document.xml")?.toString("utf8") ?? "");
  const notes = ["word/footnotes.xml", "word/endnotes.xml"].map((n) => readDocxXml(files.get(n)?.toString("utf8") ?? ""));
  const headings = doc.paragraphs.filter((p) => p.style && HEADING_STYLE.test(p.style) && p.text.trim()).map((p) => p.text.trim());
  const body = doc.paragraphs.map((p) => p.text).join("\n");
  const noteText = notes.flatMap((n) => n.paragraphs.map((p) => p.text)).join("\n");
  const citations = citationsFromFields([...doc.fields, ...notes.flatMap((n) => n.fields)]);
  return {
    path,
    format: "docx",
    words: countWords(body),
    chars: body.replace(/\s+/g, " ").trim().length,
    footnoteWords: countWords(noteText),
    headings,
    citations,
    citesAll: false,
    hasBibliography: doc.fields.some((f) => /ADDIN\s+(?:ZOTERO_BIBL|CSL_BIBLIOGRAPHY)|^\s*BIBLIOGRAPHY\b/.test(f)) || headings.some(isBibliographyHeading),
    text: `${body}\n${noteText}`,
  };
}

export function isBibliographyHeading(h: string): boolean {
  return /literatur|quellenverzeichnis|bibliogra|references|works cited|quellen$/i.test(h);
}

export function scanPlainText(src: string, path = "manuskript.txt"): ManuscriptScan {
  const lines = src.split(/\r?\n/);
  const headings = lines.filter((l, i) => l.trim() && l.trim().length < 80 && !/[.,;:]$/.test(l.trim()) && (i === 0 || !lines[i - 1]!.trim()) && /^(?:\d+(?:\.\d+)*\.?\s+|[A-Z]\.\s+|[IVX]+\.\s+)?\p{Lu}/u.test(l.trim()) && (!lines[i + 1] || !lines[i + 1]!.trim()));
  return { path, format: "text", words: countWords(src), chars: src.replace(/\s+/g, " ").trim().length, footnoteWords: 0, headings: headings.map((h) => h.trim()), citations: [], citesAll: false, hasBibliography: headings.some(isBibliographyHeading), text: src };
}

/** Read and scan a manuscript file. */
export async function scanManuscript(path: string): Promise<ManuscriptScan> {
  if (!existsSync(path)) throw new ImstudiumError(`No manuscript at ${path}`, "NOT_FOUND", undefined, "Pass the path to your .docx, .md, .tex or .typ file, or set it once: imstudium arbeit set manuskript=<path>");
  const format = detectManuscriptFormat(path);
  if (format === "docx") return scanDocxBuffer(await readFile(path), path);
  if (format === "latex") return scanLatexSource(await readLatexTree(path), path);
  const src = await readFile(path, "utf-8");
  if (format === "markdown") return scanMarkdown(src, path);
  if (format === "typst") return scanTypst(src, path);
  return scanPlainText(src, path);
}
