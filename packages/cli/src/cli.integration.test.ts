import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { describe, it, expect } from "vitest";

const cli = join(dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");

function run(args: string[], env?: Record<string, string>): string {
  return execFileSync(process.execPath, [cli, ...args], {
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
}

function runJson(args: string[], env?: Record<string, string>): Record<string, unknown> {
  return JSON.parse(run([...args, "--json"], env)) as Record<string, unknown>;
}

describe("CLI integration", () => {
  it("doctor reports tool detection as JSON", () => {
    const doc = runJson(["doctor"]);
    expect(doc.schemaVersion).toBe("1");
    expect(doc.tools).toBeDefined();
    const tools = doc.tools as Record<string, string | undefined>;
    expect(typeof tools.unzip === "string" || tools.unzip === undefined).toBe(true);
  });

  it("extract --file on text file", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-cli-ex-"));
    const src = join(dir, "klausur-notes.md");
    writeFileSync(src, "# Notes\nIntegral substitution");

    const doc = runJson(["extract", "--file", src]);
    expect(doc.pages).toBe(1);
    expect(doc.kind).toBe("text");
    expect(doc.outDir).toContain("klausur-notes-extracted");
  });

  it("view --dir builds viewer for page images", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-cli-view-"));
    const pages = join(dir, "pages");
    mkdirSync(pages);
    writeFileSync(join(pages, "page-1.png"), "x");

    const doc = runJson(["view", "--dir", dir]);
    expect(doc.viewerHtml).toBeDefined();
    expect((doc.pageImages as string[]).length).toBe(1);
    expect(String(doc.requiredAction)).toMatch(/MANDATORY|mandatory/i);
  });

  it("view fails without --dir or course+file", () => {
    expect(() => run(["view", "--json"])).toThrow();
    try {
      run(["view", "--json"]);
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string };
      const out = `${err.stderr || ""}${err.stdout || ""}`;
      expect(out.toLowerCase()).toMatch(/course|dir|missing/);
    }
  });

  it("setup status returns detected agents", () => {
    const doc = runJson(["setup", "status"]);
    expect(doc.schemaVersion).toBe("1");
    expect(Array.isArray(doc.detected)).toBe(true);
    expect(doc.workspace).toBeDefined();
  });

  it("extract workspace course filters by slug", () => {
    const ws = mkdtempSync(join(tmpdir(), "dc-cli-ws-"));
    const slug = "Analysis-II";
    writeFileSync(
      join(ws, "studium.json"),
      JSON.stringify({
        schemaVersion: "1",
        generatedAt: new Date().toISOString(),
        instanceUrl: "https://example.edu",
        semesters: ["current"],
        courses: [{ id: "1", title: "Analysis II", slug, fileCount: 1, examDates: [] }],
        nextDeadlines: [],
      }),
    );
    const files = join(ws, "current", slug, "files");
    mkdirSync(files, { recursive: true });
    writeFileSync(join(files, "skript.txt"), "Taylor series");

    const doc = runJson(["extract", "--course", slug, "-o", ws]);
    expect(doc.extracted).toBe(1);
    expect(doc.skipped).toBe(0);
  });
});
