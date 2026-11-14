/**
 * Synthetic benchmark fixtures: no university material, no real names. Every
 * page is generated here from a fixed seed, typeset by Chromium (through the
 * SDK's Playwright) and KaTeX, and written twice:
 *
 *   <set>.pdf        Chromium's PDF, with a text layer (born-digital)
 *   <set>-scan.pdf   the same pages as JPEG screenshots, grey, slightly
 *                    blurred and tilted, wrapped one image per page (no text)
 *
 * Sets: prose (A4 lecture-script pages), slides (16:9, bullets, a table and a
 * box-and-arrow diagram), formulas (A4 pages with display formulas),
 * picture-formulas (16:9 slides whose formulas are pasted-in pictures next
 * to real slide text, the way PowerPoint decks often have them). The
 * ground truth (truth.json) is the text Chromium laid out, read back from the
 * DOM, and the LaTeX source of every formula.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildBeamerDecks, hasBeamer } from "./beamer.ts";

export interface PageTruth {
  text: string;
  formulas: string[];
  /** Inline formulas on the page (Beamer decks), recorded but not scored as LaTeX. */
  inline?: string[];
}
export interface SetTruth {
  name: string;
  kind: "prose" | "slides" | "formulas";
  pages: PageTruth[];
}
export interface Truth {
  seed: number;
  generatedAt: string;
  chromium: string;
  sets: SetTruth[];
}

const SEED = 2026;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOUNS = ["Verteilung", "Stichprobe", "Hypothese", "Varianz", "Datenbank", "Abfrage", "Relation", "Transaktion", "Laufzeit", "Komplexität", "Funktion", "Ableitung", "Matrix", "Schätzung", "Regression", "Schnittstelle", "Größe", "Übung", "Vorlesung", "Klausur", "Methode", "Annahme", "Prüfung", "Gleichung", "Schranke", "Menge", "Folge", "Reihe", "Messung", "Lösung"];
const ADJ = ["diskrete", "stetige", "lineare", "effiziente", "robuste", "zufällige", "große", "kleine", "unabhängige", "gemeinsame", "bedingte", "obere", "untere", "endliche", "geschätzte", "äußere", "übliche", "mögliche"];
const VERBS = ["beschreibt", "bestimmt", "liefert", "verändert", "enthält", "berechnet", "schätzt", "prüft", "begrenzt", "erklärt", "ersetzt", "verbindet"];
const OPEN = ["Daher", "Außerdem", "Im Folgenden", "Zum Beispiel", "Anschließend", "Insbesondere", "Grundsätzlich", "Ebenso", "Schließlich", "Häufig"];
const TAIL = ["in jedem Schritt", "für alle Werte", "mit hoher Wahrscheinlichkeit", "im schlimmsten Fall", "nach Satz 3.2", "auf Seite 14", "um 25 %", "bis zum Ende der Woche", "ohne weitere Annahmen", "in der Übung am Dienstag"];
const TOPICS = ["Sortierverfahren", "Hypothesentests", "Normalformen", "Eigenwerte", "Konfidenzintervalle", "Graphalgorithmen", "Transaktionen", "Lineare Regression", "Komplexitätsklassen", "Taylorreihen", "Indexstrukturen", "Markow-Ketten"];

const FORMULAS = [
  "E[X] = \\sum_{i=1}^{n} x_i \\, p(x_i)",
  "\\operatorname{Var}(X) = E[X^2] - (E[X])^2",
  "f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}",
  "\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)",
  "\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n = e",
  "A\\mathbf{x} = \\lambda \\mathbf{x}",
  "\\det(A - \\lambda I) = 0",
  "\\hat{\\beta} = (X^\\top X)^{-1} X^\\top y",
  "P(A \\mid B) = \\frac{P(B \\mid A)\\,P(A)}{P(B)}",
  "\\sum_{k=0}^{n} \\binom{n}{k} = 2^n",
  "\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}",
  "e^{i\\pi} + 1 = 0",
  "\\frac{\\partial f}{\\partial x} = 2x + y",
  "T(n) = 2\\,T\\left(\\frac{n}{2}\\right) + O(n)",
  "\\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i",
  "s^2 = \\frac{1}{n-1} \\sum_{i=1}^{n} (x_i - \\bar{x})^2",
  "\\sqrt{a^2 + b^2} \\le |a| + |b|",
  "|x - x_0| < \\delta \\Rightarrow |f(x) - f(x_0)| < \\varepsilon",
  "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}^{-1} = \\frac{1}{ad - bc} \\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}",
  "F = m\\,a",
  "\\sum_{i=1}^{\\infty} \\frac{1}{i^2} = \\frac{\\pi^2}{6}",
  "\\log_2(n!) \\in \\Theta(n \\log n)",
  "z = \\frac{\\bar{x} - \\mu_0}{\\sigma / \\sqrt{n}}",
  "\\int_0^1 x^2\\,dx = \\frac{1}{3}",
];

