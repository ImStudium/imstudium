/**
 * Hard lecture slides: synthetic Beamer decks typeset by pdflatex, the way most
 * maths and CS lecturers make their slides. Dense derivations, cases, matrices,
 * nested fractions, binomials, norms, quantifiers, small type, coloured blocks
 * and two columns, with inline math in the bullets. The same frames are built
 * twice, with Beamer's default sans-serif math and with serif math, and each
 * deck also as a degraded scan. A third deck is the everyday case: 4:3 slides
 * in Beamer's default theme and sans-serif math, with the formulas inside the
 * bullets (a display formula under an item, `$\displaystyle …$` after its
 * text, or an item that is only a formula), bold vectors and `\min`/`\max`.
 *
 * Every formula and sentence here is written for the benchmark; no course
 * material. Needs pdflatex with beamer and amsmath (TeX Live); skipped
 * otherwise.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Display formulas, in the order they appear on the slides. KaTeX and amsmath both accept every one. */
export const BEAMER_FORMULAS = [
  "\\begin{aligned} (a+b)^2 &= (a+b)(a+b) \\\\ &= a^2 + 2ab + b^2 \\end{aligned}",
  "|x| = \\begin{cases} x & x \\ge 0 \\\\ -x & x < 0 \\end{cases}",
  "A = \\begin{pmatrix} 1 & 0 & 2 \\\\ -1 & 3 & 1 \\\\ 0 & 4 & -2 \\end{pmatrix}",
  "x = \\frac{1}{1 + \\frac{1}{1 + \\frac{1}{y}}}",
  "\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}",
  "\\binom{n}{k} = \\frac{n!}{k!\\,(n-k)!}",
  "\\|x\\|_2 = \\sqrt{\\sum_{i=1}^{n} x_i^2}",
  "\\forall \\varepsilon > 0 \\; \\exists \\delta > 0 : |x - x_0| < \\delta \\Rightarrow |f(x) - f(x_0)| < \\varepsilon",
  "M = \\{ x \\in \\mathbb{R} \\mid x^2 < 2 \\}",
  "\\prod_{i=1}^{n} (1 + x_i) \\ge 1 + \\sum_{i=1}^{n} x_i",
  "f(x) = \\sum_{k=0}^{\\infty} \\frac{f^{(k)}(a)}{k!} (x - a)^k",
  "\\limsup_{n \\to \\infty} \\sqrt[n]{|a_n|} < 1",
  "\\nabla f(x, y) = \\left( \\frac{\\partial f}{\\partial x}, \\frac{\\partial f}{\\partial y} \\right)^{\\top}",
  "P\\left( \\bigcup_{i=1}^{n} A_i \\right) \\le \\sum_{i=1}^{n} P(A_i)",
  "T(n) = \\begin{cases} 1 & n = 1 \\\\ 2\\,T(n/2) + n & n > 1 \\end{cases}",
  "\\hat{\\theta} = \\arg\\max_{\\theta} \\sum_{i=1}^{n} \\log p(x_i \\mid \\theta)",
  "P(B_j \\mid A) = \\frac{P(A \\mid B_j)\\,P(B_j)}{\\sum_{i=1}^{m} P(A \\mid B_i)\\,P(B_i)}",
  "\\underbrace{1 + 1 + \\cdots + 1}_{n} = n",
  "\\Gamma(z) = \\int_{0}^{\\infty} t^{z-1} e^{-t}\\,dt",
  "A = \\begin{pmatrix} a_{11} & \\cdots & a_{1n} \\\\ \\vdots & \\ddots & \\vdots \\\\ a_{m1} & \\cdots & a_{mn} \\end{pmatrix}",
  "\\neg (A \\land B) \\equiv \\neg A \\lor \\neg B",
  "\\mathcal{O}(n \\log n) \\subsetneq \\mathcal{O}(n^2)",
  "a \\equiv b \\pmod{m}",
  "\\iint_{D} (x^2 + y^2)\\,dA = \\int_{0}^{2\\pi} \\int_{0}^{1} r^3\\,dr\\,d\\varphi",
  "\\det A = \\sum_{\\sigma \\in S_n} \\operatorname{sgn}(\\sigma) \\prod_{i=1}^{n} a_{i,\\sigma(i)}",
  "\\hat{f}(\\xi) = \\int_{\\mathbb{R}} f(x)\\, e^{-2\\pi i x \\xi}\\,dx",
  "\\begin{aligned} \\operatorname{Var}(X) &= E[(X - \\mu)^2] \\\\ &= E[X^2] - 2\\mu E[X] + \\mu^2 \\\\ &= E[X^2] - \\mu^2 \\end{aligned}",
  "E[X \\mid Y = y] = \\sum_{x} x \\, P(X = x \\mid Y = y)",
];

