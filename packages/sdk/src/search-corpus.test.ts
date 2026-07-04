import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  agentSearchGuidance,
  isIndexableSection,
  pageRef,
  parseContentMdSections,
  parsePageRef,
  parseExtractionChunks,
} from "./search-corpus.js";
import type { StudiumWorkspace } from "./types.js";

describe("parseContentMdSections", () => {
  it("splits page headings", () => {
    const md = `# foo.pdf\n\n> meta\n\n## Page 1\n\nHello world\n\n## Page 2\n\nMatrix algebra`;
    const sections = parseContentMdSections(md);
    expect(sections).toHaveLength(2);
    expect(sections[0].page).toBe(1);
    expect(sections[0].text).toContain("Hello world");
  });
});

describe("isIndexableSection", () => {
  it("skips empty placeholder pages without images", () => {
    expect(isIndexableSection("_(no extractable text — check the page image)_", false)).toBe(false);
    expect(isIndexableSection("Short", false)).toBe(false);
  });

  it("keeps meaningful text or image-only slides", () => {
    expect(isIndexableSection("Gradient descent minimizes the loss function over batches.", false)).toBe(true);
    expect(isIndexableSection("", true)).toBe(true);
  });
});

describe("pageRef", () => {
  it("round-trips", () => {
    const ref = pageRef("SS2026/Data-Engineering", "lecture.pdf", 5);
    expect(parsePageRef(ref)?.page).toBe(5);
  });
});

describe("parseExtractionChunks", () => {
  it("indexes only meaningful pages", async () => {
    const dir = mkdtempSync(join(tmpdir(), "is-chunk-"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ source: "/tmp/x.pdf", kind: "pdf" }));
    writeFileSync(
      join(dir, "content.md"),
      `# x.pdf\n\n## Page 1\n\n_(no extractable text — check the page image)_\n\n## Page 2\n\nBackpropagation through time in recurrent networks.`,
    );
    const chunks = await parseExtractionChunks(dir, {
      workspaceRoot: "/Studium",
      courseTitle: "Test",
      coursePath: "SS2026/Test",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].page).toBe(2);
  });
});

describe("agentSearchGuidance", () => {
  it("points agents at native grep, not a custom search tool", () => {
    const wsRoot = mkdtempSync(join(tmpdir(), "is-ws-"));
    mkdirSync(join(wsRoot, "SS2026/Test/search"), { recursive: true });
    const workspace = {
      schemaVersion: "2",
      generatedAt: new Date().toISOString(),
      instanceUrl: "https://example.edu",
      activeSemester: { slug: "SS2026", title: "SS 2026", id: "1", isCurrent: true },
      otherSemesters: [],
      workspaceFolder: "SS2026",
      semesters: ["SS 2026"],
      courses: [],
      nextDeadlines: [],
      search: { chunkCount: 10, courseCount: 1 },
    } satisfies StudiumWorkspace;

    const g = agentSearchGuidance(wsRoot, workspace);
    expect(g.useNativeSearch).toBe(true);
    expect(g.grepExample).toContain("corpus.jsonl");
    expect(g.corpusFields).toContain("ref");
    expect(g.extractionLimits.length).toBeGreaterThan(0);
    expect(g.extractionLimits.some((l) => l.includes("LaTeX"))).toBe(true);
  });
});
