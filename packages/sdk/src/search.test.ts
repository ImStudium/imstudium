import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chunkMarkdown, fold, rankDocs, searchWorkspace, tokenize, type SearchDoc } from "./search.js";

const doc = (ref: string, text: string, kind: SearchDoc["kind"] = "material"): SearchDoc => ({
  ref,
  citation: ref,
  kind,
  path: ref,
  text,
});

describe("search", () => {
  it("folds umlauts so Übung and Ubung meet", () => {
    expect(fold("Übungsblatt Größe")).toBe("ubungsblatt grosse");
    expect(tokenize("Die Übung und the Matrix")).toEqual(["ubung", "matrix"]);
  });

  it("ranks the document that covers every term first", () => {
    const docs = [
      doc("a", "Gradient descent converges for convex functions."),
      doc("b", "Descent of the mountain, no maths here."),
      doc("c", "Stochastic gradient descent with momentum and gradient clipping."),
    ];
    const hits = rankDocs(docs, "gradient descent", 3);
    expect(hits.map((h) => h.ref)).not.toContain(undefined);
    expect(hits[hits.length - 1]!.ref).toBe("b");
  });

  it("chunks markdown at headings", () => {
    const chunks = chunkMarkdown("---\nid: 1\n---\n# A\ntext a\n## B\ntext b");
    expect(chunks).toEqual(["# A\ntext a", "## B\ntext b"]);
  });

  it("finds materials and news in a workspace, current semester only by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "imstudium-search-"));
    await mkdir(join(root, "WS2026-27", "Statistik", "search"), { recursive: true });
    await mkdir(join(root, "WS2026-27", "Statistik", "news"), { recursive: true });
    await mkdir(join(root, "archive", "SS2026", "Analysis", "search"), { recursive: true });
    await writeFile(
      join(root, "WS2026-27", "Statistik", "search", "corpus.jsonl"),
      JSON.stringify({ ref: "WS2026-27/Statistik#v1.pdf:2", citation: "Statistik · v1.pdf · p.2", coursePath: "WS2026-27/Statistik", courseTitle: "Statistik", extractSlug: "v1-pdf", page: 2, text: "Der Erwartungswert einer Zufallsvariable" }) + "\n",
    );
    await writeFile(join(root, "WS2026-27", "Statistik", "news", "2026-10-15-raum.md"), "# Raumänderung\n\nDie Übung findet im Hörsaal II statt.");
    await writeFile(
      join(root, "archive", "SS2026", "Analysis", "search", "corpus.jsonl"),
      JSON.stringify({ ref: "archive/SS2026/Analysis#a.pdf:1", citation: "Analysis · a.pdf · p.1", text: "Erwartungswert im Archiv" }) + "\n",
    );

    const hits = await searchWorkspace(root, "Erwartungswert");
    expect(hits.map((h) => h.ref)).toEqual(["WS2026-27/Statistik#v1.pdf:2"]);
    expect(hits[0]!.path).toBe("WS2026-27/Statistik/extracted/v1-pdf/content.md");

    const withArchive = await searchWorkspace(root, "Erwartungswert", { includeArchive: true });
    expect(withArchive).toHaveLength(2);

    const news = await searchWorkspace(root, "Hörsaal Übung", { kinds: ["news"] });
    expect(news[0]!.kind).toBe("news");
  });
});