/** Formulas of the picture-formulas slides: each pasted in as an image, two per slide. */
const PICTURE_FORMULAS = [
  "\\operatorname{conf}(X \\to Y) = \\frac{s(X \\cup Y)}{s(X)}",
  "\\operatorname{lift}(X \\to Y) = \\frac{p(Y \\mid X)}{p(Y)}",
  "H(X) = -\\sum_{i=1}^{n} p_i \\log_2 p_i",
  "\\operatorname{Gini}(D) = 1 - \\sum_{k=1}^{K} p_k^2",
  "\\sigma(z) = \\frac{1}{1 + e^{-z}}",
  "d(x, y) = \\sqrt{\\sum_{i=1}^{n} (x_i - y_i)^2}",
  "w_{t+1} = w_t - \\eta \\, \\nabla L(w_t)",
  "F_1 = \\frac{2 \\, P \\, R}{P + R}",
];
/** Typeset as text on the last picture slide, so one slide mixes both. */
const TYPESET_ON_PICTURE_SLIDE = "P = \\frac{TP}{TP + FP}";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function generator(seed: number) {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const sentence = () => `${pick(OPEN)} ${pick(VERBS)} die ${pick(ADJ)} ${pick(NOUNS)} die ${pick(NOUNS)} ${pick(TAIL)}.`;
  const paragraph = (n: number) => Array.from({ length: n }, sentence).join(" ");
  const bullet = () => `Die ${pick(ADJ)} ${pick(NOUNS)} ${pick(VERBS)} die ${pick(NOUNS)}`;
  return { rnd, pick, sentence, paragraph, bullet };
}

const PAGE_CSS = (w: number, h: number, scan: boolean) => `
  @page { size: ${w}px ${h}px; margin: 0 }
  html, body { margin: 0; padding: 0; background: ${scan ? "#f3f1ea" : "#fff"} }
  .page { box-sizing: border-box; width: ${w}px; height: ${h}px; overflow: hidden; page-break-after: always; break-after: page; color: #111;
          font-family: "DejaVu Serif", "Liberation Serif", Georgia, serif; position: relative;
          ${scan ? SCAN_FILTER : ""} }
  .prose { padding: 72px 80px; font-size: 16px; line-height: 1.55 }
  .prose h1 { font-size: 26px; margin: 0 0 18px } .prose p { margin: 0 0 12px; text-align: justify }
  .slide { padding: 48px 64px; font-family: "DejaVu Sans", "Liberation Sans", Arial, sans-serif }
  .slide h1 { font-size: 40px; margin: 0 0 24px; color: #1d3557 } .slide ul { font-size: 24px; margin: 0 0 20px; padding-left: 28px } .slide li { margin: 6px 0 }
  .row { display: flex; gap: 40px; align-items: flex-start }
  table { border-collapse: collapse; font-size: 20px } td, th { border: 1.5px solid #333; padding: 6px 14px } th { background: ${scan ? "#ddd" : "#e8eef7"} }
  .formula { margin: 18px 0; font-size: 21px }
  .slide .formula { margin: 10px 0 10px 28px; font-size: 30px } .slide .note { font-size: 20px; margin: 4px 0 8px 28px }
`;

function proseHtml(g: ReturnType<typeof generator>, n: number): string {
  return `<div class="page prose"><h1>Kapitel ${n}: ${esc(g.pick(TOPICS))}</h1>${Array.from({ length: 6 }, () => `<p>${esc(g.paragraph(4))}</p>`).join("")}</div>`;
}

