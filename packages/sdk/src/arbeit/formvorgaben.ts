import { ImstudiumError } from "../errors.js";
import type { Formvorgaben, Nummerierung } from "./types.js";

/**
 * Formvorgaben presets. Each is a common starting point, not any one
 * university's rule: the Leitfaden of the Lehrstuhl or the Prüfungsordnung
 * always wins, and `imstudium arbeit formvorgaben set` adjusts every field.
 */

const DECKBLATT = ["Universität", "Fakultät / Institut", "Lehrstuhl", "Seminar / Modul", "Semester", "Titel", "Art der Arbeit", "Name", "Matrikelnummer", "Studiengang und Fachsemester", "E-Mail", "Betreuung", "Abgabedatum"];

const GLIEDERUNG = ["Deckblatt", "Inhaltsverzeichnis", "Abbildungsverzeichnis", "Tabellenverzeichnis", "Abkürzungsverzeichnis", "Text", "Literaturverzeichnis", "Anhang", "Eigenständigkeitserklärung"];

const standard: Formvorgaben = {
  preset: "standard",
  rand: { oben: 2.5, unten: 2, links: 2.5, rechts: 3.5 },
  schrift: { familie: "Times New Roman", groesse: 12, fussnoten: 10 },
  zeilenabstand: 1.5,
  ausrichtung: "blocksatz",
  silbentrennung: true,
  absatz: { einzug: 0, abstand: 6 },
  nummerierung: "dekadisch",
  seitenzahlen: { position: "unten-mitte", vorspann: "roemisch" },
  blockzitat: { abWoertern: 40, einzug: 1, zeilenabstand: 1 },
  deckblatt: DECKBLATT,
  gliederung: GLIEDERUNG,
  pflichtabschnitte: ["Einleitung", "Fazit|Schluss|Zusammenfassung|Ausblick"],
  erklaerung: { erforderlich: true, kiAngabe: true },
  hinweise: [],
  quelle: null,
};

export const FORMVORGABEN_PRESETS: Record<string, { title: string; description: string; vorgaben: Formvorgaben; stil: string }> = {
  standard: {
    title: "Standard (Geistes-, Sozial- und Wirtschaftswissenschaften)",
    description: "A4, Times New Roman 12 pt, 1,5-zeilig, Blocksatz, Korrekturrand rechts 3,5 cm, dekadische Gliederung",
    vorgaben: standard,
    stil: "apa",
  },
  apa7: {
    title: "APA 7 (Psychologie, Bildungs- und Sozialwissenschaften)",
    description: "2,54 cm Rand, 12 pt, doppelter Zeilenabstand, linksbündig, Einzug 1,27 cm, Seitenzahl oben rechts",
    vorgaben: {
      ...standard,
      preset: "apa7",
      rand: { oben: 2.54, unten: 2.54, links: 2.54, rechts: 2.54 },
      zeilenabstand: 2,
      ausrichtung: "links",
      silbentrennung: false,
      absatz: { einzug: 1.27, abstand: 0 },
      nummerierung: "keine",
      seitenzahlen: { position: "oben-rechts", vorspann: "arabisch" },
      blockzitat: { abWoertern: 40, einzug: 1.27, zeilenabstand: 2 },
      gliederung: ["Deckblatt", "Abstract", "Text", "Literaturverzeichnis", "Anhang", "Eigenständigkeitserklärung"],
      pflichtabschnitte: ["Einleitung", "Diskussion|Fazit"],
    },
    stil: "deutsche-gesellschaft-fur-psychologie",
  },
  geisteswissenschaft: {
    title: "Geisteswissenschaft mit Fußnoten (deutsche Zitierweise)",
    description: "wie Standard, Belege in Fußnoten (Vollbeleg, dann Kurzbeleg), Blockzitat ab drei Zeilen",
    vorgaben: { ...standard, preset: "geisteswissenschaft", hinweise: ["Indirekte Zitate mit „Vgl.“ einleiten", "Sekundärzitate mit „zit. nach“ kennzeichnen"] },
    stil: "chicago-notes-bibliography",
  },
  juristisch: {
    title: "Juristische Hausarbeit",
    description: "Korrekturrand links 7 cm (ein Drittel), Gliederung A. I. 1. a) aa), Literaturverzeichnis vor dem Gutachten, Fußnoten",
    vorgaben: {
      ...standard,
      preset: "juristisch",
      rand: { oben: 2.5, unten: 2, links: 7, rechts: 2 },
      nummerierung: "juristisch",
      gliederung: ["Deckblatt", "Sachverhalt", "Gliederung", "Literaturverzeichnis", "Text", "Eigenständigkeitserklärung"],
      pflichtabschnitte: [],
      hinweise: ["Gutachtenstil", "Kommentare nach Bearbeiter zitieren"],
    },
    stil: "juristische-zitierweise",
  },
  technik: {
    title: "MINT / Technik (numerisch)",
    description: "2,5 cm Rand, 11 pt, 1,15-zeilig, numerische Belege [1], dekadische Gliederung, Abbildungs- und Tabellenverzeichnis",
    vorgaben: {
      ...standard,
      preset: "technik",
      rand: { oben: 2.5, unten: 2.5, links: 2.5, rechts: 2.5 },
      schrift: { familie: "Arial", groesse: 11, fussnoten: 9 },
      zeilenabstand: 1.15,
      pflichtabschnitte: ["Einleitung", "Fazit|Zusammenfassung|Ausblick"],
    },
    stil: "ieee",
  },
};

