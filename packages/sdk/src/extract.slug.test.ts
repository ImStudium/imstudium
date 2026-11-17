import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { slugify } from "./config.js";
import { Extractor, extractSlug, isSameSource, migrateExtractFolders, type ExtractFolderMigration } from "./extract.js";
import { loadSearchDocs, rankDocs } from "./search.js";

/**
 * Folder names under extracted/ for long paths, the "unchanged" check, and
 * moving folders named under the old rule. Every path and text here is made
 * up; the PDFs are hand-written.
 */

/** The rule before the hashed slug: the path's slug cut at 80 characters, then the extension. */
const oldSlug = (rel: string) => `${slugify(rel.replace(/\.[^.]+$/, ""))}-${extname(rel).slice(1).toLowerCase() || "file"}`;

const GROUP = "Gruppenordner der Übung 4 - Donnerstags, 08_15-09_45, Raum 2.013 im Gebäude B (Nordflügel)";
const LONG_A = `${GROUP}/Rückgabe Blatt 2/Abgabe_B2_Gruppe7_korrigiert.pdf`;
const LONG_B = `${GROUP}/Rückgabe Blatt 3/Blatt3_Gruppe7_mit_Anmerkungen.pdf`;
const VIDEOS = [
  "Kapitel 8_ Sperrverfahren/Kapitel 08-Sperrverfahren-2-Zweiphasensperrprotokoll-und-Deadlocks-2025-01-14-ERSATZ-1.mp4",
  "Kapitel 8_ Sperrverfahren/Kapitel 08-Sperrverfahren-2-Zweiphasensperrprotokoll-und-Deadlocks-2025-01-14-ERSATZ-2.mp4",
  "Kapitel 8_ Sperrverfahren/Kapitel 08-Sperrverfahren-2-Zweiphasensperrprotokoll-und-Deadlocks-2025-01-16.mp4",
];

describe("extractSlug", () => {
  it("leaves every name that fits in 80 characters as it was", () => {
    const short = [
      "Blatt01.pdf",
      "Übungen/Blatt01.pdf",
      "Lösungen/Blatt01.pdf",
      "Folien/VL 03 – Zufallsvariablen.PPTX",
      "README",
      `${"x".repeat(80)}.pdf`,
      `Ordner/${"y".repeat(73)}.pdf`,
    ];
    for (const rel of short) expect(extractSlug(rel), rel).toBe(oldSlug(rel));
    expect(extractSlug("Übungen/Blatt01.pdf")).toBe("Ubungen-Blatt01-pdf");
    expect(extractSlug(`${"x".repeat(80)}.pdf`)).toBe(`${"x".repeat(80)}-pdf`);
  });

  it("gives a long path its first 71 characters, 8 hex digits of the SHA-1 of the path, and the extension", () => {
    const sha = createHash("sha1").update(LONG_A).digest("hex").slice(0, 8);
    expect(extractSlug(LONG_A)).toBe(`${oldSlug(LONG_A).slice(0, 71)}-${sha}-pdf`);
    expect(extractSlug(LONG_A)).toMatch(/^[A-Za-z0-9-]{71}-[0-9a-f]{8}-pdf$/);
    expect(extractSlug(`${"x".repeat(81)}.pdf`)).toMatch(/^x{71}-[0-9a-f]{8}-pdf$/);
  });

  it("gives every file of a group that shared one folder a folder of its own", () => {
    const sheets = Array.from({ length: 15 }, (_, i) => `${GROUP}/Rückgabe Blatt ${i + 1}/Blatt${i + 1}_Gruppe7.pdf`);
    for (const group of [[LONG_A, LONG_B], sheets, VIDEOS]) {
      expect(new Set(group.map(oldSlug)).size, "the old rule gave them one folder").toBe(1);
      expect(new Set(group.map(extractSlug)).size).toBe(group.length);
    }
  });

  it("is the same on every run and for either Unicode form of the path", () => {
    expect(extractSlug(LONG_A)).toBe(extractSlug(LONG_A));
    expect(extractSlug(LONG_A.normalize("NFD"))).toBe(extractSlug(LONG_A.normalize("NFC")));
    // Pinned: a change to the rule moves every long-named folder again.
    expect(extractSlug(`${"Kapitel ".repeat(12)}Ende.pdf`)).toBe(`${"Kapitel-".repeat(8)}Kapitel-${createHash("sha1").update(`${"Kapitel ".repeat(12)}Ende.pdf`).digest("hex").slice(0, 8)}-pdf`);
  });
});

