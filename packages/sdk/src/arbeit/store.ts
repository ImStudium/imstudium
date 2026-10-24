import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { dateKey } from "../berlin.js";
import { slugify } from "../config.js";
import { ImstudiumError } from "../errors.js";
import { itemIsbn } from "./bibtex.js";
import { assignCitekey, isValidCitekey } from "./citekey.js";
import { creatorsShort, firstCreatorFamily, normalizeForCompare, similarity, yearOf } from "./csl-util.js";
import { FORMVORGABEN_PRESETS, formvorgabenLines, formvorgabenPreset } from "./formvorgaben.js";
import { exportLibrary } from "./interchange.js";
import { loadStyle } from "./styles.js";
import {
  ARBEIT_TYP_LABEL,
  ARBEIT_TYPEN,
  type Arbeit,
  type ArbeitCourse,
  type ArbeitRef,
  type ArbeitTyp,
  type CslFields,
  type CslItem,
  type Quelle,
  type QuelleOrigin,
  type QuellenFile,
  type Umfang,
} from "./types.js";

/**
 * Where Arbeiten live and how the registry is read and written. An Arbeit
 * is a folder: `<workspace>/arbeiten/<slug>/` by default, or any folder the
 * student names (a LaTeX or Typst project). Writes are atomic; every change
 * to the registry regenerates `quellen.bib` and the agent brief `ARBEIT.md`.
 */

export const ARBEITEN_DIR = "arbeiten";
export const ARBEIT_FILE = "arbeit.json";
export const QUELLEN_FILE = "quellen.json";
export const BIB_FILE = "quellen.bib";
export const BRIEF_FILE = "ARBEIT.md";

interface ArbeitenIndex {
  current: string | null;
  extern: string[];
}

const indexPath = (workspace: string) => join(workspace, ".imstudium", "arbeiten.json");

async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

async function readIndex(workspace: string): Promise<ArbeitenIndex> {
  const raw = await readJson<Partial<ArbeitenIndex>>(indexPath(workspace));
  return { current: raw?.current ?? null, extern: Array.isArray(raw?.extern) ? raw!.extern : [] };
}

async function writeIndex(workspace: string, index: ArbeitenIndex): Promise<void> {
  await writeAtomic(indexPath(workspace), `${JSON.stringify(index, null, 2)}\n`);
}

/** Read the Arbeit in `dir`, or null when there is none. */
export async function readArbeit(dir: string, workspace?: string): Promise<ArbeitRef | null> {
  const arbeit = await readJson<Arbeit>(join(dir, ARBEIT_FILE));
  if (!arbeit || arbeit.schema !== "imstudium/arbeit/v1") return null;
  arbeit.hilfsmittel ??= [];
  const inWorkspace = !!workspace && resolve(dirname(dir)) === resolve(workspace, ARBEITEN_DIR);
  return { dir: resolve(dir), arbeit, inWorkspace };
}

