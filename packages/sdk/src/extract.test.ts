import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  detectKind,
  extractSlug,
  sortSlideEntries,
  stripOfficeXml,
  Extractor,
} from "./extract.js";

describe("detectKind", () => {
  it("classifies common course material types", () => {
    expect(detectKind("Vorlesung_03.pdf")).toBe("pdf");
    expect(detectKind("Folien Woche 2.pptx")).toBe("office");
    expect(detectKind("Skript.docx")).toBe("office");
    expect(detectKind("uebung.xlsx")).toBe("office");
    expect(detectKind("tafelbild.JPG")).toBe("image");
    expect(detectKind("notes.md")).toBe("text");
    expect(detectKind("code.py")).toBe("text");
    expect(detectKind("archive.zip")).toBe("unsupported");
  });
});

describe("extractSlug", () => {
  it("keeps extension in slug to avoid collisions", () => {
    expect(extractSlug("Vorlesung 3.pdf")).toBe("Vorlesung-3-pdf");
    expect(extractSlug("Vorlesung 3.pptx")).toBe("Vorlesung-3-pptx");
  });
});

describe("pickOcrPages", () => {
  it("selects only pages without extractable text", async () => {
    const { pickOcrPages } = await import("./extract.js");
    expect(pickOcrPages(["Text here", "", "  \n ", "More text"])).toEqual([1, 2]);
    expect(pickOcrPages(["a", "b"])).toEqual([]);
  });
});

describe("sortSlideEntries", () => {
  it("orders slide10 after slide2", () => {
    const sorted = sortSlideEntries([
      "ppt/slides/slide10.xml",
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
    ]);
    expect(sorted).toEqual([
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
      "ppt/slides/slide10.xml",
    ]);
  });
});

describe("stripOfficeXml", () => {
  it("extracts pptx runs with paragraph breaks and entities", () => {
    const xml =
      '<p:sp><a:p><a:r><a:t>Analysis &amp; Algebra</a:t></a:r></a:p>' +
      '<a:p><a:r><a:t>Satz 3.1: </a:t></a:r><a:r><a:t>Konvergenz</a:t></a:r></a:p></p:sp>';
    expect(stripOfficeXml(xml, "pptx")).toBe("Analysis & Algebra\nSatz 3.1: Konvergenz");
  });

  it("extracts docx w:t runs", () => {
    const xml = "<w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> World</w:t></w:r></w:p>";
    expect(stripOfficeXml(xml, "docx")).toBe("Hello World");
  });

  it("ignores empty paragraphs", () => {
    const xml = "<a:p></a:p><a:p><a:r><a:t>Only line</a:t></a:r></a:p>";
    expect(stripOfficeXml(xml, "pptx")).toBe("Only line");
  });
});

describe("Extractor", () => {
  it("extracts text files via passthrough", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-extract-"));
    const src = join(dir, "notes.md");
    writeFileSync(src, "# Klausur notes\nTopic: integrals");

    const extractor = new Extractor();
    const result = await extractor.extractFile(src, join(dir, "out"));

    expect(result.kind).toBe("text");
    expect(result.pages).toBe(1);
    const content = readFileSync(join(dir, "out", "content.md"), "utf-8");
    expect(content).toContain("Klausur notes");
    expect(existsSync(join(dir, "out", "manifest.json"))).toBe(true);
  });

  it("copies images into pages/ for visual reading", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-extract-"));
    const src = join(dir, "tafelbild.png");
    // 1x1 transparent PNG
    writeFileSync(
      src,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      ),
    );

    const extractor = new Extractor();
    const result = await extractor.extractFile(src, join(dir, "out"));

    expect(result.kind).toBe("image");
    expect(result.hasImages).toBe(true);
    expect(existsSync(join(dir, "out", "pages", "page-1.png"))).toBe(true);
  });

  it("skips unchanged files on re-run (incremental)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-extract-"));
    const src = join(dir, "notes.txt");
    writeFileSync(src, "hello");

    const extractor = new Extractor();
    const first = await extractor.extractFile(src, join(dir, "out"));
    const second = await extractor.extractFile(src, join(dir, "out"));

    expect(first.skipped).toBeFalsy();
    expect(second.skipped).toBe(true);
  });

  it("extracts real PPTX slide text natively (zip-based)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-extract-"));
    const pptxRoot = join(dir, "pptx-src");
    mkdirSync(join(pptxRoot, "ppt", "slides"), { recursive: true });
    writeFileSync(
      join(pptxRoot, "ppt", "slides", "slide1.xml"),
      '<p:sld><a:p><a:r><a:t>Slide one: Grenzwerte</a:t></a:r></a:p></p:sld>',
    );
    writeFileSync(
      join(pptxRoot, "ppt", "slides", "slide2.xml"),
      '<p:sld><a:p><a:r><a:t>Slide two: Stetigkeit</a:t></a:r></a:p></p:sld>',
    );
    const src = join(dir, "folien.pptx");
    execFileSync("zip", ["-r", src, "ppt"], { cwd: pptxRoot });

    // Force native path (no soffice) so the test is deterministic on CI.
    const extractor = new Extractor({
      unzip: "/usr/bin/unzip",
      pdftotext: undefined,
      pdftoppm: undefined,
      soffice: undefined,
    });
    const result = await extractor.extractFile(src, join(dir, "out"));

    expect(result.kind).toBe("office");
    expect(result.tool).toBe("native-xml");
    expect(result.pages).toBe(2);
    const content = readFileSync(join(dir, "out", "content.md"), "utf-8");
    expect(content).toContain("## Slide 1");
    expect(content).toContain("Grenzwerte");
    expect(content).toContain("## Slide 2");
    expect(content).toContain("Stetigkeit");
  });

  it("records error manifest for unsupported types", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-extract-"));
    const src = join(dir, "binary.exe");
    writeFileSync(src, Buffer.from([0, 1, 2, 3]));

    const extractor = new Extractor();
    const result = await extractor.extractFile(src, join(dir, "out"));

    expect(result.kind).toBe("unsupported");
    expect(result.error).toContain("Unsupported");
    expect(result.pages).toBe(0);
    const manifest = JSON.parse(readFileSync(join(dir, "out", "manifest.json"), "utf-8"));
    expect(manifest.error).toContain("Unsupported");
  });

  it("extractDir skips unsupported files in tree", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-extract-"));
    const files = join(dir, "files");
    mkdirSync(files);
    writeFileSync(join(files, "notes.txt"), "hello");
    writeFileSync(join(files, "archive.zip"), "zip");

    const extractor = new Extractor();
    const results = await extractor.extractDir(files, join(dir, "extracted"));

    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("text");
  });

  it("force re-extracts even when source unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-extract-"));
    const src = join(dir, "notes.txt");
    writeFileSync(src, "hello");

    const extractor = new Extractor();
    await extractor.extractFile(src, join(dir, "out"));
    const skipped = await extractor.extractFile(src, join(dir, "out"));
    expect(skipped.skipped).toBe(true);

    const forced = await extractor.extractFile(src, join(dir, "out"), { force: true });
    expect(forced.skipped).toBeFalsy();
  });

  it("re-extracts when source file changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-extract-"));
    const src = join(dir, "notes.txt");
    writeFileSync(src, "v1");

    const extractor = new Extractor();
    await extractor.extractFile(src, join(dir, "out"));
    writeFileSync(src, "v2");
    const updated = await extractor.extractFile(src, join(dir, "out"));
    expect(updated.skipped).toBeFalsy();
    expect(readFileSync(join(dir, "out", "content.md"), "utf-8")).toContain("v2");
  });
});