describe("isSameSource", () => {
  const course = "/ws/WS2026-27/Statistik-I";
  const outDir = `${course}/extracted/${extractSlug("Blatt/A.pdf")}`;

  it("is the manifest's own path, not another file's", () => {
    expect(isSameSource(`${course}/files/Blatt/A.pdf`, `${course}/files/Blatt/A.pdf`, outDir)).toBe(true);
    expect(isSameSource(`${course}/files/Blatt/B.pdf`, `${course}/files/Blatt/A.pdf`, outDir)).toBe(false);
    expect(isSameSource(undefined, `${course}/files/Blatt/A.pdf`, outDir)).toBe(false);
  });

  it("keeps a file the same after the workspace moved, by its path below files/", () => {
    expect(isSameSource("/old/Studium/WS2026-27/Statistik-I/files/Blatt/A.pdf", `${course}/files/Blatt/A.pdf`, outDir)).toBe(true);
    expect(isSameSource("/old/Studium/WS2026-27/Statistik-I/files/Blatt/B.pdf", `${course}/files/Blatt/A.pdf`, outDir)).toBe(false);
    expect(isSameSource("/old/Studium/WS2026-27/Statistik-I/files/A.pdf", `${course}/files/Blatt/A.pdf`, outDir)).toBe(false);
  });

  it("outside a course's extracted/ (extract --file) only the same path counts", () => {
    expect(isSameSource("/old/x/files/A.pdf", "/new/x/files/A.pdf", "/new/x/files/A-extracted")).toBe(false);
    expect(isSameSource("/new/x/A.pdf", "/new/x/A.pdf", "/new/x/A-extracted")).toBe(true);
  });
});

let root: string;
let courseDir: string;
let filesDir: string;
let outRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "imstudium-slug-"));
  courseDir = join(root, "Studium", "WS2026-27", "Statistik-I");
  filesDir = join(courseDir, "files");
  outRoot = join(courseDir, "extracted");
  await mkdir(outRoot, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(rel: string, body: string | Uint8Array): Promise<string> {
  const p = join(filesDir, rel);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, body);
  return p;
}

/** An extraction folder as a run before the hashed slug left it: manifest, content.md and what else is named. */
async function oldFolder(name: string, source: string, extra: Record<string, string> = {}): Promise<string> {
  const dir = join(outRoot, name);
  await mkdir(dir, { recursive: true });
  const s = await stat(source);
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ schemaVersion: "1", source, kind: "text", pages: 1, tool: "passthrough", extractedAt: "2026-11-01T10:00:00.000Z", sourceMtimeMs: s.mtimeMs, sourceSize: s.size }));
  await writeFile(join(dir, "content.md"), `# ${source}\n\nold text\n`);
  for (const [rel, body] of Object.entries(extra)) {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), body);
  }
  return dir;
}

const listing = async (dir: string): Promise<string[]> => (await readdir(dir, { recursive: true })).map(String).sort();

