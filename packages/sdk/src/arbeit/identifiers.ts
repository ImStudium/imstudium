/**
 * Recognise what a student pasted: a DOI (bare, doi: or a doi.org link), an
 * ISBN-10/13 (checksum verified), an arXiv id, or a web address. Pure and
 * offline.
 */

export type IdentifierKind = "doi" | "isbn" | "arxiv" | "url";

export interface Identifier {
  kind: IdentifierKind;
  /** Normalised: DOI lower-cased without prefix, ISBN-13 digits, arXiv id, URL as given. */
  value: string;
  input: string;
}

const DOI_CORE = /10\.\d{4,9}\/[^\s"'<>]+/i;
const ARXIV_NEW = /^(?:arxiv:)?(\d{4}\.\d{4,5})(v\d+)?$/i;
const ARXIV_OLD = /^(?:arxiv:)?([a-z-]+(?:\.[a-z]{2})?\/\d{7})(v\d+)?$/i;

/** Strip what usually trails a DOI in running text: closing punctuation and brackets. */
export function cleanDoi(raw: string): string {
  let d = raw.trim().replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
  d = decodeURIComponentSafe(d);
  d = d.replace(/[.,;:]+$/, "");
  // a trailing ")" or "]" belongs to the DOI only when it opened inside it
  while (/[)\]]$/.test(d)) {
    const close = d.slice(-1);
    const open = close === ")" ? "(" : "[";
    if (count(d, open) >= count(d, close)) break;
    d = d.slice(0, -1);
  }
  return d.toLowerCase();
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function isValidIsbn10(digits: string): boolean {
  if (!/^\d{9}[\dX]$/i.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = digits[i]!;
    const v = c === "X" || c === "x" ? 10 : Number(c);
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(digits: string): boolean {
  if (!/^97[89]\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(digits[i]) * (i % 2 ? 3 : 1);
  return sum % 10 === 0;
}

export function isbn10to13(isbn10: string): string {
  const core = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
  return `${core}${(10 - (sum % 10)) % 10}`;
}

/** An ISBN-10 or -13 (hyphens and spaces allowed) as ISBN-13 digits, or null when the checksum fails. */
export function normalizeIsbn(raw: string): string | null {
  const digits = raw.replace(/^isbn(?:-1[03])?:?\s*/i, "").replace(/[\s-]/g, "").toUpperCase();
  if (digits.length === 13 && isValidIsbn13(digits)) return digits;
  if (digits.length === 10 && isValidIsbn10(digits)) return isbn10to13(digits);
  return null;
}

/** What kind of identifier `input` is, normalised; null when it is none of them. */
export function parseIdentifier(input: string): Identifier | null {
  const s = input.trim();
  if (!s) return null;
  if (/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i.test(s) || /^doi:/i.test(s) || /^10\.\d{4,9}\//.test(s)) {
    const m = DOI_CORE.exec(s);
    if (m) return { kind: "doi", value: cleanDoi(m[0]), input };
  }
  // arxiv.org/abs/…, arXiv:…, or a bare new-style id (2101.01234)
  const arxivUrl = /^(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:\.pdf)?(?:[?#].*)?$/i.exec(s);
  const candidate = arxivUrl ? arxivUrl[1]! : s.replace(/^arxiv:\s*/i, "");
  const prefixed = !!arxivUrl || /^arxiv:/i.test(s);
  const arxiv = ARXIV_NEW.exec(candidate) ?? (prefixed ? ARXIV_OLD.exec(candidate) : null);
  if (arxiv) return { kind: "arxiv", value: arxiv[1]!, input };
  if (/^isbn/i.test(s) || /^[\d][\d\s-]{8,16}[\dXx]$/.test(s)) {
    const isbn = normalizeIsbn(s);
    if (isbn) return { kind: "isbn", value: isbn, input };
  }
  if (/^https?:\/\//i.test(s)) {
    const doi = DOI_CORE.exec(s);
    if (doi && /doi/i.test(s)) return { kind: "doi", value: cleanDoi(doi[0]), input };
    return { kind: "url", value: s, input };
  }
  return null;
}

/** The DataCite DOI arXiv registers for every preprint (10.48550/arXiv.<id>). */
export function arxivDoi(id: string): string {
  return `10.48550/arxiv.${id.toLowerCase()}`;
}

/** Every DOI in a text, cleaned and de-duplicated, in order of appearance. */
export function findDois(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/10\.\d{4,9}\/[^\s"'<>]+/gi)) out.add(cleanDoi(m[0]));
  return [...out];
}

/** Every valid ISBN in a text that is labelled as one ("ISBN 978-…"), as ISBN-13 digits. */
export function findIsbns(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/ISBN(?:-1[03])?:?\s*((?:97[89][\s-]?)?(?:\d[\s-]?){9}[\dXx])/gi)) {
    const isbn = normalizeIsbn(m[1]!);
    if (isbn) out.add(isbn);
  }
  return [...out];
}
