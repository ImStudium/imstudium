import { mkdtemp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyRollover, listArchivedSemesters, planRollover, rewriteRelativeRefs, semesterSortKey } from "./rollover.js";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "imstudium-rollover-"));
  await mkdir(join(root, "SS2026", "Statistik", "search"), { recursive: true });
  await mkdir(join(root, "SS2026", "Statistik", "files"), { recursive: true });
  await writeFile(join(root, "SS2026", "Statistik", "files", "blatt1.pdf"), "x");
  await writeFile(
    join(root, "SS2026", "Statistik", "search", "corpus.jsonl"),
    JSON.stringify({ ref: "SS2026/Statistik#blatt1.pdf:1", coursePath: "SS2026/Statistik", text: "SS2026/ stays in text" }) + "\n",
  );
  await writeFile(
    join(root, "studium.json"),
    JSON.stringify({
      schemaVersion: "2",
      workspaceFolder: "SS2026",
      activeSemester: { id: "s1", title: "SS 2026", slug: "SS2026", isCurrent: true },
      courses: [{ id: "c1", title: "Statistik", slug: "Statistik", path: "SS2026/Statistik", schedule: [], examDates: [], fileCount: 1, folderCount: 0 }],
      nextDeadlines: [],
      otherSemesters: [],
      semesters: ["SS 2026"],
    }),
  );
  await writeFile(join(root, "STUDIUM.md"), "# SS 2026");
  await mkdir(join(root, "WS2026-27"), { recursive: true });
  return root;
}

describe("rollover", () => {
  it("plans to archive every semester folder except the current one", async () => {
    const root = await workspace();
    const plan = await planRollover(root, "WS2026-27");
    expect(plan.moves.map((m) => m.slug)).toEqual(["SS2026"]);
    expect(plan.conflicts).toEqual([]);
  });

  it("moves the folder, rewrites search refs and sync state, and snapshots the overview", async () => {
    const root = await workspace();
    const stateFile = join(root, "sync-state.json");
    await writeFile(
      stateFile,
      JSON.stringify({ version: 1, entries: { f1: { fileRefId: "f1", localPath: join(root, "SS2026/Statistik/files/blatt1.pdf"), downloadedAt: "x" } } }),
    );
    const result = await applyRollover(await planRollover(root, "WS2026-27"), { syncStateFile: stateFile });
    expect(result.moved).toEqual(["SS2026"]);
    await access(join(root, "archive", "SS2026", "Statistik", "files", "blatt1.pdf"));

    const corpus = JSON.parse(await readFile(join(root, "archive/SS2026/Statistik/search/corpus.jsonl"), "utf-8"));
    expect(corpus.ref).toBe("archive/SS2026/Statistik#blatt1.pdf:1");
    expect(corpus.coursePath).toBe("archive/SS2026/Statistik");
    expect(corpus.text).toBe("SS2026/ stays in text");

    const state = JSON.parse(await readFile(stateFile, "utf-8"));
    expect(state.entries.f1.localPath).toBe(join(root, "archive/SS2026/Statistik/files/blatt1.pdf"));

    const snap = JSON.parse(await readFile(join(root, "archive/SS2026/semester.json"), "utf-8"));
    expect(snap.workspaceFolder).toBe("archive/SS2026");
    expect(snap.courses[0].path).toBe("archive/SS2026/Statistik");
    expect(await readFile(join(root, "archive/SS2026/STUDIUM.md"), "utf-8")).toBe("# SS 2026");

    const listed = await listArchivedSemesters(root);
    expect(listed).toEqual([{ slug: "SS2026", title: "SS 2026", courses: 1, path: "archive/SS2026" }]);
  });

  it("never overwrites an existing archive folder", async () => {
    const root = await workspace();
    await mkdir(join(root, "archive", "SS2026"), { recursive: true });
    const plan = await planRollover(root, "WS2026-27");
    expect(plan.moves).toEqual([]);
    expect(plan.conflicts).toEqual(["SS2026"]);
  });

  it("only rewrites references that start with the slug", () => {
    expect(rewriteRelativeRefs('{"ref":"SS2026/A#x:1","t":"see SS2026/A"}', "SS2026")).toBe(
      '{"ref":"archive/SS2026/A#x:1","t":"see SS2026/A"}',
    );
  });

  it("orders semesters chronologically", () => {
    expect(semesterSortKey("WS2026-27")).toBeGreaterThan(semesterSortKey("SS2026"));
    expect(semesterSortKey("SS2026")).toBeGreaterThan(semesterSortKey("WS2025-26"));
  });
});
