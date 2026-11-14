import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  convertLocalDocument,
  IMAGE_ONLY,
  joinPagesFormFeed,
  mergeOcrPages,
  MOSTLY_IMAGE,
  OCR_LOW_CONFIDENCE,
  OCR_MERGE,
  splitMarkdownPages,
  textFromPositions,
  type LocalConvertOk,
  type OcrPagesResult,
  type PositionedRun,
} from "./local-docs.js";

describe("splitMarkdownPages", () => {
  it("splits form feeds", () => {
    expect(splitMarkdownPages("page one\fpage two")).toEqual(["page one", "page two"]);
  });

  it("splits horizontal rules", () => {
    expect(splitMarkdownPages("# S1\n\nHi\n\n---\n\n# S2\n\nThere")).toHaveLength(2);
  });

  it("keeps a single page", () => {
    expect(splitMarkdownPages("# Doc\n\nHello")).toEqual(["# Doc\n\nHello"]);
  });
});

describe("joinPagesFormFeed", () => {
  it("rejoins for vault-style splitters", () => {
    const md = joinPagesFormFeed([
      { index: 0, markdown: "A" },
      { index: 1, markdown: "B" },
    ]);
    expect(splitMarkdownPages(md)).toEqual(["A", "B"]);
  });
});

describe("mergeOcrPages", () => {
  // Native pass: page 1 has text; pages 2–4 came back empty (needsOcr) and were sent to the OCR call.
  const native = (): LocalConvertOk => ({
    ok: true,
    engine: "pdf-inspector",
    pageCount: 4,
    markdown: "",
    pages: [
      { index: 0, markdown: "Native text" },
      { index: 1, markdown: IMAGE_ONLY, imageOnly: true },
      { index: 2, markdown: IMAGE_ONLY, imageOnly: true },
      { index: 3, markdown: IMAGE_ONLY, imageOnly: true },
    ],
    metadata: { engine: "pdf-inspector" },
  });
  const page = (pageNumber: number, source: string, markdown: string, ocrConfidence?: number) => ({ pageNumber, markdown, provenance: { source, ocrConfidence, hostedRecommended: false } });

  it("keeps text the OCR call recovered from the page's own text layer (source Native), as recovered, not OCR", () => {
    // What pdf-inspector 1.25.2 returned on the laptop: "kept trustworthy PDFium native recovery because OCR added no material coverage".
    const r: OcrPagesResult = {
      pages: [
        page(1, "Native", "Must never replace a page the native pass read"),
        page(2, "Native", "## Nearest-Neighbor Classifier\n\nk=2", 0.99),
        page(3, "Ocr", "Input: 9 values", 0.42),
        page(4, "Native", "  "),
      ],
      ocrTimeMs: 12,
    };
    const out = mergeOcrPages(native(), r);
    expect(out.pages[0]).toEqual({ index: 0, markdown: "Native text" });
    expect(out.pages[1]).toEqual({ index: 1, markdown: "## Nearest-Neighbor Classifier\n\nk=2", imageOnly: false, recovered: true });
    expect(out.pages[2]).toEqual({ index: 2, markdown: `Input: 9 values\n\n${OCR_LOW_CONFIDENCE}`, imageOnly: false, ocr: { source: "Ocr", confidence: 0.42, low: true } });
    expect(out.pages[3]).toEqual({ index: 3, markdown: IMAGE_ONLY, imageOnly: true });
    expect(out.metadata).toMatchObject({
      engine: "pdf-inspector+ocr",
      imageOnlyPages: [3],
      ocr: { merge: OCR_MERGE, pages: [2], lowConfidencePages: [2], recoveredPages: [1], ocrTimeMs: 12 },
    });
    expect(splitMarkdownPages(out.markdown)[1]).toContain("Nearest-Neighbor Classifier");
  });

  it("only recovered text: the engine stays pdf-inspector and no page counts as OCR", () => {
    const out = mergeOcrPages(native(), { pages: [page(2, "Native", "Input: 9 values / Output: 4 values", 1)], ocrTimeMs: 0 });
    expect(out.engine).toBe("pdf-inspector");
    expect(out.metadata.ocr).toMatchObject({ pages: [], recoveredPages: [1] });
  });

  it("a page with text from its positioned runs keeps it when OCR reads nothing or reads it unsure, and takes a sure reading or PDFium's recovery", () => {
    const slide = (index: number) => ({ index, markdown: `### Clustering\n\nAbb. 3\n\n${MOSTLY_IMAGE}`, fromPositions: true as const });
    const n: LocalConvertOk = { ...native(), pages: [{ index: 0, markdown: "Native text" }, slide(1), slide(2), slide(3), slide(4)], pageCount: 5 };
    const out = mergeOcrPages(n, {
      pages: [page(2, "Ocr", ""), page(3, "Ocr", "Clusterlng", 0.31), page(4, "Fused", "## Clustering\n\nAbb. 3: Iris", 0.93), page(5, "Native", "## Clustering\n\nAbb. 3")],
      ocrTimeMs: 5,
    });
    expect(out.pages[1]).toEqual(slide(1));
    expect(out.pages[2]).toEqual(slide(2));
    expect(out.pages[3]).toMatchObject({ markdown: "## Clustering\n\nAbb. 3: Iris", ocr: { source: "Fused", low: false } });
    expect(out.pages[4]).toEqual({ index: 4, markdown: "## Clustering\n\nAbb. 3", imageOnly: false, recovered: true });
    expect(out.metadata).toMatchObject({ imageOnlyPages: [], ocr: { pages: [3], recoveredPages: [4] } });
  });

  it("no page needed OCR: native unchanged, the OCR pass still recorded", () => {
    const n = { ...native(), pages: [{ index: 0, markdown: "Native text" }], pageCount: 1 };
    const out = mergeOcrPages(n, null);
    expect(out.pages).toEqual(n.pages);
    expect(out.metadata.ocr).toMatchObject({ merge: OCR_MERGE, pages: [], recoveredPages: [] });
  });
});