function slideHtml(g: ReturnType<typeof generator>, n: number): string {
  const bullets = Array.from({ length: 3 }, () => `<li>${esc(g.bullet())}</li>`).join("");
  const table = `<table><tr><th>Verfahren</th><th>Laufzeit</th><th>Stabil</th></tr>${["Quicksort", "Mergesort", "Heapsort"]
    .map((v) => `<tr><td>${v}</td><td>${g.pick(["O(n log n)", "O(n²)", "O(n)"])}</td><td>${g.pick(["ja", "nein"])}</td></tr>`)
    .join("")}</table>`;
  const labels = [g.pick(["Client", "Browser", "Sensor"]), g.pick(["Server", "Dienst", "Broker"]), g.pick(["Datenbank", "Speicher", "Archiv"])];
  const diagram = `<svg width="430" height="250" viewBox="0 0 430 250" font-family="DejaVu Sans, Arial" font-size="20">
    <defs><marker id="a${n}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#333"/></marker></defs>
    ${labels.map((l, i) => `<rect x="${10 + i * 145}" y="90" width="120" height="60" rx="8" fill="#fff" stroke="#1d3557" stroke-width="2"/><text x="${70 + i * 145}" y="127" text-anchor="middle">${l}</text>`).join("")}
    <line x1="130" y1="120" x2="153" y2="120" stroke="#333" stroke-width="2" marker-end="url(#a${n})"/>
    <line x1="275" y1="120" x2="298" y2="120" stroke="#333" stroke-width="2" marker-end="url(#a${n})"/>
    <text x="215" y="210" text-anchor="middle" font-size="18">Abbildung ${n}: Datenfluss</text></svg>`;
  return `<div class="page slide"><h1>${n}. ${esc(g.pick(TOPICS))}</h1><ul>${bullets}</ul><div class="row">${table}${diagram}</div></div>`;
}

function formulaHtml(g: ReturnType<typeof generator>, n: number, latex: string[], katex: { renderToString(s: string, o: object): string }): string {
  const parts = [`<h1>Beispiel ${n}: ${esc(g.pick(TOPICS))}</h1>`];
  for (const f of latex) {
    parts.push(`<p>${esc(g.sentence())}</p>`, `<div class="formula" data-latex="${esc(f)}">${katex.renderToString(f, { displayMode: true, throwOnError: true, output: "html" })}</div>`);
  }
  return `<div class="page prose">${parts.join("")}</div>`;
}

/** A formula typeset by KaTeX and cut out as a PNG at 2× (a pasted picture: no text in the PDF), with its size on the slide in CSS pixels. */
async function formulaPicture(browser: Browser, katex: { renderToString(s: string, o: object): string }, katexCss: string, dir: string, latex: string, n: number): Promise<{ png: string; width: number; height: number }> {
  const tab = await browser.newPage({ viewport: { width: 1200, height: 400 }, deviceScaleFactor: 2 });
  const f = join(dir, `picture-formula-${n}.html`);
  await writeFile(
    f,
    `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="file://${katexCss}"><style>body{margin:0;background:#fff} #f{display:inline-block;padding:4px 8px;font-size:30px} .katex-display{margin:0}</style></head><body><div id="f">${katex.renderToString(latex, { displayMode: true, throwOnError: true, output: "html" })}</div></body></html>`,
  );
  await tab.goto(`file://${f}`);
  const clip = await tab.evaluate<{ x: number; y: number; width: number; height: number }>(
    `(() => { const b = document.getElementById("f").getBoundingClientRect(); return { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.width), height: Math.ceil(b.height) }; })()`,
  );
  const png = await tab.screenshot({ type: "png", clip });
  await tab.close();
  return { png: Buffer.from(png).toString("base64"), width: clip.width, height: clip.height };
}

function pictureSlideHtml(g: ReturnType<typeof generator>, n: number, pictures: Array<{ latex: string; png: string; width: number; height: number }>, typeset: string | null, katex: { renderToString(s: string, o: object): string }): string {
  const parts = [`<h1>${n}. ${esc(g.pick(TOPICS))}</h1>`, `<ul><li>${esc(g.bullet())}</li></ul>`];
  for (const p of pictures) {
    parts.push(`<div class="formula" data-latex="${esc(p.latex)}"><img alt="" src="data:image/png;base64,${p.png}" style="width:${p.width}px;height:${p.height}px"></div>`, `<p class="note">${esc(g.sentence())}</p>`);
  }
  if (typeset) parts.push(`<div class="formula" data-latex="${esc(typeset)}">${katex.renderToString(typeset, { displayMode: true, throwOnError: true, output: "html" })}</div>`);
  return `<div class="page slide">${parts.join("")}</div>`;
}