/**
 * The 4:3 bullets deck. The first three are the kind a live run on real Beamer
 * slides read badly with the small models (textbook formulas, written here).
 */
export const BULLET_FORMULAS = [
  "A=(1,0,0),\\ B=(0,1,0),\\ C=(0,0,1)",
  "\\tilde{x}=\\frac{x-\\bar{x}}{\\sigma}",
  "\\tilde{x}=\\frac{x-\\min}{\\max-\\min}",
  "\\overrightarrow{AB}=B-A=(-1,1,0)",
  "d(x,y)=\\sqrt{\\sum_{i=1}^{n}(x_i-y_i)^2}",
  "\\|x\\|_1=\\sum_{i=1}^{n}|x_i|",
  "\\hat{y}=\\arg\\max_{c}\\sum_{i\\in N_k(x)}[y_i=c]",
  "s^2=\\frac{1}{n-1}\\sum_{i=1}^{n}(x_i-\\bar{x})^2",
  "\\mathbf{w}^\\top\\mathbf{x}+b=0",
  "\\boldsymbol{\\mu}=\\frac{1}{n}\\sum_{i=1}^{n}\\boldsymbol{x}_i",
  "\\sigma(z)=\\frac{1}{1+e^{-z}}",
  "L(\\theta)=-\\sum_{i=1}^{n}y_i\\log\\hat{y}_i",
  "\\nabla_{\\theta}J=\\frac{1}{m}X^\\top(X\\theta-y)",
  "\\theta\\leftarrow\\theta-\\eta\\,\\nabla_{\\theta}J",
  "\\mathrm{Acc}=\\frac{TP+TN}{TP+TN+FP+FN}",
  "H(X)=-\\sum_{x}p(x)\\log_2 p(x)",
];

/** How a formula sits in its bullet: displayed under the item's text, `$\displaystyle …$` after it, or alone in the item. */
type BulletStyle = "display" | "after" | "alone";

interface BulletFrame {
  title: string;
  /** The frame's opening bullet, with inline math. */
  lead: string;
  items: Array<{ text: string; style: BulletStyle; formula: number }>;
}

const BULLET_FRAMES: BulletFrame[] = [
  { title: "Punkte im Raum", lead: "Gegeben sind drei Punkte im $\\mathbb{R}^3$:", items: [{ text: "Einheitspunkte", style: "display", formula: 0 }, { text: "Verbindungsvektor:", style: "after", formula: 3 }] },
  { title: "Normalisierung", lead: "Merkmale auf eine Skala bringen, $x \\in \\mathbb{R}$:", items: [{ text: "z-Score", style: "display", formula: 1 }, { text: "Min-Max-Skalierung", style: "display", formula: 2 }] },
  { title: "Abstände", lead: "Für $x, y \\in \\mathbb{R}^n$:", items: [{ text: "Euklidisch:", style: "after", formula: 4 }, { text: "", style: "alone", formula: 5 }] },
  { title: "k-Nearest-Neighbor", lead: "Mehrheitsentscheid unter den $k$ nächsten Nachbarn:", items: [{ text: "Vorhersage", style: "display", formula: 6 }, { text: "Stichprobenvarianz:", style: "after", formula: 7 }] },
  { title: "Lineare Modelle", lead: "Trennebene mit Gewichten $\\mathbf{w}$ und Bias $b$:", items: [{ text: "", style: "alone", formula: 8 }, { text: "Mittelwertvektor", style: "display", formula: 9 }] },
  { title: "Logistische Regression", lead: "Wahrscheinlichkeit für Klasse $1$:", items: [{ text: "Sigmoid:", style: "after", formula: 10 }, { text: "Kreuzentropie", style: "display", formula: 11 }] },
  { title: "Gradientenabstieg", lead: "Lernrate $\\eta > 0$, $m$ Beispiele:", items: [{ text: "Gradient", style: "display", formula: 12 }, { text: "", style: "alone", formula: 13 }] },
  { title: "Bewertung", lead: "Konfusionsmatrix mit $TP, TN, FP, FN$:", items: [{ text: "Genauigkeit:", style: "after", formula: 14 }, { text: "Entropie", style: "display", formula: 15 }] },
];