export function formvorgabenPreset(name: string): Formvorgaben {
  const p = FORMVORGABEN_PRESETS[name];
  if (!p) {
    throw new ImstudiumError(`Unknown Formvorgaben preset "${name}"`, "BAD_ARGS", undefined, `Choose from: ${Object.keys(FORMVORGABEN_PRESETS).join(", ")}`);
  }
  return structuredClone(p.vorgaben);
}

/** The settable fields with their types, for `formvorgaben set key=value` and its help. */
export const FORMVORGABEN_FIELDS: Record<string, "number" | "string" | "boolean" | "list" | Readonly<string[]>> = {
  "rand.oben": "number",
  "rand.unten": "number",
  "rand.links": "number",
  "rand.rechts": "number",
  "schrift.familie": "string",
  "schrift.groesse": "number",
  "schrift.fussnoten": "number",
  zeilenabstand: "number",
  ausrichtung: ["blocksatz", "links"],
  silbentrennung: "boolean",
  "absatz.einzug": "number",
  "absatz.abstand": "number",
  nummerierung: ["dekadisch", "alphanumerisch", "juristisch", "keine"] satisfies Nummerierung[],
  "seitenzahlen.position": ["unten-mitte", "unten-rechts", "oben-rechts"],
  "seitenzahlen.vorspann": ["roemisch", "keine", "arabisch"],
  "blockzitat.abWoertern": "number",
  "blockzitat.einzug": "number",
  "blockzitat.zeilenabstand": "number",
  deckblatt: "list",
  gliederung: "list",
  pflichtabschnitte: "list",
  "erklaerung.erforderlich": "boolean",
  "erklaerung.kiAngabe": "boolean",
  hinweise: "list",
  quelle: "string",
};