describe("the unchanged check", () => {
  it("re-extracts a folder that holds another file's extraction, even with the same size and mtime", async () => {
    const a = await put("A.txt", "Erwartungswert der Summe zweier Zufallsvariablen");
    const b = await put("B.txt", "Varianz der Summe zweier unabhaengiger Variablen");
    const when = new Date("2026-11-02T09:00:00Z");
    await utimes(a, when, when);
    await utimes(b, when, when);
    expect((await stat(a)).size).toBe((await stat(b)).size);

    const shared = join(outRoot, "shared-txt");
    const x = new Extractor({ anydoc: true, pdfInspector: true });
    expect((await x.extractFile(a, shared)).skipped).toBeUndefined();
    const second = await x.extractFile(b, shared);
    expect(second.skipped, "B is not A's unchanged extraction").toBeUndefined();
    expect(JSON.parse(await readFile(join(shared, "manifest.json"), "utf-8")).source).toBe(b);
    expect(await readFile(join(shared, "content.md"), "utf-8")).toContain("Varianz");
    expect((await x.extractFile(b, shared)).skipped).toBe(true);
  });

  it("still skips a file whose workspace moved (semester start, a copy)", async () => {
    const a = await put("Blatt/A.txt", "Erwartungswert der Summe zweier Zufallsvariablen");
    // Whole seconds, so the copy's mtime is the same to the nanosecond (as cp -a keeps it).
    await utimes(a, new Date("2026-11-02T09:00:00Z"), new Date("2026-11-02T09:00:00Z"));
    const x = new Extractor({ anydoc: true, pdfInspector: true });
    await x.extractDir(filesDir, outRoot);
    const moved = join(root, "Kopie", "WS2026-27", "Statistik-I");
    await cp(courseDir, moved, { recursive: true, preserveTimestamps: true });
    const [r] = await x.extractDir(join(moved, "files"), join(moved, "extracted"));
    expect(r?.skipped).toBe(true);
  });
});

describe("migrateExtractFolders", () => {
  const EXTRA = {
    "pages/page-1.png": "png",
    "formulas.checked.json": "{}",
    "math.json": "{}",
    "formulas/p1-1.png": "png",
    "transcript.json": "{}",
    "audio.mp3": "mp3",
    "viewer.html": "<html></html>",
  };

  it("renames a long path's old folder to its new name with everything in it", async () => {
    const b = await put(LONG_B, "Blatt 3");
    await put(LONG_A, "Blatt 2");
    const old = await oldFolder(oldSlug(LONG_B), b, EXTRA);
    const before = await listing(old);

    const m = await migrateExtractFolders(filesDir, outRoot);
    expect(m).toEqual({ moved: [{ from: oldSlug(LONG_B), to: extractSlug(LONG_B), source: LONG_B }], kept: [] });
    expect(await readdir(outRoot)).toEqual([extractSlug(LONG_B)]);
    expect(await listing(join(outRoot, extractSlug(LONG_B)))).toEqual(before);
    expect(await migrateExtractFolders(filesDir, outRoot)).toEqual({ moved: [], kept: [] });
  });

  it("leaves both folders when the new name is taken, and reports it", async () => {
    const b = await put(LONG_B, "Blatt 3");
    await oldFolder(oldSlug(LONG_B), b, { "formulas.checked.json": "{}" });
    await oldFolder(extractSlug(LONG_B), b);
    const m = await migrateExtractFolders(filesDir, outRoot);
    expect(m).toEqual({ moved: [], kept: [{ from: oldSlug(LONG_B), to: extractSlug(LONG_B), source: LONG_B }] });
    expect((await readdir(outRoot)).sort()).toEqual([oldSlug(LONG_B), extractSlug(LONG_B)].sort());
    expect(await listing(join(outRoot, oldSlug(LONG_B)))).toEqual(["content.md", "formulas.checked.json", "manifest.json"]);
  });

  it("leaves folders without a manifest, of a file that is gone, and of short names alone", async () => {
    await put(LONG_A, "Blatt 2");
    await put(LONG_B, "Blatt 3");
    const short = await put("Blatt01.pdf", "Blatt 1");
    // A recording's folder with only its transcript: no manifest.json.
    await mkdir(join(outRoot, oldSlug(LONG_A)));
    await writeFile(join(outRoot, oldSlug(LONG_A), "transcript.json"), "{}");
    // The extraction of a long path that is no longer in files/.
    await mkdir(join(outRoot, "weg-pdf"));
    await writeFile(join(outRoot, "weg-pdf", "manifest.json"), JSON.stringify({ source: join(filesDir, `${GROUP}/Rückgabe Blatt 9/weg.pdf`) }));
    await oldFolder(extractSlug("Blatt01.pdf"), short);
    await writeFile(join(outRoot, "stray.json"), "{}");
    const before = await listing(outRoot);

    expect(await migrateExtractFolders(filesDir, outRoot)).toEqual({ moved: [], kept: [] });
    expect(await listing(outRoot)).toEqual(before);
  });

  it("finds the file after the workspace moved, and frees a short name a long path's extraction sat in", async () => {
    // Under the old rule a path whose slug is exactly 80 characters and a longer one starting the same got one folder.
    const stem = "s".repeat(80);
    await put(`${stem}.txt`, "kurz");
    const long = await put(`${stem}-zweiter-Teil.txt`, "lang");
    expect(oldSlug(`${stem}-zweiter-Teil.txt`)).toBe(extractSlug(`${stem}.txt`));
    await oldFolder(extractSlug(`${stem}.txt`), long);
    await writeFile(join(outRoot, extractSlug(`${stem}.txt`), "manifest.json"), JSON.stringify({ source: `/old/Studium/WS2026-27/Statistik-I/files/${stem}-zweiter-Teil.txt` }));

    const m = await migrateExtractFolders(filesDir, outRoot);
    expect(m.moved).toEqual([{ from: extractSlug(`${stem}.txt`), to: extractSlug(`${stem}-zweiter-Teil.txt`), source: `${stem}-zweiter-Teil.txt` }]);
    expect(await readdir(outRoot)).toEqual([extractSlug(`${stem}-zweiter-Teil.txt`)]);
  });
});