describe("textFromPositions", () => {
  const run = (text: string, x: number, y: number, fontSize: number, extra: Partial<PositionedRun> = {}): PositionedRun => ({
    text,
    x,
    y,
    width: text.length * fontSize * 0.5,
    height: fontSize,
    fontSize,
    itemType: "Text",
    renderMode: 0,
    ...extra,
  });

  it("orders runs into lines top to bottom, makes the clearly largest top line a heading, adds nothing", () => {
    const runs = [
      run("Tiefe 3,", 72, 69, 12),
      run("Gini", 72 + 8 * 6 + 3, 69, 12),
      run("Entscheidungsbaum", 43, 491, 30),
      run("Quelle: synthetisch", 72, 54, 12),
      { ...run("[Image: X5]", 259, 108, 0), width: 432, height: 324, itemType: "Image", renderMode: undefined },
    ];
    expect(textFromPositions(runs)).toBe("### Entscheidungsbaum\n\nTiefe 3, Gini\nQuelle: synthetisch");
  });

  it("leaves out invisible runs, runs lying on an image, and the same run repeated on the same spot", () => {
    const runs = [
      run("Folie", 40, 500, 28),
      run("Folie", 41, 499, 28), // shadow
      run("OCR layer", 40, 300, 12, { renderMode: 3 }),
      run("clip", 40, 280, 12, { renderMode: 7 }),
      run("under the picture", 300, 200, 12),
      { ...run("[Image: Im1]", 100, 50, 0), width: 700, height: 400, itemType: "Image", renderMode: undefined },
    ];
    expect(textFromPositions(runs)).toBe("Folie");
    expect(textFromPositions([run("OCR layer", 40, 300, 12, { renderMode: 3 })])).toBe("");
  });
});

/**
 * A hand-written one-page 16:9 PDF (synthetic): a raster picture of `px`
 * pixels drawn at `img` (x, y, w, h in points) and Helvetica text runs.
 * `textFirst`: the text is drawn before the picture, under it.
 */
function slidePdf(o: { img: [number, number, number, number]; px: [number, number]; texts: Array<[string, number, number, number]>; textFirst?: boolean }): Uint8Array {
  const [w, h] = o.px;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = (x * 255) / w;
      raw[i + 1] = (y * 255) / h;
      raw[i + 2] = (x ^ y) & 16 ? 200 : 40;
    }
  }
  const data = deflateSync(raw);
  const [ix, iy, iw, ih] = o.img;
  const picture = `q ${iw} 0 0 ${ih} ${ix} ${iy} cm /Im1 Do Q`;
  const text = o.texts.map(([t, x, y, size]) => `BT /F1 ${size} Tf ${x} ${y} Td (${t}) Tj ET`);
  const content = (o.textFirst ? [...text, picture] : [picture, ...text]).join("\n");
  const objs: Array<Array<string | Buffer>> = [
    ["<< /Type /Catalog /Pages 2 0 R >>"],
    ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    ["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 6 0 R >>"],
    ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"],
    [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`, data, "\nendstream"],
    [`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`],
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n")];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  objs.forEach((o, i) => {
    offsets.push(length);
    const body = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), ...o.map((x) => (Buffer.isBuffer(x) ? x : Buffer.from(x))), Buffer.from("\nendobj\n")]);
    parts.push(body);
    length += body.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([...parts, Buffer.from(xref)]));
}

describe("a slide pdf-inspector rates scanned (synthetic)", () => {
  // As on the laptop: a PowerPoint slide that is mostly a ~200 dpi picture, with a title and two short labels
  // (86 characters). pdf-inspector 1.25.2 returns needsOcr, ocrReason "scanned" and no text for it.
  const texts: Array<[string, number, number, number]> = [
    ["Hierarchisches Clustering", 43.2, 491.3, 30],
    ["Dendrogramm der Iris-Daten", 72, 69, 14],
    ["Single Linkage, euklidisch", 600, 69, 14],
  ];

  it("gets its own text without the OCR runtime, with a note that the picture is not read", async () => {
    const r = await convertLocalDocument(slidePdf({ img: [259.5, 108, 432, 324], px: [1200, 900], texts }), "folie.pdf", { ocr: false });
    if (!r.ok) throw r.error;
    expect(r.pages).toEqual([
      { index: 0, markdown: `### Hierarchisches Clustering\n\nDendrogramm der Iris-Daten Single Linkage, euklidisch\n\n${MOSTLY_IMAGE}`, fromPositions: true },
    ]);
    expect(r.metadata.imageOnlyPages).toEqual([]);
  });

  it("a scan whose text lies under a full-page picture stays image-only", async () => {
    const r = await convertLocalDocument(slidePdf({ img: [0, 0, 960, 540], px: [1600, 900], texts, textFirst: true }), "scan.pdf", { ocr: false });
    if (!r.ok) throw r.error;
    expect(r.pages).toEqual([{ index: 0, markdown: IMAGE_ONLY, imageOnly: true }]);
  });
});
