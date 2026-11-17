import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decodeUnirecTokens,
  unirecInput,
  unirecLatex,
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
  isSymbolFontCode,
  splitAccented,
  compareGlyphs,
  judgeFormula,
  displayLikeInline,
  katexError,
  assetUpToDate,
  stripMathDelimiters,
  isPictureFormula,
  sameMeaning,
  decideReading,
  decidedVerdict,
  readingFeatures,
  DECISION_FLAG_BELOW,
  type Reading,
} from "./math.js";
import { ocrPlatformKey, OCR_RUNTIMES } from "./ocr-runtime.js";

/** No models, no native code: the pure steps around the two networks, and the install bookkeeping. */

describe("pins", () => {
  it("every math artifact is an HTTPS release, a revision-pinned model file or an npm tarball, with a SHA-256 and a size", () => {
    for (const a of MATH_ASSETS) {
      expect(a.url).toMatch(/^https:\/\/(github\.com\/GreatV\/oar-ocr\/releases\/download\/v0\.3\.0\/|huggingface\.co\/topdu\/unirec_0_1b_onnx\/resolve\/[0-9a-f]{40}\/|registry\.npmjs\.org\/)/);
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.bytes).toBeGreaterThan(0);
    }
    expect(MATH_ASSETS.find((a) => a.name === "onnxruntime-node")!.url).toContain("1.27.0");
    expect(MATH_ASSETS.find((a) => a.name === "unirec_encoder.onnx")!.sha256).toBe("eb6b5d38f16c4f1abc39bab47e8d4ec83103b3246f642bde599edf6634289392");
    expect(MATH_ASSETS.find((a) => a.name === "unirec_decoder.onnx")!.sha256).toBe("334326c877856d7595614424f1e15d6b1aab6ba24c26c769f09ab38901d5021c");
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

describe("decodeUnirecTokens", () => {
  // A tiny byte-level vocabulary: Ġ is the space byte, as in GPT-2 style BPE.
  const tokens = ["<|bos|>", "<|pad|>", "<|eos|>", "<|unk|>", "E", "Ġ=", "Ġ\\", "sum", "_{", "i", "}", "Ã¤", "<|sn|>"];
  it("stops at the end token, drops the other special tokens, undoes the byte-level encoding", () => {
    expect(decodeUnirecTokens([0, 4, 5, 6, 7, 8, 9, 10, 2, 4, 4], tokens, 2)).toBe("E = \\sum_{i}");
    expect(decodeUnirecTokens([0, 1, 4, 3], tokens, 2)).toBe("E");
    expect(decodeUnirecTokens([4, 12, 4], tokens, 2)).toBe("E E");
  });
  it("decodes multi-byte UTF-8", () => {
    expect(decodeUnirecTokens([11], tokens, 2)).toBe("ä");
  });
});

describe("unirecLatex", () => {
  it("drops the display wrapper and an equation number after it", () => {
    expect(unirecLatex("\\[\\sigma(z)=\\frac{1}{1+\\mathrm{e}^{-z}}\\](1)")).toBe("\\sigma(z)=\\frac{1}{1+\\mathrm{e}^{-z}}");
    expect(unirecLatex("$$\nE=mc^{2}\n$$")).toBe("E=mc^{2}");
    expect(unirecLatex("x_{(1)}")).toBe("x_{(1)}");
  });
  it("one display per line becomes an aligned derivation, aligned at the leading relation outside braces", () => {
    expect(unirecLatex("(a+b)^{2}=(a+b)(a+b)\\]\\[=a^{2}+2ab+b^{2}")).toBe("\\begin{aligned}(a+b)^{2}&=(a+b)(a+b)\\\\&=a^{2}+2ab+b^{2}\\end{aligned}");
    expect(unirecLatex("\\sum_{i=1}^{n}x_{i}\\]\\[\\le n")).toBe("\\begin{aligned}\\sum_{i=1}^{n}x_{i}&\\\\&\\le n\\end{aligned}");
    expect(unirecLatex("a+b\\]\\[c+d")).toBe("\\begin{gathered}a+b\\\\c+d\\end{gathered}");
    // A number between two displays belongs to the first line, and goes like the last one.
    expect(unirecLatex("\\[a=b\\] (2) \\[=c\\](3a)")).toBe("\\begin{aligned}a&=b\\\\&=c\\end{aligned}");
  });
  it("leaves no math delimiter inside the formula, so KaTeX and the check see the formula itself", () => {
    // A crop that caught text with inline math, a display opened twice, a stray dollar.
    expect(unirecLatex("\\(p(Y|X)\\) und \\(p(Y)\\)")).toBe("p(Y|X) und p(Y)");
    expect(unirecLatex("lift(X\\to Y)=\\frac{s(X\\cup Y)}{s(X)}\\]")).toBe("lift(X\\to Y)=\\frac{s(X\\cup Y)}{s(X)}");
    expect(unirecLatex("\\[x^{2}\\[")).toBe("x^{2}");
    expect(unirecLatex("$a+b$ = $c$")).toBe("a+b = c");
    for (const raw of ["\\(p(Y|X)\\) und \\(p(Y)\\)", "\\[x^{2}\\[", "$a+b$ = $c$", "a=b$"]) expect(katexError(unirecLatex(raw))).toBeNull();
  });
  it("keeps what only looks like a delimiter", () => {
    expect(stripMathDelimiters("a\\\\[4pt]b")).toBe("a\\\\[4pt]b");
    expect(stripMathDelimiters("\\left(x\\right]+\\$5")).toBe("\\left(x\\right]+\\$5");
    expect(stripMathDelimiters("\\(x\\)\\[y\\]$z$")).toBe("x y z");
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

describe("font variants and pictures", () => {
  it("compares letters whatever their font: bold, sans or blackboard against the PDF's plain letters is a match", () => {
    expect(judgeFormula("\\mathbf{w}^{\\top}\\mathbf{x}+b=0", ["w", "x", "b", "0"]).check).toBe("match");
    expect(judgeFormula("w^{\\top}x+b=0", ["w", "x", "b", "0"]).check).toBe("match");
    expect(judgeFormula("\\bar{\\bm{x}}=\\mathsf{y}", { inside: ["¯", "x", "y"], visible: ["¯", "x", "y"] }).check).toBe("match");
  });

  // The lift formula of a PowerPoint deck whose formulas are one pasted image: the PDF has one label letter in the box.
  const lift = "lift(X\\to Y)=\\frac{s(X\\cup Y)}{s(X)\\times s(Y)}=\\frac{p(Y|X)}{p(Y)}";

  it("a formula that is a picture in the PDF is unchecked like a scan, not marked", () => {
    const picture = { inside: ["X"], visible: ["X"], cover: { image: 0.97, drawn: 0 } };
    expect(isPictureFormula(lift, picture)).toBe(true);
    expect(judgeFormula(lift, picture)).toEqual({ issues: [], glyphs: null, check: "unchecked", picture: true });
    // Without the picture under it, the same letters are what the reading added.
    expect(judgeFormula(lift, { ...picture, cover: { image: 0, drawn: 0 } }).check).toBe("differs");
    // Text turned into outlines: many small shapes in the box.
    expect(isPictureFormula(lift, { inside: [], visible: [], cover: { image: 0, drawn: 30 } })).toBe(true);
    // Malformed LaTeX is still marked.
    expect(judgeFormula(`${lift}}`, picture)).toMatchObject({ check: "differs", picture: true, issues: ["unbalanced braces"] });
  });

  it("a formula set as text on a picture (a slide's background) is still checked", () => {
    const letters = latexGlyphs(lift);
    const onBackground = { inside: letters, visible: letters, cover: { image: 1, drawn: 0 } };
    expect(isPictureFormula(lift, onBackground)).toBe(false);
    expect(judgeFormula(lift, onBackground).check).toBe("match");
    expect(judgeFormula(lift.replace("s(X)\\times", "t(X)\\times"), onBackground).check).toBe("differs");
  });

  // Italic letters drawn as outlines (PowerPoint), digits and upright words as text: the PDF has 3 2 2 7 in the box.
  const poly = "f(x)=3x^{2}+2x-7";
  const digits = ["3", "2", "2", "7"];

  it("partly a picture: the PDF's characters agree and it draws the rest as shapes, so the reading is partial, not marked", () => {
    expect(judgeFormula(poly, { inside: digits, visible: digits, cover: { image: 0, drawn: 4 } })).toEqual({
      issues: [],
      glyphs: { missing: [], extra: ["f", "x", "x", "x"], pdf: 4 },
      check: "partial",
    });
    // Fewer letters drawn than the reading adds: one is invented.
    expect(judgeFormula(poly, { inside: digits, visible: digits, cover: { image: 0, drawn: 2 } }).check).toBe("differs");
    // A digit of the PDF's the reading lacks contradicts it, drawn letters or not.
    expect(judgeFormula("f(x)=3x^{2}+2x", { inside: digits, visible: digits, cover: { image: 0, drawn: 4 } }).check).toBe("differs");
  });

  it("an invented letter on a page that draws nothing stays marked (\\sum_{n} for \\sum_{x})", () => {
    // As on the benchmark slide: the sum's subscript x sits just outside the detector's own box, so nothing is missing.
    const visible = latexGlyphs("E[X\\mid Y=y]=\\sum_{x}x~P(X=x\\mid Y=y)");
    const inside = [...visible];
    inside.splice(inside.indexOf("x"), 1);
    const wrong = "E[X\\mid Y=y]=\\sum_{n}x~P(X=x\\mid Y=y)";
    expect(judgeFormula(wrong, { inside, visible, cover: { image: 0, drawn: 0 } })).toMatchObject({ check: "differs", glyphs: { missing: [], extra: ["n"] } });
    expect(judgeFormula(wrong, { inside, visible }).check).toBe("differs");
  });

  it("the decision model counts drawn letters as accounted for, not invented", () => {
    const rs: Reading[] = [1, 0.75, 0.5].map((factor) => ({ latex: poly, factor, ...judgeFormula(poly, { inside: digits, visible: digits, cover: { image: 0, drawn: 4 } }) }));
    expect(readingFeatures(rs, 0)[3]).toBe(0);
    const d = decideReading(rs);
    expect(d.confidence).toBeGreaterThan(DECISION_FLAG_BELOW);
    expect(decidedVerdict(rs, d.index, d.confidence).check).toBe("partial");
  });

  it("the decision model doesn't give up on picture formulas", () => {
    const picture = { inside: ["X"], visible: ["X"], cover: { image: 1, drawn: 0 } };
    const rs: Reading[] = [1, 0.75, 0.5].map((factor) => ({ latex: lift, factor, ...judgeFormula(lift, picture) }));
    const d = decideReading(rs);
    expect(d.confidence).toBeGreaterThan(DECISION_FLAG_BELOW);
    expect(decidedVerdict(rs, d.index, d.confidence)).toEqual({ issues: [], glyphs: null, check: "unchecked", picture: true });
  });
});

describe("a line over the whole formula", () => {
  it("is marked when it spans a relation, as a block frame read as an overline", () => {
    expect(latexIssues("\\overline{\\int_{-\\infty}^{\\infty}e^{-x^{2}}dx=\\sqrt{\\pi}}")).toEqual([expect.stringMatching(/^a line over the whole formula/)]);
    expect(latexIssues("\\overline{A\\cup B}")).toEqual([]);
    expect(latexIssues("\\overline{A\\cup B}=\\bar{A}\\cap\\bar{B}")).toEqual([]);
    expect(latexIssues("\\overline{x_{i=1}}")).toEqual([]);
  });
});

describe("unirecInput", () => {
  it("keeps the crop's size rounded down to multiples of 64, three equal channels in -1…1", () => {
    const w = 200;
    const h = 70;
    const gray = new Uint8Array(w * h).fill(255);
    for (let x = 20; x < 180; x++) gray[35 * w + x] = 0;
    const input = unirecInput(gray, w, h)!;
    expect([input.width, input.height]).toEqual([192, 64]);
    expect(input.data).toHaveLength(3 * 192 * 64);
    expect(input.data[0]).toBeCloseTo(1, 5); // paper
    const plane = 192 * 64;
    let min = Infinity;
    for (let i = 0; i < plane; i++) min = Math.min(min, input.data[i]!);
    expect(min).toBeLessThan(-0.5); // the stroke survives
    expect(input.data[plane + 100]).toBe(input.data[100]);
    expect(input.data[2 * plane + 100]).toBe(input.data[100]);
  });

  it("shrinks a crop wider than 960 to fit, keeping its aspect, and refuses a blank one", () => {
    const gray = new Uint8Array(2000 * 100).fill(255);
    gray[50 * 2000 + 1000] = 0;
    const input = unirecInput(gray, 2000, 100)!;
    expect([input.width, input.height]).toEqual([960, 64]);
    expect(unirecInput(new Uint8Array(100).fill(255), 10, 10)).toBeNull();
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

  it("isSymbolFontCode: digits of TeX's symbol fonts and the AMS symbols are codes, \\mathcal and \\mathbb capitals stay", () => {
    expect(isSymbolFontCode("ABCDEF+CMSY10", "6")).toBe(true); // the slash of ≠
    expect(isSymbolFontCode("ABCDEF+CMSY10", "0")).toBe(true); // ′
    expect(isSymbolFontCode("CMBSY7", "7")).toBe(true);
    expect(isSymbolFontCode("GHIJKL+LMMathSymbols10-Regular", "3")).toBe(true); // ∋
    expect(isSymbolFontCode("ABCDEF+MSAM10", "y")).toBe(true); // ↷
    expect(isSymbolFontCode("ABCDEF+MSBM10", "n")).toBe(true);
    expect(isSymbolFontCode("ABCDEF+MSBM10", "R")).toBe(false); // ℝ
    expect(isSymbolFontCode("ABCDEF+CMSY10", "h")).toBe(true); // ⟨
    expect(isSymbolFontCode("ABCDEF+CMSY10", "A")).toBe(false); // \mathcal{A}
    expect(isSymbolFontCode("ABCDEF+CMR10", "6")).toBe(false);
    expect(isSymbolFontCode("ABCDEF+CMMI10", "y")).toBe(false);
  });

  it("splitAccented and the check: ü is u and ¨ on both sides, set as one glyph or two", () => {
    expect(splitAccented("ü")).toEqual(["u", "¨"]);
    expect(splitAccented("é")).toEqual(["e"]);
    expect(splitAccented("u")).toBeNull();
    expect(splitAccented("ß")).toBeNull();
    expect(foldGlyph("ü")).toBe("u¨");
    // The check counts glyphs as a multiset, so the order an accent comes in does not matter.
    expect(latexGlyphs("\\text{für}").sort()).toEqual(["f", "r", "u", "¨"]);
    expect(latexGlyphs('\\text{f\\"ur}').sort()).toEqual(["f", "r", "u", "¨"]);
    expect(latexGlyphs("\\text{f}\\ddot{\\text{u}}\\text{r}").sort()).toEqual(["f", "r", "u", "¨"]);
    // pdflatex: u and ¨ as two glyphs; other PDFs: one ü.
    expect(compareGlyphs(latexGlyphs("\\text{für}"), ["f", "u", "¨", "r"])).toEqual({ missing: [], extra: [] });
    expect(compareGlyphs(latexGlyphs("\\text{für}"), [..."f" + foldGlyph("ü")! + "r"])).toEqual({ missing: [], extra: [] });
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

describe("assetUpToDate", () => {
  const a = { name: "pp-formulanet_plus-l.onnx", sha256: "new" };
  it.each([
    ["missing file", false, {}, undefined, false],
    ["verified with this pin", true, { [a.name]: "new" }, undefined, true],
    ["verified with an older pin of the same name", true, { [a.name]: "old" }, undefined, false],
    ["installed before records, the old marker names this pin", true, {}, { [a.name]: "new" }, true],
    ["installed before records, the old marker names another pin", true, {}, { [a.name]: "old" }, false],
    ["a run that broke off before any record or marker (files were only put in place once verified)", true, {}, undefined, true],
  ] as const)("%s → %s", (_label, present, verified, legacy, expected) => {
    expect(assetUpToDate(a, present, verified as Record<string, string>, legacy as Record<string, string> | undefined)).toBe(expected);
  });
});

describe("the decision over several readings", () => {
  const reading = (latex: string, factor: number, extra: Partial<Reading> = {}): Reading => ({ latex, factor, issues: [], glyphs: { missing: [], extra: [], pdf: 3 }, check: "match", ...extra });

  it("sameMeaning ignores spelling and sizing, not symbols or structure", () => {
    expect(sameMeaning("\\left( x \\right)^{2}", "(x)^2")).toBe(true);
    expect(sameMeaning("\\frac{a}{b}", "\\frac{b}{a}")).toBe(false);
    expect(sameMeaning("x_{i}", "x^{i}")).toBe(false);
    expect(sameMeaning("\\gamma", "y")).toBe(false);
  });

  it("features: check, agreement with the other readings, scale, length", () => {
    const rs = [reading("x^{2}", 1), reading("x^{2}", 0.75), reading("x_{2}", 0.5, { check: "differs", issues: ["x"] })];
    const f = readingFeatures(rs, 0);
    expect(f.slice(0, 8)).toEqual([1, 1, 0, 0, 0.5, 0.5, 1, 0]);
    expect(readingFeatures(rs, 2).slice(0, 8)).toEqual([0, 0, 1, 0, 0, 0, 0, 0]);
  });

  it("keeps the reading the weights trust most; ties go to the full scale", () => {
    // Weights that only count agreement in meaning.
    const w = [0, 0, 0, 0, 0, 0, 5, 0, 0, 0];
    const rs = [reading("\\gamma", 1), reading("y", 0.75), reading("y", 0.5)];
    expect(decideReading(rs, w).index).toBe(1);
    expect(decideReading([reading("a", 1), reading("a", 0.5)], w).index).toBe(0);
  });

  it("chooses among the readings that pass their check, when any does, and marks it when the others agree against it", () => {
    const bar = "a line over the whole formula: keep \\overline only if the page draws one";
    const rs = [
      reading("\\overline{\\int f=1}", 1, { check: "differs", issues: [bar] }),
      reading("\\overline{\\int f=1}", 0.75, { check: "differs", issues: [bar] }),
      reading("\\int f=1", 0.5),
    ];
    const d = decideReading(rs);
    expect(d.index).toBe(2);
    expect(d.confidence).toBeLessThan(DECISION_FLAG_BELOW);
    expect(decidedVerdict(rs, d.index, d.confidence).check).toBe("differs");
    // None passes: the model chooses among all of them.
    const none = rs.slice(0, 2);
    expect(decideReading(none).index).toBe(0);
  });

  it("an unsure reading whose check passed is marked, naming what the other readings saw", () => {
    const rs = [reading("\\gamma", 1, { check: "unchecked", glyphs: null }), reading("y", 0.5, { check: "unchecked", glyphs: null })];
    expect(decidedVerdict(rs, 0, DECISION_FLAG_BELOW + 0.01)).toEqual({ issues: [], glyphs: null, check: "unchecked" });
    expect(decidedVerdict(rs, 0, DECISION_FLAG_BELOW - 0.01)).toEqual({ issues: ["read differently at lower resolution: `y`"], glyphs: null, check: "differs" });
  });
});