/** Apply "rand.links=3" style assignments. Lists take "a;b;c"; `+=` appends to a list. */
export function applyFormvorgaben(base: Formvorgaben, assignments: string[]): Formvorgaben {
  const next = structuredClone(base);
  for (const a of assignments) {
    const m = /^([\w.]+)\s*(\+?=)\s*(.*)$/s.exec(a);
    if (!m) throw new ImstudiumError(`Expected key=value, got "${a}"`, "BAD_ARGS", undefined, "e.g. imstudium arbeit formvorgaben set rand.links=3 schrift.familie=Arial");
    const [, key, op, rawValue] = m as unknown as [string, string, string, string];
    const kind = FORMVORGABEN_FIELDS[key];
    if (!kind) throw new ImstudiumError(`Unknown Formvorgaben field "${key}"`, "BAD_ARGS", undefined, `Fields: ${Object.keys(FORMVORGABEN_FIELDS).join(", ")}`);
    const value = rawValue.trim();
    let parsed: unknown;
    if (kind === "number") {
      parsed = Number(value.replace(",", ".").replace(/\s*(cm|pt)$/i, ""));
      if (!Number.isFinite(parsed as number) || (parsed as number) < 0) throw new ImstudiumError(`${key} expects a number, got "${value}"`, "BAD_ARGS");
    } else if (kind === "boolean") {
      if (!/^(true|false|ja|nein|yes|no|1|0)$/i.test(value)) throw new ImstudiumError(`${key} expects ja or nein, got "${value}"`, "BAD_ARGS");
      parsed = /^(true|ja|yes|1)$/i.test(value);
    } else if (kind === "list") {
      const items = value.split(";").map((s) => s.trim()).filter(Boolean);
      const current = getPath(next, key) as string[];
      parsed = op === "+=" ? [...current, ...items] : items;
    } else if (kind === "string") {
      parsed = value || null;
    } else {
      if (!kind.includes(value)) throw new ImstudiumError(`${key} expects one of ${kind.join(", ")}, got "${value}"`, "BAD_ARGS");
      parsed = value;
    }
    if (op === "+=" && kind !== "list") throw new ImstudiumError(`+= works only on lists (${key} is not one)`, "BAD_ARGS");
    setPath(next, key, parsed);
  }
  return next;
}

function getPath(obj: object, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

function setPath(obj: object, path: string, value: unknown): void {
  const keys = path.split(".");
  let o = obj as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]!] = value;
}

const fmt = (n: number) => String(n).replace(".", ",");

/** Formvorgaben as a checklist in German, for FORMVORGABEN.md and human output. */
export function formvorgabenLines(f: Formvorgaben): string[] {
  const nummer: Record<Nummerierung, string> = {
    dekadisch: "dekadisch (1, 1.1, 1.1.1)",
    alphanumerisch: "alphanumerisch (A, I, 1, a)",
    juristisch: "juristisch (A. I. 1. a) aa) (1))",
    keine: "ohne Nummern",
  };
  return [
    `Ränder: oben ${fmt(f.rand.oben)} cm · unten ${fmt(f.rand.unten)} cm · links ${fmt(f.rand.links)} cm · rechts ${fmt(f.rand.rechts)} cm`,
    `Schrift: ${f.schrift.familie} ${fmt(f.schrift.groesse)} pt, Fußnoten ${fmt(f.schrift.fussnoten)} pt`,
    `Zeilenabstand: ${fmt(f.zeilenabstand)} · ${f.ausrichtung === "blocksatz" ? "Blocksatz" : "linksbündig"}${f.silbentrennung ? " mit Silbentrennung" : ""}`,
    `Absatz: Einzug ${fmt(f.absatz.einzug)} cm, Abstand danach ${fmt(f.absatz.abstand)} pt`,
    `Gliederung: ${nummer[f.nummerierung]}`,
    `Seitenzahlen: ${f.seitenzahlen.position.replace("-", " ")}, Verzeichnisse ${f.seitenzahlen.vorspann === "roemisch" ? "römisch (I, II, …)" : f.seitenzahlen.vorspann === "keine" ? "ohne Zahl" : "arabisch"}`,
    `Blockzitat: ab ${f.blockzitat.abWoertern} Wörtern, eingerückt ${fmt(f.blockzitat.einzug)} cm, Zeilenabstand ${fmt(f.blockzitat.zeilenabstand)}`,
    `Deckblatt: ${f.deckblatt.join(", ")}`,
    `Aufbau: ${f.gliederung.join(" → ")}`,
    ...(f.pflichtabschnitte.length ? [`Pflichtabschnitte im Text: ${f.pflichtabschnitte.map((p) => p.replace(/\|/g, " oder ")).join(", ")}`] : []),
    `Eigenständigkeitserklärung: ${f.erklaerung.erforderlich ? `ja${f.erklaerung.kiAngabe ? ", mit Angabe der KI-Hilfsmittel" : ""}` : "nein"}`,
    ...f.hinweise.map((h) => `Hinweis: ${h}`),
    `Quelle der Vorgaben: ${f.quelle ?? `Preset „${f.preset}“ (mit deinem Leitfaden abgleichen)`}`,
  ];
}
