import type { CslDate, CslItem, CslName } from "./types.js";

/**
 * Small, pure helpers over CSL items: names, years, folding for keys and
 * comparisons, and a string similarity for "is this the same work?".
 */

/** Fold to ASCII the German way first (ü → ue, ß → ss), then strip remaining diacritics. */
export function foldGerman(text: string): string {
  return text
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Lower-case, diacritics folded, punctuation gone, single spaces: for comparisons. */
export function normalizeForCompare(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9ß]+/g, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, " ");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient on character bigrams of the normalised strings, 0…1. */
export function similarity(a: string, b: string): number {
  const x = normalizeForCompare(a);
  const y = normalizeForCompare(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of bx) {
    overlap += Math.min(n, by.get(g) ?? 0);
    total += n;
  }
  for (const n of by.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}

/** The year of a CSL date, or null. */
export function yearOf(date: CslDate | undefined): number | null {
  const first = date?.["date-parts"]?.[0]?.[0];
  if (first !== undefined && first !== null && first !== "") {
    const n = Number(first);
    if (Number.isFinite(n)) return n;
  }
  const raw = date?.raw ?? date?.literal;
  const m = raw ? /(\d{4})/.exec(raw) : null;
  return m ? Number(m[1]) : null;
}

/** A CSL date from "2021", "2021-03", "2021-03-15" or "15.03.2021". */
export function parseCslDate(text: string): CslDate | undefined {
  const t = text.trim();
  if (!t) return undefined;
  let m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(t);
  if (m) return { "date-parts": [[Number(m[1]), ...(m[2] ? [Number(m[2])] : []), ...(m[3] ? [Number(m[3])] : [])]] };
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) return { "date-parts": [[Number(m[3]), Number(m[2]), Number(m[1])]] };
  return { literal: t };
}

/** "2021-03-15" (as far as the date goes) or "" */
export function formatCslDate(date: CslDate | undefined): string {
  const parts = date?.["date-parts"]?.[0];
  if (parts?.length) return parts.map((p, i) => (i === 0 ? String(p) : String(p).padStart(2, "0"))).join("-");
  return date?.literal ?? date?.raw ?? "";
}

/** "Müller, Anna" / "Deutsche Forschungsgemeinschaft" / "van Dijk, Jan" */
export function nameToString(n: CslName): string {
  if (n.literal) return n.literal;
  const family = [n["non-dropping-particle"], n.family].filter(Boolean).join(" ");
  const given = [n.given, n["dropping-particle"]].filter(Boolean).join(" ");
  return given ? `${family}, ${given}${n.suffix ? `, ${n.suffix}` : ""}` : family;
}

/**
 * Parse one name: "Müller, Anna", "Anna Müller", "van Dijk, Jan",
 * or "{Deutsche Forschungsgemeinschaft}" / a name with no comma and
 * more than four words (an institution) → literal.
 */
export function parseName(raw: string): CslName {
  let s = raw.trim().replace(/\s+/g, " ");
  if (/^\{.*\}$/.test(s)) return { literal: s.slice(1, -1).trim() };
  s = s.replace(/[{}]/g, "");
  const parts = s.split(",").map((p) => p.trim());
  if (parts.length >= 2) {
    const [familyPart, given, suffix] = parts as [string, string, string | undefined];
    const particle = /^((?:von|van|de|der|den|du|la|le|zu|dos|da|di|ten|ter)(?:\s+(?:von|van|de|der|den|du|la|le|zu|dos|da|di|ten|ter))*)\s+(.+)$/i.exec(familyPart);
    return {
      ...(particle && particle[1]![0] === particle[1]![0]!.toLowerCase()
        ? { "non-dropping-particle": particle[1]!, family: particle[2]! }
        : { family: familyPart }),
      ...(given ? { given } : {}),
      ...(suffix ? { suffix } : {}),
    };
  }
  const words = s.split(" ");
  if (words.length === 1) return { family: s };
  if (words.length > 4) return { literal: s };
  // "Anna Maria von Müller" → particle words in lower case before the family name
  let i = words.length - 1;
  while (i > 1 && /^[a-zß]/.test(words[i - 1]!)) i--;
  const given = words.slice(0, i);
  const particles = words.slice(i, words.length - 1);
  return {
    family: words[words.length - 1]!,
    given: given.join(" "),
    ...(particles.length ? { "non-dropping-particle": particles.join(" ") } : {}),
  };
}

/** Split a name list on " and " (BibTeX) or ";" (people typing). */
export function parseNameList(raw: string): CslName[] {
  const sep = /\s+and\s+/i.test(raw) ? /\s+and\s+/i : /\s*;\s*/;
  return raw
    .split(sep)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(parseName);
}

/** First author's (or editor's) family name, or an institution's first word. */
export function firstCreatorFamily(item: CslItem): string | null {
  const n = item.author?.[0] ?? item.editor?.[0] ?? item["container-author"]?.[0];
  if (!n) return null;
  return n.family ?? n.literal ?? null;
}

/** "Müller & Schmidt" / "Müller et al." / "Deutsche Forschungsgemeinschaft" for lists and messages. */
export function creatorsShort(item: CslItem): string {
  const names = item.author?.length ? item.author : item.editor ?? [];
  const fam = (n: CslName) => n.family ?? n.literal ?? "?";
  if (!names.length) return "o. A.";
  if (names.length === 1) return fam(names[0]!);
  if (names.length === 2) return `${fam(names[0]!)} & ${fam(names[1]!)}`;
  return `${fam(names[0]!)} et al.`;
}

/** "Müller (2021): Digitale Lehre" for one-line listings. */
export function shortReference(item: CslItem): string {
  const year = yearOf(item.issued);
  return `${creatorsShort(item)} (${year ?? "o. J."}): ${item.title ?? "(ohne Titel)"}`;
}
