import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeLlmsTxt } from "./studium.js";
import type { StudiumWorkspace } from "./types.js";

function workspace(): StudiumWorkspace {
  return {
    schemaVersion: "2",
    generatedAt: "2026-10-19T08:00:00.000Z",
    instanceUrl: "https://studip.example.edu",
    user: { id: "u1", name: "Beispiel Studentin" },
    activeSemester: { id: "s1", title: "WS 2026/27", slug: "WS2026-27", isCurrent: true, weekNumber: 1, progressPercent: 4 },
    otherSemesters: [],
    workspaceFolder: "WS2026-27",
    semesters: ["WS 2026/27"],
    courses: [
      {
        id: "c1",
        title: "Beispielkurs Statistik",
        slug: "Beispielkurs-Statistik",
        path: "WS2026-27/Beispielkurs-Statistik",
        schedule: [],
        examDates: [],
        fileCount: 3,
        folderCount: 1,
        search: { corpusPath: "WS2026-27/Beispielkurs-Statistik/search/corpus.jsonl", chunkCount: 12 },
      },
    ],
    nextDeadlines: [],
    search: { chunkCount: 12, courseCount: 1 },
  };
}

describe("llms.txt", () => {
  it("sends agents to context first, then the root files, search and archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "imstudium-llms-"));
    await writeLlmsTxt(root, workspace());
    const text = await readFile(join(root, "llms.txt"), "utf-8");

    const start = text.indexOf("## Start here");
    expect(text.indexOf("imstudium context --json", start)).toBeGreaterThan(start);
    for (const file of ["NEW.md", "abgaben.md", "stundenplan.md", "klausuren.md", "studium.json"]) {
      expect(text).toContain(`[${file}](${file})`);
    }
    expect(text).toContain("imstudium search");
    for (const dir of ["news/", "forum/", "courseware/", "wiki/", "archive/"]) {
      expect(text).toContain(dir);
    }
    expect(text).toContain("[WS2026-27/Beispielkurs-Statistik/](WS2026-27/Beispielkurs-Statistik/)");
    expect(text).toContain("12 indexed pages across 1 courses.");
  });

  it("drops claims the pipeline no longer makes", async () => {
    const root = await mkdtemp(join(tmpdir(), "imstudium-llms-"));
    await writeLlmsTxt(root, workspace());
    const text = await readFile(join(root, "llms.txt"), "utf-8");
    expect(text).not.toMatch(/page-N+\.png/);
    expect(text).not.toContain("does not ship a custom search command");
  });
});
