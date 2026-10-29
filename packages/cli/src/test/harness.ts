import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, dateKey } from "@imstudium/sdk";

/**
 * Test harness for the built CLI: a synthetic workspace (persona "Lena", no
 * real data), a throwaway HOME, the file session store and a preload that
 * makes every network call throw. Nothing here can reach Stud.IP.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
export const CLI = join(HERE, "..", "..", "dist", "cli.js");
const NO_NETWORK = join(HERE, "no-network.mjs");

/** Closed port: anything that slips past the preload still fails fast. */
export const OFFLINE_ORIGIN = "http://127.0.0.1:9";

export interface Fixture {
  root: string;
  home: string;
  workspace: string;
}

const STAT = "a".repeat(32);
const DB = "b".repeat(32);

function ics(days: string[]): string {
  const events = days.flatMap((d, i) => [
    "BEGIN:VEVENT",
    `UID:lena-${i}@example.test`,
    `DTSTART;TZID=Europe/Berlin:${d.replace(/-/g, "")}T100000`,
    `DTEND;TZID=Europe/Berlin:${d.replace(/-/g, "")}T113000`,
    `SUMMARY:${i % 2 ? "Datenbanken" : "Statistik I"}`,
    "LOCATION:HS I",
    "CATEGORIES:Vorlesung",
    "END:VEVENT",
  ]);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Stud.IP@example.test//EN", ...events, "END:VCALENDAR"].join("\r\n");
}

export async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "imstudium-cli-"));
  const home = join(root, "home");
  const workspace = join(root, "Studium");
  await mkdir(home, { recursive: true });
  const now = new Date();
  const today = dateKey(now);
  const sem = "WS2026-27";

  const course = (id: string, title: string, slug: string, exam?: string) => ({
    id,
    title,
    slug,
    path: `${sem}/${slug}`,
    semester: "WS 2026/27",
    semesterId: "sem-ws26",
    schedule: [],
    examDates: exam
      ? [{ courseId: id, courseTitle: title, title: "Klausur", date: exam, confirmed: true, source: "event" as const, daysRemaining: 30 }]
      : [],
    fileCount: 1,
    folderCount: 1,
  });
  const courses = [course(STAT, "Statistik I", "statistik-i", `${addDays(today, 30)}T09:00:00+01:00`), course(DB, "Datenbanken", "datenbanken")];
  const studium = {
    schemaVersion: "2",
    generatedAt: now.toISOString(),
    instanceUrl: OFFLINE_ORIGIN,
    activeSemester: { id: "sem-ws26", title: "WS 2026/27", slug: sem, isCurrent: true, start: "2026-10-01T00:00:00+02:00", end: "2027-03-31T23:59:59+02:00" },
    otherSemesters: [],
    workspaceFolder: sem,
    semesters: ["WS 2026/27"],
    courses,
    nextDeadlines: courses.flatMap((c) => c.examDates),
  };
  await mkdir(join(workspace, ".imstudium"), { recursive: true });
  await writeFile(join(workspace, "studium.json"), JSON.stringify(studium, null, 2));
  await writeFile(join(workspace, "STUDIUM.md"), "# Studium (synthetic)\n");
  await writeFile(join(workspace, "klausuren.md"), "# Klausuren (synthetic)\n");
  await writeFile(
    join(workspace, ".imstudium", "changes.jsonl"),
    [
      { at: new Date(now.getTime() - 86_400_000).toISOString(), kind: "file", change: "new", courseId: STAT, courseTitle: "Statistik I", name: "Blatt 1.pdf", path: `${sem}/statistik-i/files/Blatt 1.pdf` },
      { at: new Date(now.getTime() - 3_600_000).toISOString(), kind: "file", change: "updated", courseId: DB, courseTitle: "Datenbanken", name: "SQL.pdf", path: `${sem}/datenbanken/files/SQL.pdf` },
    ]
      .map((c) => JSON.stringify(c))
      .join("\n") + "\n",
  );
  await writeFile(
    join(workspace, ".imstudium", "tasks.json"),
    JSON.stringify({
      updatedAt: now.toISOString(),
      tasks: [
        {
          id: "t1",
          title: "Übungsblatt 1",
          courseId: STAT,
          courseTitle: "Statistik I",
          unitId: null,
          unitTitle: null,
          elementId: null,
          taskGroupId: null,
          startDate: null,
          endDate: `${addDays(today, 3)}T23:59:00+02:00`,
          submissionDate: null,
          deadline: `${addDays(today, 3)}T23:59:00+02:00`,
          submitted: false,
          progress: 0,
          renewal: null,
          renewalDate: null,
          status: "open",
          daysLeft: 3,
          url: null,
        },
      ],
    }),
  );
  const statDir = join(workspace, sem, "statistik-i");
  await mkdir(join(statDir, "search"), { recursive: true });
  await mkdir(join(statDir, "news"), { recursive: true });
  await writeFile(
    join(statDir, "search", "corpus.jsonl"),
    JSON.stringify({
      ref: `${sem}/statistik-i#blatt-1.pdf:2`,
      citation: "Statistik I · Blatt 1.pdf · p.2",
      coursePath: `${sem}/statistik-i`,
      courseTitle: "Statistik I",
      extractSlug: "blatt-1-pdf",
      page: 2,
      text: "Der Erwartungswert einer diskreten Zufallsvariable",
    }) + "\n",
  );
  await writeFile(join(statDir, "news", `${today}-raum.md`), `---\ntitle: Raumänderung\ndate: ${today}\n---\n\nDie Übung findet im HS II statt.\n`);
  await writeFile(join(workspace, "calendar.ics"), ics(Array.from({ length: 14 }, (_, i) => addDays(today, i - 1))));
  return { root, home, workspace };
}

export interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
  json: () => unknown;
}

export function runCli(fx: Fixture, args: string[], env: Record<string, string> = {}): CliRun {
  const r = spawnSync(process.execPath, ["--import", NO_NETWORK, CLI, ...args], {
    encoding: "utf8",
    timeout: 20_000,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: fx.home,
      XDG_CONFIG_HOME: join(fx.home, ".config"),
      XDG_DATA_HOME: join(fx.home, ".local", "share"),
      IMSTUDIUM_WORKSPACE: fx.workspace,
      IMSTUDIUM_ORIGIN: OFFLINE_ORIGIN,
      IMSTUDIUM_BASE_URL: `${OFFLINE_ORIGIN}/jsonapi.php/v1`,
      IMSTUDIUM_NO_CACHE: "1",
      IMSTUDIUM_NO_SILENT_REFRESH: "1",
      IMSTUDIUM_SESSION_STORE: "file",
      IMSTUDIUM_PLAIN_SESSION: "1",
      TZ: "Europe/Berlin",
      ...env,
    },
  });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    json: () => JSON.parse(r.stdout),
  };
}