/** A one-page PDF with one line of Helvetica text (hand-written, synthetic). */
function textPdf(text: string): Uint8Array {
  const content = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

describe("extract end to end: two long PDF paths that shared a folder", () => {
  it("moves the old folder, extracts the other file next to it, and both are searchable", async () => {
    const a = await put(LONG_A, textPdf("Die Kovarianzmatrix eines Zufallsvektors ist symmetrisch und positiv semidefinit."));
    const b = await put(LONG_B, textPdf("Eine Markovkette mit endlichem Zustandsraum hat eine stationaere Verteilung."));
    const x = new Extractor();
    // The state a run before the fix left: B extracted last into the folder both paths shared, with a correction kept there.
    await x.extractFile(b, join(outRoot, oldSlug(LONG_B)), { ocr: false, math: false });
    await writeFile(join(outRoot, oldSlug(LONG_B), "formulas.checked.json"), "{}");
    expect(oldSlug(LONG_A)).toBe(oldSlug(LONG_B));

    const course = { title: "Statistik I", path: "WS2026-27/Statistik-I" };
    const migrations: ExtractFolderMigration[] = [];
    const results = await x.extractDir(filesDir, outRoot, { ocr: false, math: false, course, workspaceRoot: join(root, "Studium"), onMigrate: (m) => migrations.push(m) });

    expect(migrations).toEqual([{ moved: [{ from: oldSlug(LONG_B), to: extractSlug(LONG_B), source: LONG_B }], kept: [] }]);
    expect((await readdir(outRoot)).sort()).toEqual([extractSlug(LONG_A), extractSlug(LONG_B)].sort());
    expect(await readdir(join(outRoot, extractSlug(LONG_B)))).toContain("formulas.checked.json");
    const bySource = new Map(results.map((r) => [r.source, r]));
    expect(bySource.get(b)?.skipped, "B's extraction moved with its folder").toBe(true);
    expect(bySource.get(a)?.error).toBeUndefined();
    expect(bySource.get(a)?.skipped).toBeUndefined();

    const docs = await loadSearchDocs(join(root, "Studium"));
    expect(rankDocs(docs, "Kovarianzmatrix")[0]?.path).toBe(`WS2026-27/Statistik-I/extracted/${extractSlug(LONG_A)}/content.md`);
    expect(rankDocs(docs, "Markovkette")[0]?.path).toBe(`WS2026-27/Statistik-I/extracted/${extractSlug(LONG_B)}/content.md`);

    // The next run: nothing moves, nothing is extracted again.
    const again: ExtractFolderMigration[] = [];
    const rerun = await x.extractDir(filesDir, outRoot, { ocr: false, math: false, course, workspaceRoot: join(root, "Studium"), onMigrate: (m) => again.push(m) });
    expect(again).toEqual([{ moved: [], kept: [] }]);
    expect(rerun.every((r) => r.skipped)).toBe(true);
  });
});
