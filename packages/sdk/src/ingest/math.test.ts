import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decodeFormulaTokens,
  formulaInput,
  FORMULA_INPUT,
  isMathCandidate,
  LAYOUT_MODEL,
  MATH_ASSETS,
  MATH_MODEL,
  mathDisabledByEnv,
  mathRuntimeStatus,
  normalizeLatex,
} from "./math.js";
import { ocrPlatformKey, OCR_RUNTIMES } from "./ocr-runtime.js";

/** No models, no native code: the pure steps around the two networks, and the install bookkeeping. */

describe("pins", () => {
  it("every math artifact is an HTTPS release or npm tarball with a SHA-256 and a size", () => {
    for (const a of MATH_ASSETS) {
      expect(a.url).toMatch(/^https:\/\/(github\.com\/GreatV\/oar-ocr\/releases\/download\/v0\.3\.0\/|registry\.npmjs\.org\/)/);
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.bytes).toBeGreaterThan(0);
    }
    expect(MATH_ASSETS.find((a) => a.name === "onnxruntime-node")!.url).toContain("1.27.0");
    expect(MATH_ASSETS.find((a) => a.name === "pp-formulanet_plus-s.onnx")!.sha256).toBe("449d205c8fb2fe0a9b134a5e4a0f2421c2e7812fd902ea67dfda4e9ef4588978");
  });

  it("the binding is unpacked only for this platform", () => {
    const binding = MATH_ASSETS.find((a) => a.name === "onnxruntime-node")!;
    expect(binding.members!("darwin-arm64")).toContain("bin/napi-v6/darwin/arm64");
    expect(binding.members!("win32-x64")).toContain("bin/napi-v6/win32/x64");
  });
});

describe("mathRuntimeStatus", () => {
  const saved: Record<string, string | undefined> = {};
  let root: string;
  beforeEach(async () => {
    for (const k of ["IMSTUDIUM_OCR_DIR", "IMSTUDIUM_MATH", "IMSTUDIUM_OCR"]) saved[k] = process.env[k];
    delete process.env.IMSTUDIUM_MATH;
    delete process.env.IMSTUDIUM_OCR;
    root = await mkdtemp(join(tmpdir(), "imstudium-math-"));
    process.env.IMSTUDIUM_OCR_DIR = root;
  });
  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(root, { recursive: true, force: true });
  });

  async function fakeMath(model = MATH_MODEL): Promise<void> {
    for (const a of MATH_ASSETS) {
      const p = a.kind === "npm" ? join(root, "math", "node_modules", a.name, "package.json") : join(root, "math", "models", a.name);
      await mkdir(join(p, ".."), { recursive: true });
      await writeFile(p, "{}");
    }
    await writeFile(join(root, "math", "math.json"), JSON.stringify({ model, layoutModel: LAYOUT_MODEL }));
  }

  const supported = !!OCR_RUNTIMES[ocrPlatformKey()];

  it("is not installed in an empty folder and names the download", () => {
    const s = mathRuntimeStatus();
    expect(s.ready).toBe(false);
    expect(s.dir).toBe(join(root, "math"));
    expect(s.downloadBytes).toBe(MATH_ASSETS.reduce((n, a) => n + a.bytes, 0));
    if (supported) expect(s.reason).toBe("not installed");
  });

  it.skipIf(!supported)("is ready with every pinned file and a current marker", async () => {
    await fakeMath();
    expect(mathRuntimeStatus()).toMatchObject({ ready: true, reason: null, disabled: false });
  });

  it.skipIf(!supported)("an older model marker or a missing file is not ready", async () => {
    await fakeMath("pp-formulanet-s (old)");
    expect(mathRuntimeStatus().ready).toBe(false);
    await fakeMath();
    await rm(join(root, "math", "models", "pp-doclayout-s.onnx"));
    expect(mathRuntimeStatus()).toMatchObject({ ready: false, reason: "incomplete or for older pins" });
  });

  it.skipIf(!supported)("IMSTUDIUM_MATH=off and IMSTUDIUM_OCR=off both switch it off", async () => {
    await fakeMath();
    process.env.IMSTUDIUM_MATH = "off";
    expect(mathRuntimeStatus()).toMatchObject({ ready: true, disabled: true });
    delete process.env.IMSTUDIUM_MATH;
    process.env.IMSTUDIUM_OCR = "0";
    expect(mathRuntimeStatus().disabled).toBe(true);
  });

  it("reads the switch", () => {
    expect(mathDisabledByEnv({ IMSTUDIUM_MATH: "off" })).toBe(true);
    expect(mathDisabledByEnv({ IMSTUDIUM_MATH: "on" })).toBe(false);
    expect(mathDisabledByEnv({})).toBe(false);
  });
});