function bulletFrameTex(f: BulletFrame): string {
  const item = ({ text, style, formula }: BulletFrame["items"][number]) => {
    const tex = BULLET_FORMULAS[formula]!;
    if (style === "display") return `  \\item ${text}\n  \\[ ${tex} \\]`;
    if (style === "after") return `  \\item ${text} $\\displaystyle ${tex}$`;
    return `  \\item $\\displaystyle ${tex}$`;
  };
  return `\\begin{frame}{${f.title}}\n\\begin{itemize}\n  \\item ${f.lead}\n${f.items.map(item).join("\n")}\n\\end{itemize}\n\\end{frame}`;
}

function bulletDeckTex(): string {
  return [
    "\\documentclass{beamer}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage{amsmath,amssymb}",
    "\\setbeamertemplate{navigation symbols}{}",
    "\\title{Maschinelles Lernen}",
    "\\date{}",
    "\\begin{document}",
    ...BULLET_FRAMES.map(bulletFrameTex),
    "\\end{document}",
    "",
  ].join("\n");
}

type Layout = "stack" | "block" | "columns" | "small";

interface Frame {
  title: string;
  layout: Layout;
  bullets: string[];
  /** Indexes into BEAMER_FORMULAS. */
  formulas: number[];
}

/** Ten frames, each mixing bullets with inline math and 2–4 display formulas. */
const FRAMES: Frame[] = [
  { title: "Binomische Formeln", layout: "stack", bullets: ["Für alle $a, b \\in \\mathbb{R}$ gilt:", "Der Betrag ist stückweise definiert, $|x| \\ge 0$."], formulas: [0, 1] },
  { title: "Matrizen und Kettenbrüche", layout: "columns", bullets: ["$A$ ist eine $3 \\times 3$-Matrix.", "Für $y > 0$ konvergiert der Kettenbruch."], formulas: [2, 3] },
  { title: "Integrale und Kombinatorik", layout: "block", bullets: ["Gauß-Integral mit $e^{-x^2}$", "Für $0 \\le k \\le n$:"], formulas: [4, 5, 6] },
  { title: "Stetigkeit", layout: "stack", bullets: ["$f$ ist stetig in $x_0$, wenn:", "Die Menge $M$ ist beschränkt."], formulas: [7, 8] },
  { title: "Ungleichungen und Reihen", layout: "small", bullets: ["Für $x_i \\ge 0$ gilt:", "Taylorreihe um $a$, Wurzelkriterium für $(a_n)$:"], formulas: [9, 10, 11] },
  { title: "Gradient und Wahrscheinlichkeit", layout: "columns", bullets: ["$\\nabla f$ zeigt in Richtung des stärksten Anstiegs.", "Für Ereignisse $A_1, \\dots, A_n$:"], formulas: [12, 13] },
  { title: "Rekursion und Schätzer", layout: "block", bullets: ["Mergesort: $T(n) \\in \\Theta(n \\log n)$", "Maximum-Likelihood für $\\theta$:", "Satz von Bayes für $B_1, \\dots, B_m$:"], formulas: [14, 15, 16] },
  { title: "Summen, Gamma, Matrizen", layout: "stack", bullets: ["Für $z > 0$ und $n \\in \\mathbb{N}$:"], formulas: [17, 18, 19] },
  { title: "Logik und Komplexität", layout: "small", bullets: ["De Morgan, Landau-Symbole und Kongruenz modulo $m$:", "Polarkoordinaten mit $x = r\\cos\\varphi$:"], formulas: [20, 21, 22, 23] },
  { title: "Determinante, Fourier, Varianz", layout: "stack", bullets: ["Leibniz-Formel, Fourier-Transformation, Varianz von $X$:"], formulas: [24, 25, 26, 27] },
];

