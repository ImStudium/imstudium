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
  latexIssues,
  latexGlyphs,
  foldGlyph,
  compareGlyphs,
  judgeFormula,
  displayLikeInline,
  katexError,
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
    expect(MATH_ASSETS.find((a) => a.name === "pp-formulanet_plus-l.onnx")!.sha256).toBe("b4924d69c731365048de3d11a5d1829f3dfd8b98b4dbfd82437f934c2611934f");
    expect(MATH_ASSETS.find((a) => a.name === "pp-doclayoutv2.onnx")!.sha256).toBe("a325532df1c7530538ef4e8254695c091adc6afd3366c0851425491f0816d1d1");
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
    await rm(join(root, "math", "models", "pp-doclayoutv2.onnx"));
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
    ["\\left\\{ \\begin{cases} x \\end{cases} \\right.", "\\left\\{\\begin{cases}x\\end{cases}\\right."],
  ])("%s → %s", (raw, latex) => {
    expect(normalizeLatex(raw)).toBe(latex);
  });
});

describe("latexIssues", () => {
  it("passes well-formed LaTeX, including escaped braces, \\right. and words in \\text", () => {
    for (const ok of [
      "E[X]=\\sum_{i=1}^{n}x_{i}p(x_{i})",
      "M=\\{x\\in\\mathbb{R}\\mid x^{2}<2\\}",
      "|x|=\\left\\{\\begin{cases}{x}&{x\\geq0}\\\\ {-x}&{x<0}\\end{cases}\\right.",
      "\\binom{n}{k}=\\frac{n!}{k!(n-k)!}",
      "f(x)=x\\quad\\text{for all sum terms}",
      "a\\equiv b\\pmod{m}",
      "\\frac12+\\frac\\pi2=\\dfrac{1}{\\frac{1}{x}}",
      "f(x)=\\begin{cases}1&x\\in\\mathbb{Q}\\\\0&\\text{sonst}\\end{cases}",
      "\\text{für alle }x\\in\\mathbb{R}",
    ]) {
      expect(latexIssues(ok), ok).toEqual([]);
    }
  });

  it.each([
    ["\\frac{1}{2", "unbalanced braces"],
    ["|x|=\\left\\{\\begin{cases}x\\end{cases}\\right", "\\right without a delimiter"],
    ["\\left(a+b", "\\left ×1 but \\right ×0"],
    ["\\begin{aligned}x&=1", "\\begin{aligned} is never closed"],
    ["\\sum_{k=0}^{n}\\ binom n k k=2^{n}", "a word after an escaped space"],
    ["\\prod_{j=1}^{n}(bigl1+x_{i}\\bigr)", '"bigl" without its backslash'],
    ["\\sqrt[[object Object]]{|a_{n}|}<1", "text that is not LaTeX"],
    ["\\begin{aligned}\\overset{平平}{(a+b)^{2}}&=a^{2}\\end{aligned}", "characters that aren't math: 平"],
    ["\\frac{P(B_{j}\\mid A)=\\frac{P(A)}{P(B)}}{}", "a fraction with an empty part"],
    ["\\frac{ }{n}", "a fraction with an empty part"],
    ["\\boxed{\\int_{-\\infty}^{\\infty}e^{-x^{2}}dx=\\sqrt{\\pi}}", "a box around it: keep \\boxed only if the formula itself is boxed on the page"],
    ["\\left\\{\\neg(A\\land B)\\equiv\\neg A\\lor\\neg B\\right.", "a one-sided brace around a single line"],
    // Read from a real Beamer slide by the small models: "boldsymbol" glued to the A.
    ["Aboldsymbol=(1,0,0),B\\=(0,1,0),C=(0,0,1)", '"boldsymbol" without its backslash'],
    ["xmathsf{min}", '"mathsf" without its backslash'],
    ["\\begin{aligned}&\\bullet\\cdots\\bullet\\\\&\\sigma(z)=\\frac{1}{1+e^{-z}}\\end{aligned}", "a list bullet (•): the box may have caught the slide's item markers"],
  ])("%s: %s", (latex, issue) => {
    expect(latexIssues(latex)).toContain(issue);
  });

  it("flags what KaTeX can't typeset, and passes what it can (spaced \\mathsf letters included)", () => {
    expect(latexIssues("A=(1,0,0),B\\=(0,1,0)")[0]).toMatch(/^KaTeX can't typeset it: /);
    expect(latexIssues("x\\foo{y}")[0]).toMatch(/^KaTeX can't typeset it: .*\\foo/);
    expect(katexError("\\tilde{x}=\\frac{x-\\mathsf{m i n}}{\\mathsf{m a x}-\\mathsf{m i n}}")).toBeNull();
    expect(latexIssues("\\boldsymbol{\\mu}=\\frac{1}{n}\\sum_{i=1}^{n}\\boldsymbol{x}_i")).toEqual([]);
    expect(latexIssues("\\dfrac{a}{b}+\\operatorname*{arg\\,max}_{c}\\overrightarrow{AB}")).toEqual([]);
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

describe("glyph check", () => {
  it.each([
    ["\\binom{n}{k}=\\frac{n!}{k!(n-k)!}", "nknkn k"],
    ["\\log_2(n!)\\in\\Theta(n\\log n)", "log2nΘnlogn"],
    ["M=\\{x\\in\\mathbb{R}\\mid x^{2}<2\\}", "MxR|x22"],
    ["a\\equiv b\\pmod{m}", "abmodm"],
    ["\\hat{\\theta}=\\arg\\max_{\\theta}\\sum_{i=1}^{n}\\log p(x_{i}\\mid\\theta)", "ˆθargmaxθi1nlogpxi|θ"],
    ["\\left\\{\\begin{array}{l l}{\\vdots}\\\\ \\end{array}\\right.", ""],
    ["|x|=\\begin{cases}x&x\\geq0\\\\-x&x<0\\end{cases}", "|x|xx0xx0"],
    ["\\tilde{x}=\\frac{x-\\bar{x}}{\\sigma}+\\left|y\\right|+\\|z\\|", "˜xx¯xσy||z||"],
    ["\\begin{array}{l|l}a&b\\end{array}", "ab"],
    ["\\operatorname{sgn}(\\sigma)\\cdot\\infty", "sgnσ"],
  ])("latexGlyphs(%s)", (latex, glyphs) => {
    expect(latexGlyphs(latex).join("")).toBe(glyphs.replace(/ /g, ""));
  });

  it("foldGlyph: math alphabets, double-struck capitals, Greek variants; not operators", () => {
    expect(foldGlyph("𝑥")).toBe("x");
    expect(foldGlyph("𝐀")).toBe("A");
    expect(foldGlyph("𝟐")).toBe("2");
    expect(foldGlyph("ℝ")).toBe("R");
    expect(foldGlyph("ϵ")).toBe("ε");
    expect(foldGlyph("ﬁ")).toBe("fi");
    expect(foldGlyph("+")).toBeNull();
    expect(foldGlyph("∑")).toBeNull();
    // Accents as PDFium names TeX's accent glyphs, and bars.
    expect([foldGlyph("ˆ"), foldGlyph("^"), foldGlyph("˜"), foldGlyph("~"), foldGlyph("¯"), foldGlyph("\u0303"), foldGlyph("∣"), foldGlyph("‖")]).toEqual(["ˆ", "ˆ", "˜", "˜", "¯", "˜", "|", "||"]);
  });

  it("accents and bars: an invented hat or bar differs; \\overline and \\left| may stand for the PDF's own", () => {
    // Acc = (TP+TN)/(TP+TN+FP+FN): no accent on the page; a reading with hats invented them.
    const acc = [..."AccTPTNTPTNFPFN"];
    expect(judgeFormula("\\mathrm{Acc}=\\frac{TP+TN}{TP+TN+FP+FN}", acc).check).toBe("match");
    expect(judgeFormula("\\mathrm{Acc}=\\frac{\\hat{TP}+TN}{TP+TN+FP+FN}", acc).glyphs?.extra).toEqual(["ˆ"]);
    // x̃ = (x − x̄)/σ: a stray bar in the numerator differs.
    const z = [..."˜xx¯xσ"];
    expect(judgeFormula("\\tilde{x}=\\frac{x-\\bar{x}}{\\sigma}", z).check).toBe("match");
    expect(judgeFormula("\\tilde{x}=\\frac{x-\\bar{x}|}{\\sigma}", z).glyphs?.extra).toEqual(["|"]);
    // \\overline for the page's \\bar, \\left|…\\right| for its |…|: look only, not flagged.
    expect(judgeFormula("\\tilde{x}=\\frac{x-\\overline{x}}{\\sigma}", z).check).toBe("match");
    expect(judgeFormula("\\left|x\\right|=1", [..."|x|1"]).check).toBe("match");
    // A dropped accent is missing.
    expect(judgeFormula("x=\\frac{x-x}{\\sigma}", z).glyphs?.missing).toEqual(["¯", "˜"]);
  });

  it("compareGlyphs is a multiset difference", () => {
    expect(compareGlyphs(["x", "p", "x"], ["x", "x", "p"])).toEqual({ missing: [], extra: [] });
    expect(compareGlyphs(["x", "x"], ["x", "x", "p"])).toEqual({ missing: ["p"], extra: [] });
    expect(compareGlyphs([..."binomnkk"], [..."nk"])).toEqual({ missing: [], extra: ["b", "i", "k", "m", "n", "o"] });
  });

  it("compareGlyphs: a glyph cut off by the box but visible in the crop is not extra; one beyond the crop is", () => {
    // E[X|Y=y] = Σ_x x P(X=x|Y=y), the x under Σ just below the detector's box.
    const inside = [..."EXY|yxPXx|Yy"];
    const visible = [...inside, "x"];
    const latex = [..."EXY|yxxPXx|Yy"];
    expect(compareGlyphs(latex, inside, visible)).toEqual({ missing: [], extra: [] });
    expect(compareGlyphs(latex, inside)).toEqual({ missing: [], extra: ["x"] });
    expect(compareGlyphs([...latex, "n"], inside, visible)).toEqual({ missing: [], extra: ["n"] });
    // Visible-only glyphs never count as missing: a neighbouring line in the padding is not the formula's.
    expect(compareGlyphs(inside, inside, [...visible, "a", "b"])).toEqual({ missing: [], extra: [] });
    expect(judgeFormula("E[X\\mid Y=y]=\\sum_{x}x\\,P(X=x\\mid Y=y)", { inside, visible }).check).toBe("match");
    expect(judgeFormula("x", { inside: [], visible: [] }).check).toBe("unchecked");
  });

  it("judgeFormula: a dropped factor or a garbage reading differs; no text layer is unchecked", () => {
    const pdf = [..."EXi1nxipxi"];
    expect(judgeFormula("E[X]=\\sum_{i=1}^{n}x_{i}p(x_{i})", pdf).check).toBe("match");
    const dropped = judgeFormula("E[X]=\\sum_{i=1}^{n}x_{i}(x_{i})", pdf);
    expect(dropped).toMatchObject({ check: "differs", glyphs: { missing: ["p"], extra: [] } });
    expect(judgeFormula("\\sum_{k=0}^{n}\\ binom n k k=2^{n}", [..."k0nnk2n"]).check).toBe("differs");
    expect(judgeFormula("x^{2}", null)).toEqual({ issues: [], glyphs: null, check: "unchecked" });
    expect(judgeFormula("x^{2", null).check).toBe("differs");
  });
});

describe("displayLikeInline", () => {
  // Boxes in pt from the 4:3 bullets deck: text lines are 11–12 pt high.
  const text = [
    [34, 92, 238, 104],
    [35, 108, 110, 120],
    [34, 126, 126, 137],
    [34, 103, 221, 143],
  ];
  const f = (box: number[]) => ({ box, score: 0.95 });
  it("reads tall inline formulas and those alone on their line, not math inside a sentence", () => {
    const tall = f([102, 103, 220, 143]); // $\displaystyle d(x,y)=\sqrt{\sum…}$ after the item's text
    const alone = f([48, 108, 110, 120]); // \item $\mathbf{w}^\top\mathbf{x}+b=0$
    const inSentence = f([151, 92, 225, 103]); // "… mit $TP, TN, FP, FN$:"
    const symbol = f([228, 93, 237, 103]); // $\mathbf{w}$
    expect(displayLikeInline([tall, alone, inSentence, symbol], text)).toEqual([tall, alone]);
    // "Für $0 \le k \le n$:" — a short line, but text before the formula: stays text.
    expect(displayLikeInline([f([60, 126, 99, 137])], [[34, 126, 100, 137]])).toEqual([]);
    expect(displayLikeInline([f([47, 126, 99, 137])], [[34, 126, 100, 137]])).toHaveLength(1);
  });
  it("without text boxes the line height comes from the inline formulas themselves", () => {
    const small = [f([10, 10, 30, 21]), f([40, 10, 60, 21]), f([70, 10, 90, 22])];
    const frac = f([10, 40, 80, 70]);
    expect(displayLikeInline([...small, frac], [])).toEqual([frac]);
    expect(displayLikeInline([], text)).toEqual([]);
  });
});