/** Playwright's Chromium, or the newest one in the Playwright cache when the pinned revision isn't installed. */
async function launchChromium(chromium: { launch(o?: object): Promise<unknown> }): Promise<{ browser: Browser; version: string }> {
  const tryLaunch = async (executablePath?: string) => {
    const browser = (await chromium.launch(executablePath ? { executablePath } : {})) as Browser;
    return { browser, version: browser.version() };
  };
  if (process.env.IMSTUDIUM_BENCH_CHROMIUM) return tryLaunch(process.env.IMSTUDIUM_BENCH_CHROMIUM);
  try {
    return await tryLaunch();
  } catch (err) {
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
    const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])) : [];
    for (const d of dirs) {
      for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-win64/chrome.exe"]) {
        if (existsSync(join(cache, d, rel))) return tryLaunch(join(cache, d, rel));
      }
    }
    throw new Error(`No Chromium for the benchmark (${err instanceof Error ? err.message.split("\n")[0] : err}). Run: npx playwright install chromium, or set IMSTUDIUM_BENCH_CHROMIUM`);
  }
}

interface Browser {
  version(): string;
  newPage(o?: object): Promise<Page>;
  close(): Promise<void>;
}
interface Page {
  goto(url: string): Promise<unknown>;
  setContent(html: string): Promise<unknown>;
  pdf(o: object): Promise<Buffer>;
  screenshot(o: object): Promise<Buffer>;
  evaluate<T>(fn: string): Promise<T>;
  close(): Promise<void>;
}

export interface FixtureTools {
  imagesToPdf: (images: Uint8Array[], dpi: number) => Buffer | null;
  /** With the math runtime: renders PDF pages (used to scan the Beamer decks). */
  renderPdfPages?: (pdf: Uint8Array, o: { dpi?: number }) => Promise<Array<{ width: number; height: number; rgba: Uint8Array }>>;
  encodePng?: (data: Uint8Array, w: number, h: number, channels: 1 | 4) => Buffer;
}

const SCAN_FILTER = "filter: grayscale(1) contrast(1.15) blur(0.45px); transform: rotate(0.35deg);";

