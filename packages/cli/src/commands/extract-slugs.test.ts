import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CLI_OUTPUTS, envelopeV1 } from "@imstudium/contract";
import { extractSlug, slugify } from "@imstudium/sdk";
import { makeFixture, runCli, type Fixture } from "../test/harness.js";

/**
 * `extract` on a synthetic workspace where two long paths shared one folder
 * under the old slug rule: the folder moves, the count is reported, and a
 * folder whose new name is taken is kept and named in the hints.
 */

const oldSlug = (rel: string) => `${slugify(rel.replace(/\.[^.]+$/, ""))}-${extname(rel).slice(1).toLowerCase() || "file"}`;
const GROUP = "Gruppenordner der Übung 4 - Donnerstags, 08_15-09_45, Raum 2.013 im Gebäude B (Nordflügel)";
const LONG_A = `${GROUP}/Rückgabe Blatt 2/Abgabe_B2_Gruppe7.txt`;
const LONG_B = `${GROUP}/Rückgabe Blatt 3/Abgabe_B3_Gruppe7.txt`;

let fx: Fixture;
let course: string;

beforeAll(async () => {
  fx = await makeFixture();
  course = join(fx.workspace, "WS2026-27", "statistik-i");
  for (const [rel, text] of [[LONG_A, "Erwartungswert und Varianz einer Zufallsvariable"], [LONG_B, "Bedingte Wahrscheinlichkeit und der Satz von Bayes"]] as const) {
    await mkdir(join(course, "files", rel, ".."), { recursive: true });
    await writeFile(join(course, "files", rel), text);
  }
  // B extracted last into the folder both shared, as before the hashed slug.
  const b = join(course, "files", LONG_B);
  const s = await stat(b);
  const old = join(course, "extracted", oldSlug(LONG_B));
  await mkdir(old, { recursive: true });
  await writeFile(join(old, "manifest.json"), JSON.stringify({ schemaVersion: "1", source: b, kind: "text", pages: 1, tool: "passthrough", extractedAt: "2026-11-01T10:00:00.000Z", sourceMtimeMs: s.mtimeMs, sourceSize: s.size }));
  await writeFile(join(old, "content.md"), "# B\n\nBedingte Wahrscheinlichkeit und der Satz von Bayes\n");
});

describe("extract moves folders named under the old slug rule", () => {
  it("says how many moved, and each long path has its own folder", async () => {
    expect(oldSlug(LONG_A)).toBe(oldSlug(LONG_B));
    const r = runCli(fx, ["extract", "--course", "statistik", "--no-ocr", "--no-math"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("Moved 1 extracted folder(s) of long file names to their new name");
    const folders = await readdir(join(course, "extracted"));
    expect(folders).toEqual(expect.arrayContaining([extractSlug(LONG_A), extractSlug(LONG_B)]));
    expect(folders).not.toContain(oldSlug(LONG_B));
  });

  it("--json: migrated counts the moves, and a folder whose new name is taken is kept and named in hints", async () => {
    const b = join(course, "files", LONG_B);
    const stale = join(course, "extracted", oldSlug(LONG_B));
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, "manifest.json"), JSON.stringify({ source: b }));

    const r = runCli(fx, ["--json", "extract", "--course", "statistik", "--no-ocr", "--no-math"]);
    expect(r.status, r.stderr).toBe(0);
    const parsed = envelopeV1(CLI_OUTPUTS.extract).safeParse(r.json());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    const out = r.json() as { migrated: number; hints: string[]; results: Array<{ source: string; skipped?: boolean }> };
    expect(out.migrated).toBe(0);
    expect(out.hints).toContainEqual(expect.stringContaining(`WS2026-27/statistik-i/extracted/${oldSlug(LONG_B)} holds files/${LONG_B}, whose folder is now extracted/${extractSlug(LONG_B)}`));
    expect(out.results.filter((x) => x.source.endsWith(".txt")).every((x) => x.skipped)).toBe(true);
    expect(await readdir(stale)).toEqual(["manifest.json"]);
  });
});