/** Every Arbeit: the workspace's `arbeiten/` folder plus the external folders it remembers. */
export async function listArbeiten(workspace: string): Promise<ArbeitRef[]> {
  const out: ArbeitRef[] = [];
  const base = join(workspace, ARBEITEN_DIR);
  if (existsSync(base)) {
    for (const d of (await readdir(base, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      const ref = await readArbeit(join(base, d), workspace);
      if (ref) out.push(ref);
    }
  }
  for (const dir of (await readIndex(workspace)).extern) {
    if (out.some((r) => r.dir === resolve(dir))) continue;
    const ref = await readArbeit(dir, workspace);
    if (ref) out.push(ref);
  }
  return out;
}

/** The nearest folder at or above `cwd` holding an arbeit.json. */
export async function findArbeitUpwards(cwd: string, workspace?: string): Promise<ArbeitRef | null> {
  let d = resolve(cwd);
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(d, ARBEIT_FILE))) return readArbeit(d, workspace);
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

/**
 * Which Arbeit a command means: `--arbeit` (slug, title fragment or folder),
 * else the folder the command runs in, else the one picked with
 * `arbeit use`, else the only one there is.
 */
export async function resolveArbeit(workspace: string, opts: { arbeit?: string; cwd?: string } = {}): Promise<ArbeitRef> {
  const all = await listArbeiten(workspace);
  if (opts.arbeit) {
    const q = opts.arbeit.trim();
    if (q.includes("/") || q === "." || q === "..") {
      const ref = await readArbeit(isAbsolute(q) ? q : resolve(opts.cwd ?? process.cwd(), q), workspace);
      if (ref) return ref;
    }
    const exact = all.filter((r) => r.arbeit.slug === q || r.dir.endsWith(`/${q}`));
    if (exact.length === 1) return exact[0]!;
    const needle = normalizeForCompare(q);
    const fuzzy = all.filter((r) => normalizeForCompare(r.arbeit.title).includes(needle) || r.arbeit.slug.includes(slugify(q).toLowerCase()));
    if (fuzzy.length === 1) return fuzzy[0]!;
    if (fuzzy.length > 1) {
      throw new ImstudiumError(`Several Arbeiten match "${q}"`, "ARBEIT_AMBIGUOUS", undefined, undefined, { candidates: fuzzy.map((r) => ({ slug: r.arbeit.slug, title: r.arbeit.title, dir: r.dir })) });
    }
    throw new ImstudiumError(`No Arbeit matches "${q}"`, "ARBEIT_MISSING", undefined, "imstudium arbeit lists them; imstudium arbeit new \"<Titel>\" starts one", { query: q });
  }
  const here = await findArbeitUpwards(opts.cwd ?? process.cwd(), workspace);
  if (here) return here;
  const index = await readIndex(workspace);
  if (index.current) {
    const cur = all.find((r) => r.dir === resolve(index.current!));
    if (cur) return cur;
  }
  if (all.length === 1) return all[0]!;
  if (!all.length) {
    throw new ImstudiumError("No Arbeit yet", "ARBEIT_MISSING", undefined, 'imstudium arbeit new "<Titel>" --typ hausarbeit');
  }
  throw new ImstudiumError(`${all.length} Arbeiten exist and none is selected`, "ARBEIT_AMBIGUOUS", undefined, "Pass --arbeit <slug>, or run: imstudium arbeit use <slug>", {
    candidates: all.map((r) => ({ slug: r.arbeit.slug, title: r.arbeit.title, dir: r.dir })),
  });
}

export async function setCurrentArbeit(workspace: string, ref: ArbeitRef): Promise<void> {
  const index = await readIndex(workspace);
  index.current = ref.dir;
  await writeIndex(workspace, index);
}

/** "15s", "15 Seiten", "6000w", "6000 Wörter", "40000z" → Umfang (± `toleranz` %). */
export function parseUmfang(text: string, toleranz?: number): Umfang {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(s|seiten?|p|pages?|w|w(?:ö|oe)rter|words?|z|zeichen|chars?)?\s*$/i.exec(text);
  if (!m) throw new ImstudiumError(`Cannot read the length "${text}"`, "BAD_ARGS", undefined, "e.g. --umfang 15s (Seiten), 6000w (Wörter) or 40000z (Zeichen)");
  const value = Number(m[1]!.replace(",", "."));
  const u = (m[2] ?? "s").toLowerCase();
  const unit = /^(w|wö|woe|word)/.test(u) ? "woerter" : /^(z|char)/.test(u) ? "zeichen" : "seiten";
  return { value, unit, ...(toleranz !== undefined ? { toleranz } : {}) };
}

export function parseAbgabe(text: string): string {
  const t = text.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  throw new ImstudiumError(`Cannot read the date "${text}"`, "BAD_ARGS", undefined, "e.g. --abgabe 2027-03-15 or 15.03.2027");
}

export function parseArbeitTyp(text: string): ArbeitTyp {
  const t = text.trim().toLowerCase().replace(/ä/g, "ae");
  const hit = ARBEIT_TYPEN.find((x) => x === t || x.startsWith(t));
  if (!hit) throw new ImstudiumError(`Unknown --typ "${text}"`, "BAD_ARGS", undefined, `Choose from: ${ARBEIT_TYPEN.join(", ")}`);
  return hit;
}

/** Days from today (Europe/Berlin) to a YYYY-MM-DD date; negative when past. */
export function daysUntil(day: string, now = new Date()): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = dateKey(now).split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

export interface CreateArbeitInput {
  title: string;
  typ?: ArbeitTyp;
  stil?: string;
  preset?: string;
  sprache?: string;
  course?: ArbeitCourse | null;
  betreuung?: string | null;
  abgabe?: string | null;
  umfang?: Umfang | null;
  slug?: string;
  /** Create the Arbeit in this folder instead of `<workspace>/arbeiten/<slug>/`. */
  dir?: string;
  now?: Date;
}

/** Start an Arbeit: arbeit.json, an empty registry, quellen.bib and ARBEIT.md. */
export async function createArbeit(workspace: string, input: CreateArbeitInput): Promise<ArbeitRef> {
  const now = (input.now ?? new Date()).toISOString();
  const typ = input.typ ?? "hausarbeit";
  const preset = input.preset ?? (input.stil === "juristische-zitierweise" ? "juristisch" : "standard");
  const formvorgaben = formvorgabenPreset(preset);
  const styleId = input.stil ?? FORMVORGABEN_PRESETS[preset]!.stil;
  const slug = (input.slug ?? slugify(input.title)).toLowerCase().slice(0, 60);
  const dir = input.dir ? resolve(input.dir) : join(workspace, ARBEITEN_DIR, slug);
  if (existsSync(join(dir, ARBEIT_FILE))) {
    throw new ImstudiumError(`There is already an Arbeit in ${dir}`, "BAD_ARGS", undefined, "Pick another --slug or folder, or keep working on that one (imstudium arbeit show)", { dir });
  }
  const style = await loadStyle(styleId, input.dir ? dir : null);
  const arbeit: Arbeit = {
    schema: "imstudium/arbeit/v1",
    slug,
    title: input.title.trim(),
    typ,
    sprache: input.sprache ?? style.info.locale ?? "de-DE",
    course: input.course ?? null,
    betreuung: input.betreuung ?? null,
    abgabe: input.abgabe ?? null,
    umfang: input.umfang ?? null,
    stil: { id: style.info.id, title: style.info.title, file: style.info.source === "bundled" ? null : relative(dir, style.info.path), class: style.info.class },
    formvorgaben,
    manuskript: null,
    hilfsmittel: [],
    created: now,
    updated: now,
  };
  const ref: ArbeitRef = { dir, arbeit, inWorkspace: !input.dir };
  await mkdir(dir, { recursive: true });
  await saveArbeit(ref, { schema: "imstudium/quellen/v1", updatedAt: now, items: [] });
  const index = await readIndex(workspace);
  if (input.dir && !index.extern.includes(dir)) index.extern.push(dir);
  index.current = dir;
  await writeIndex(workspace, index);
  return ref;
}

export async function loadQuellen(dir: string): Promise<QuellenFile> {
  const file = await readJson<QuellenFile>(join(dir, QUELLEN_FILE));
  if (!file || !Array.isArray(file.items)) return { schema: "imstudium/quellen/v1", updatedAt: new Date(0).toISOString(), items: [] };
  return file;
}

/**
 * Write arbeit.json and, when given, the registry with everything derived
 * from it: quellen.json, quellen.bib and ARBEIT.md.
 */
export async function saveArbeit(ref: ArbeitRef, quellen?: QuellenFile, now = new Date()): Promise<void> {
  ref.arbeit.updated = now.toISOString();
  await writeAtomic(join(ref.dir, ARBEIT_FILE), `${JSON.stringify(ref.arbeit, null, 2)}\n`);
  const q = quellen ?? (await loadQuellen(ref.dir));
  if (quellen) {
    quellen.updatedAt = now.toISOString();
    await writeAtomic(join(ref.dir, QUELLEN_FILE), `${JSON.stringify(quellen, null, 2)}\n`);
    const header = `quellen.bib: ${q.items.length} Quellen der Arbeit „${ref.arbeit.title}“.\nVon ImStudium aus quellen.json erzeugt. Ändern mit imstudium quellen, nicht von Hand.`;
    await writeAtomic(join(ref.dir, BIB_FILE), exportLibrary(q.items.map((i) => i.csl), "biblatex", header));
  }
  const briefPath = join(ref.dir, BRIEF_FILE);
  let notes = "";
  try {
    notes = /## Student notes\n\n([\s\S]*?)\s*$/.exec(await readFile(briefPath, "utf-8"))?.[1] ?? "";
  } catch {
    // first write
  }
  await writeAtomic(briefPath, arbeitBrief(ref, q, now, notes));
}

const CHECK_LABEL: Record<string, string> = {
  verified: "geprüft",
  mismatch: "weicht ab",
  "not-found": "nicht gefunden",
  retracted: "zurückgezogen",
  unverified: "ungeprüft",
};

/** The agent brief: what the work is, its rules, its sources and the next commands. */
export function arbeitBrief(ref: ArbeitRef, quellen: QuellenFile, now = new Date(), notes = ""): string {
  const a = ref.arbeit;
  const head = [ARBEIT_TYP_LABEL[a.typ], a.course?.title, a.abgabe ? `Abgabe ${a.abgabe.split("-").reverse().join(".")} (${daysLabel(daysUntil(a.abgabe, now))})` : null, a.umfang ? `Umfang ${a.umfang.value} ${a.umfang.unit === "woerter" ? "Wörter" : a.umfang.unit === "zeichen" ? "Zeichen" : "Seiten"}${a.umfang.toleranz ? ` ± ${a.umfang.toleranz} %` : ""}` : null]
    .filter(Boolean)
    .join(" · ");
  const counts = { verified: 0, problem: 0, open: 0 };
  for (const q of quellen.items) {
    const s = q.check?.status;
    if (s === "verified") counts.verified++;
    else if (s === "mismatch" || s === "not-found" || s === "retracted") counts.problem++;
    else counts.open++;
  }
  const rows = quellen.items.map((q) => `| \`${q.key}\` | ${creatorsShort(q.csl).replace(/\|/g, "/")} (${yearOf(q.csl.issued) ?? "o. J."}) | ${(q.csl.title ?? "").replace(/\|/g, "/").slice(0, 80)} | ${q.csl.type} | ${CHECK_LABEL[q.check?.status ?? "unverified"]} |`);
  return [
    `# ${a.title}`,
    "",
    head,
    "",
    `Zitierstil: ${a.stil.title} (\`${a.stil.id}\`, ${a.stil.class === "note" ? "Fußnoten" : "im Text"}) · Sprache ${a.sprache}`,
    "",
    "## Quellen",
    "",
    quellen.items.length ? `${quellen.items.length} Quellen · ${counts.verified} geprüft · ${counts.problem} mit Problem · ${counts.open} ungeprüft` : "Noch keine Quellen. `imstudium quellen add <DOI|ISBN|URL>` nimmt die erste auf.",
    "",
    ...(rows.length ? ["| Key | Autor (Jahr) | Titel | Typ | Prüfung |", "|---|---|---|---|---|", ...rows, ""] : []),
    "## Formvorgaben",
    "",
    ...formvorgabenLines(a.formvorgaben).map((l) => `- ${l}`),
    "",
    ...(a.hilfsmittel.length ? ["## Hilfsmittel", "", ...a.hilfsmittel.map((h) => `- ${h.werkzeug}: ${h.zweck} (${h.at.slice(0, 10)})`), ""] : []),
    "## Dateien",
    "",
    "- `quellen.json`: das Quellenregister (CSL-JSON mit Herkunft und Prüfstatus). Nur über `imstudium quellen` ändern.",
    "- `quellen.bib`: BibLaTeX für LaTeX (`\\addbibresource{quellen.bib}`), Typst (`#bibliography(\"quellen.bib\")`) und Pandoc (`--bibliography quellen.bib`). Wird bei jeder Änderung neu geschrieben.",
    "- `stil/`: Zitierstile dieser Arbeit (CSL). `vorlage/`: Vorlagen aus `imstudium arbeit vorlage`.",
    "",
    "## Befehle",
    "",
    "- `imstudium quellen add <DOI|ISBN|arXiv|URL>`: Quelle aus der Normdatei aufnehmen (prüft gleich mit)",
    "- `imstudium quellen check --save`: jede Quelle gegen doi.org, Crossref und DNB prüfen, auch auf Rückzüge",
    "- `imstudium zitieren <key>@<Seite>`: Beleg im Zitierstil · `imstudium literatur`: Literaturverzeichnis",
    "- `imstudium arbeit check <manuskript>`: Manuskript gegen Register und Formvorgaben prüfen",
    "",
    "Regel: Nur zitieren, was im Register steht und geprüft ist. Keine Quelle erfinden, keine Metadaten raten.",
    "",
    "## Student notes",
    "",
    notes,
    "",
  ].join("\n");
}

function daysLabel(days: number): string {
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  if (days < 0) return `vor ${-days} Tagen`;
  return `in ${days} Tagen`;
}

// ── Registry operations (pure on the QuellenFile) ──────────────────────────

/** The entry that is the same work as `item`: same DOI, same ISBN, or same first author, year and (nearly) title. */
export function findDuplicate(file: QuellenFile, item: CslFields): Quelle | undefined {
  const doi = item.DOI?.toLowerCase();
  const isbn = itemIsbn(item as CslItem);
  const family = firstCreatorFamily(item as CslItem);
  const year = yearOf(item.issued);
  return file.items.find((q) => {
    if (doi && q.csl.DOI?.toLowerCase() === doi) return true;
    if (isbn && itemIsbn(q.csl) === isbn) return true;
    if (doi && q.csl.DOI && q.csl.DOI.toLowerCase() !== doi) return false;
    const sameAuthor = !!family && normalizeForCompare(firstCreatorFamily(q.csl) ?? "") === normalizeForCompare(family);
    return sameAuthor && yearOf(q.csl.issued) === year && similarity(q.csl.title ?? "", item.title ?? "") >= 0.9;
  });
}

export interface AddResult {
  quelle: Quelle;
  /** True when the work was already in the registry; `quelle` is the existing entry. */
  duplicate: boolean;
}

/** Add an item (CSL without id is fine) and give it a citekey; an existing work is returned instead. */
export function addQuelle(
  file: QuellenFile,
  item: CslFields & { id?: string },
  origin: Omit<QuelleOrigin, "at">,
  opts: { key?: string; file?: string | null; tags?: string[]; notes?: string; now?: Date; check?: Quelle["check"] } = {},
): AddResult {
  const dup = findDuplicate(file, item);
  if (dup) return { quelle: dup, duplicate: true };
  if (opts.key && !isValidCitekey(opts.key)) {
    throw new ImstudiumError(`"${opts.key}" is not a usable citekey`, "BAD_ARGS", undefined, "Letters, digits and _ : . + - only, starting with a letter (e.g. mueller2021)");
  }
  if (opts.key && file.items.some((q) => q.key === opts.key)) {
    throw new ImstudiumError(`The key "${opts.key}" is taken`, "BAD_ARGS", undefined, "Pick another --key, or leave it out and ImStudium picks one");
  }
  const at = (opts.now ?? new Date()).toISOString();
  const taken = new Set(file.items.map((q) => q.key));
  const key = opts.key ?? assignCitekey(item as CslItem, taken, item.id);
  const { id: _drop, ...rest } = item;
  const quelle: Quelle = {
    key,
    csl: { ...rest, id: key } as CslItem,
    origin: { ...origin, at },
    ...(opts.check ? { check: opts.check } : {}),
    ...(opts.file ? { file: opts.file } : {}),
    ...(opts.tags?.length ? { tags: opts.tags } : {}),
    ...(opts.notes ? { notes: opts.notes } : {}),
    added: at,
    updated: at,
  };
  file.items.push(quelle);
  return { quelle, duplicate: false };
}

export function getQuelle(file: QuellenFile, key: string): Quelle {
  const q = file.items.find((x) => x.key === key) ?? file.items.find((x) => x.key.toLowerCase() === key.toLowerCase());
  if (!q) {
    throw new ImstudiumError(`No source "${key}" in this Arbeit`, "SOURCE_NOT_FOUND", undefined, "imstudium quellen lists the keys", {
      key,
      similar: file.items.map((x) => x.key).filter((k) => similarity(k, key) > 0.6).slice(0, 5),
    });
  }
  return q;
}

export function removeQuelle(file: QuellenFile, key: string): Quelle {
  const q = getQuelle(file, key);
  file.items = file.items.filter((x) => x !== q);
  return q;
}

/** Rename a citekey (the manuscript must follow; `arbeit check` finds the old one). */
export function renameQuelle(file: QuellenFile, key: string, next: string, now = new Date()): Quelle {
  const q = getQuelle(file, key);
  if (!isValidCitekey(next)) throw new ImstudiumError(`"${next}" is not a usable citekey`, "BAD_ARGS");
  if (file.items.some((x) => x.key === next && x !== q)) throw new ImstudiumError(`The key "${next}" is taken`, "BAD_ARGS");
  q.key = next;
  q.csl.id = next;
  q.updated = now.toISOString();
  return q;
}