/** Generate every set into `dir`; returns the ground truth (also written to truth.json). */
export async function generateFixtures(root: string, dir: string, tools: FixtureTools, log: (s: string) => void = () => {}): Promise<Truth> {
  const { imagesToPdf } = tools;
  await mkdir(dir, { recursive: true });
  const req = createRequire(join(root, "packages", "sdk", "package.json"));
  const { chromium } = req("playwright") as { chromium: { launch(o?: object): Promise<unknown> } };
  const katex = createRequire(join(root, "package.json"))("katex") as { renderToString(s: string, o: object): string };
  const katexCss = join(root, "node_modules", "katex", "dist", "katex.min.css");
  const { browser, version } = await launchChromium(chromium);
  const g = generator(SEED);
  const sets: Array<{ name: string; kind: SetTruth["kind"]; w: number; h: number; dpr: number; pages: string[]; formulas: string[][] }> = [];

  sets.push({ name: "prose", kind: "prose", w: 794, h: 1123, dpr: 2, pages: Array.from({ length: 8 }, (_, i) => proseHtml(g, i + 1)), formulas: [] });
  sets.push({ name: "slides", kind: "slides", w: 1280, h: 720, dpr: 1.5, pages: Array.from({ length: 8 }, (_, i) => slideHtml(g, i + 1)), formulas: [] });
  const groups = Array.from({ length: 6 }, (_, i) => FORMULAS.slice(i * 4, i * 4 + 4));
  sets.push({ name: "formulas", kind: "formulas", w: 794, h: 1123, dpr: 2, pages: groups.map((f, i) => formulaHtml(g, i + 1, f, katex)), formulas: groups });
  const pictures: Array<{ latex: string; png: string; width: number; height: number }> = [];
  for (const [i, latex] of PICTURE_FORMULAS.entries()) pictures.push({ latex, ...(await formulaPicture(browser, katex, katexCss, dir, latex, i + 1)) });
  const pairs = Array.from({ length: PICTURE_FORMULAS.length / 2 }, (_, i) => pictures.slice(i * 2, i * 2 + 2));
  sets.push({
    name: "picture-formulas",
    kind: "formulas",
    w: 1280,
    h: 720,
    dpr: 1.5,
    pages: pairs.map((p, i) => pictureSlideHtml(g, i + 1, p, i === pairs.length - 1 ? TYPESET_ON_PICTURE_SLIDE : null, katex)),
    formulas: pairs.map((p, i) => [...p.map((x) => x.latex), ...(i === pairs.length - 1 ? [TYPESET_ON_PICTURE_SLIDE] : [])]),
  });

  const truth: Truth = { seed: SEED, generatedAt: new Date().toISOString(), chromium: version, sets: [] };
  try {
    for (const set of sets) {
      log(`fixtures: ${set.name} (${set.pages.length} pages)`);
      const doc = (body: string, scan: boolean) =>
        `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="file://${katexCss}"><style>${PAGE_CSS(set.w, set.h, scan)}</style></head><body>${body}</body></html>`;
      // Text-layer PDF: all pages in one document.
      const page = await browser.newPage({ viewport: { width: set.w, height: set.h } });
      const htmlFile = join(dir, `${set.name}.html`);
      await writeFile(htmlFile, doc(set.pages.join(""), false));
      await page.goto(`file://${htmlFile}`);
      await writeFile(join(dir, `${set.name}.pdf`), await page.pdf({ width: `${set.w}px`, height: `${set.h}px`, printBackground: true, preferCSSPageSize: true }));
      const texts = await page.evaluate<string[]>(
        `[...document.querySelectorAll(".page")].map((p) => { const c = p.cloneNode(true); c.querySelectorAll(".formula").forEach((f) => f.remove()); document.body.appendChild(c); const t = c.innerText; c.remove(); return t; })`,
      );
      await page.close();
      // Scans: one degraded JPEG screenshot per page.
      const shots: Uint8Array[] = [];
      const scanPage = await browser.newPage({ viewport: { width: set.w, height: set.h }, deviceScaleFactor: set.dpr });
      for (let i = 0; i < set.pages.length; i++) {
        const f = join(dir, `${set.name}-scan-${i + 1}.html`);
        await writeFile(f, doc(set.pages[i]!, true));
        await scanPage.goto(`file://${f}`);
        shots.push(await scanPage.screenshot({ type: "jpeg", quality: 72 }));
      }
      await scanPage.close();
      const scanPdf = imagesToPdf(shots, 96 * set.dpr);
      if (!scanPdf) throw new Error(`could not wrap the ${set.name} scans`);
      await writeFile(join(dir, `${set.name}-scan.pdf`), scanPdf);
      truth.sets.push({ name: set.name, kind: set.kind, pages: texts.map((text, i) => ({ text, formulas: set.formulas[i] ?? [] })) });
    }

    // Hard slides: pdflatex Beamer decks, scanned by rendering each page at 200 dpi and degrading it like the others.
    if (!hasBeamer()) log("fixtures: no pdflatex/beamer, skipping the Beamer decks");
    else if (!tools.renderPdfPages || !tools.encodePng) log("fixtures: no math runtime to render pages, skipping the Beamer decks");
    else {
      const SCAN_DPI = 200;
      for (const deck of await buildBeamerDecks(dir, log)) {
        const pages = await tools.renderPdfPages(new Uint8Array(await readFile(deck.pdf)), { dpi: SCAN_DPI });
        const shots: Uint8Array[] = [];
        for (const p of pages) {
          const png = tools.encodePng(p.rgba, p.width, p.height, 4).toString("base64");
          const tab = await browser.newPage({ viewport: { width: p.width, height: p.height } });
          await tab.setContent(`<html><body style="margin:0;background:#f3f1ea;overflow:hidden"><img style="display:block;${SCAN_FILTER}" src="data:image/png;base64,${png}"></body></html>`);
          shots.push(await tab.screenshot({ type: "jpeg", quality: 72 }));
          await tab.close();
        }
        const scanPdf = imagesToPdf(shots, SCAN_DPI);
        if (!scanPdf) throw new Error(`could not wrap the ${deck.name} scans`);
        await writeFile(join(dir, `${deck.name}-scan.pdf`), scanPdf);
        truth.sets.push({ name: deck.name, kind: "formulas", pages: deck.formulas.map((formulas, i) => ({ text: "", formulas, inline: deck.inline[i] ?? [] })) });
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(dir, "truth.json"), `${JSON.stringify(truth, null, 2)}\n`);
  return truth;
}