function frameTex(f: Frame): string {
  const items = `\\begin{itemize}\n${f.bullets.map((b) => `  \\item ${b}`).join("\n")}\n\\end{itemize}`;
  const display = (i: number) => `\\[ ${BEAMER_FORMULAS[i]} \\]`;
  let body: string;
  switch (f.layout) {
    case "block":
      body = `${items}\n\\begin{block}{Merke}\n${f.formulas.map(display).join("\n")}\n\\end{block}`;
      break;
    case "columns":
      body = `\\begin{columns}[T]\n\\begin{column}{0.55\\textwidth}\n${f.formulas.map(display).join("\n")}\n\\end{column}\n\\begin{column}{0.4\\textwidth}\n${items}\n\\end{column}\n\\end{columns}`;
      break;
    case "small":
      body = `${items}\n{\\small\n${f.formulas.map(display).join("\n")}\n}`;
      break;
    default:
      body = `${items}\n${f.formulas.map(display).join("\n")}`;
  }
  return `\\begin{frame}{${f.title}}\n${body}\n\\end{frame}`;
}

function deckTex(serif: boolean): string {
  return [
    "\\documentclass[aspectratio=169]{beamer}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage{amsmath,amssymb}",
    "\\usetheme{Madrid}",
    serif ? "\\usefonttheme[onlymath]{serif}" : "",
    "\\setbeamertemplate{navigation symbols}{}",
    "\\title{Mathematik für Informatik}",
    "\\date{}",
    "\\begin{document}",
    ...FRAMES.map(frameTex),
    "\\end{document}",
    "",
  ].join("\n");
}

/** True when pdflatex and beamer are installed. */
export function hasBeamer(): boolean {
  const r = spawnSync("kpsewhich", ["beamer.cls"], { encoding: "utf-8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

export interface BeamerDeck {
  name: string;
  pdf: string;
  /** Display formulas per page, in reading order. */
  formulas: string[][];
  /** Inline formulas per page (not read as LaTeX yet; listed for the record). */
  inline: string[][];
}

/** Writes beamer-sans.pdf, beamer-serif.pdf and beamer-bullets.pdf into `dir`. */
export async function buildBeamerDecks(dir: string, log: (s: string) => void): Promise<BeamerDeck[]> {
  const decks: BeamerDeck[] = [];
  const work = join(dir, "beamer-tex");
  await mkdir(work, { recursive: true });
  const sources = [
    { name: "beamer-sans", tex: deckTex(false), frames: FRAMES.length },
    { name: "beamer-serif", tex: deckTex(true), frames: FRAMES.length },
    { name: "beamer-bullets", tex: bulletDeckTex(), frames: BULLET_FRAMES.length },
  ];
  for (const { name, tex, frames } of sources) {
    log(`fixtures: ${name} (pdflatex, ${frames} frames)`);
    await writeFile(join(work, `${name}.tex`), tex);
    try {
      // Twice, so the frame numbers in the footer are right.
      for (let pass = 0; pass < 2; pass++) execFileSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", `${name}.tex`], { cwd: work, stdio: "pipe" });
    } catch (err) {
      const logText = await readFile(join(work, `${name}.log`), "utf-8").catch(() => "");
      throw new Error(`pdflatex failed for ${name}: ${logText.split("\n").filter((l) => l.startsWith("!")).join(" ") || String(err)}`);
    }
    const pdf = join(dir, `${name}.pdf`);
    await writeFile(pdf, await readFile(join(work, `${name}.pdf`)));
    const bullets = name === "beamer-bullets";
    decks.push({
      name,
      pdf,
      formulas: bullets ? BULLET_FRAMES.map((f) => f.items.map((i) => BULLET_FORMULAS[i.formula]!)) : FRAMES.map((f) => f.formulas.map((i) => BEAMER_FORMULAS[i]!)),
      inline: bullets
        ? BULLET_FRAMES.map((f) => [...f.lead.matchAll(/\$([^$]+)\$/g)].map((m) => m[1]!))
        : FRAMES.map((f) => f.bullets.flatMap((b) => [...b.matchAll(/\$([^$]+)\$/g)].map((m) => m[1]!))),
    });
  }
  await rm(work, { recursive: true, force: true });
  return decks;
}