describe("decodeFormulaTokens", () => {
  // A tiny byte-level vocabulary: Ġ is the space byte, as in GPT-2 style BPE.
  const vocab = ["<s>", "<pad>", "</s>", "<unk>", "E", "Ġ=", "Ġ\\", "sum", "Ġ_", "Ġ{", "Ġi", "Ġ}", "Ã¤"];
  it("stops at </s>, drops <s> and <pad>, undoes the byte-level encoding", () => {
    expect(decodeFormulaTokens([0, 4, 5, 6, 7, 8, 9, 10, 11, 2, 4, 4], vocab)).toBe("E = \\sum _ { i }");
    expect(decodeFormulaTokens([0, 1, 4, 1], vocab)).toBe("E");
  });
  it("stops at sentinel ids beyond the vocabulary", () => {
    expect(decodeFormulaTokens([4, 50_000, 4], vocab)).toBe("E");
  });
  it("decodes multi-byte UTF-8", () => {
    expect(decodeFormulaTokens([12], vocab)).toBe("ä");
  });
});

describe("normalizeLatex (PaddleOCR post_process)", () => {
  it.each([
    ["E [ X ] = \\sum _ { i = 1 } ^ { n } x _ { i } p ( x _ { i } )", "E[X]=\\sum_{i=1}^{n}x_{i}p(x_{i})"],
    ["\\mathrm { V a r } ( X ) = E \\left[ ( X - \\mu ) ^ { 2 } \\right]", "\\mathrm{Var}(X)=E\\left[(X-\\mu)^{2}\\right]"],
    ["\\int _ { - \\infty } ^ { \\infty } e ^ { - x ^ { 2 } } d x = \\sqrt { \\pi } .", "\\int_{-\\infty}^{\\infty}e^{-x^{2}}d x=\\sqrt{\\pi}"],
    ["\\sum x", "\\sum x"],
    ["a \\ b", "a\\ b"],
  ])("%s → %s", (raw, latex) => {
    expect(normalizeLatex(raw)).toBe(latex);
  });
});

describe("formulaInput", () => {
  it("trims the margin, fits the ink into 384×384 on black and normalises", () => {
    // 40×20 white crop; ink is an L: row 8 for x 5..14 and column 5 for rows 8..11.
    const w = 40;
    const h = 20;
    const gray = new Uint8Array(w * h).fill(255);
    for (let x = 5; x < 15; x++) gray[8 * w + x] = 0;
    for (let y = 8; y < 12; y++) gray[y * w + 5] = 0;
    const input = formulaInput(gray, w, h)!;
    const N = FORMULA_INPUT;
    expect(input).toHaveLength(N * N);
    const black = (0 - 0.7931) / 0.1738;
    const white = (1 - 0.7931) / 0.1738;
    // The 10×4 ink box is scaled to the full width: 384 × 153, centred vertically from row 115.
    expect(input[0]).toBeCloseTo(black, 4); // padding above
    expect(input[114 * N + 200]).toBeCloseTo(black, 4); // still padding
    expect(input[115 * N + 200]).toBeCloseTo(black, 1); // the L's top stroke
    expect(input[267 * N + 383]).toBeCloseTo(white, 4); // inside the box, right of the stem: paper
    let max = -Infinity;
    for (const v of input) max = Math.max(max, v);
    expect(max).toBeCloseTo(white, 4);
  });

  it("returns null for a blank crop", () => {
    expect(formulaInput(new Uint8Array(100).fill(255), 10, 10)).toBeNull();
  });
});

describe("isMathCandidate", () => {
  it.each([
    ["∑ *n* *E*[*X*] = *x<sub>i</sub>*", true],
    ["Var(X) = σ²", true],
    ["x<sup>2</sup> + 1", true],
    ["Die Übung findet im HS II statt · Raum 1001", false],
    ["Agenda: Einführung, Organisation, Literatur", false],
  ])("%s → %s", (text, expected) => {
    expect(isMathCandidate(text)).toBe(expected);
  });
});
