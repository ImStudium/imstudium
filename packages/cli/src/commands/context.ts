import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import {
  addDays,
  buildTimetable,
  dateKey,
  expandPath,
  findCurrentSemester,
  listArchivedSemesters,
  parseFrontmatter,
  semesterSlug,
  type StudiumWorkspace,
} from "@imstudium/sdk";
import type { ContextOutput } from "@imstudium/contract";
import { act, getSdk, globalOpts, output, type Sdk } from "../runtime.js";
import { readChanges, readTasks } from "../pipeline.js";
import { formatEntry, icsPath, timetableSources, workspaceCourses } from "./planning.js";
import { meId } from "../me.js";

/**
 * One call, the whole picture: where the semester stands, today's dates,
 * open Abgaben, Klausuren, what arrived, recent announcements and the next
 * sensible command. Local first — the network only adds today's live dates
 * and (with --live) unread messages.
 */

interface NewsLine {
  date: string;
  course: string;
  title: string;
  path: string;
}

/** The payload is the contract: drift fails tsc, not an agent. */
type ContextReport = ContextOutput;

async function recentNews(out: string, ws: StudiumWorkspace | null, sinceMs: number): Promise<NewsLine[]> {
  if (!ws) return [];
  const lines: NewsLine[] = [];
  for (const course of ws.courses) {
    if (!course.path) continue;
    const dir = join(out, course.path, "news");
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      const date = f.slice(0, 10);
      if (Date.parse(date) < sinceMs - 86_400_000) continue;
      const fm = parseFrontmatter(await readFile(join(dir, f), "utf-8").catch(() => ""));
      lines.push({ date: fm.date ?? date, course: course.title, title: fm.title ?? f.slice(11, -3), path: `${course.path}/news/${f}` });
    }
  }
  return lines.sort((a, b) => b.date.localeCompare(a.date));
}

async function lastSyncAt(out: string): Promise<string | null> {
  try {
    return (await stat(join(out, "studium.json"))).mtime.toISOString();
  } catch {
    return null;
  }
}

const de = (iso: string, withTime = false) =>
  new Date(iso).toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Europe/Berlin",
  });

async function buildContext(sdk: Sdk, out: string, opts: { live?: boolean; days: number }): Promise<ContextReport> {
  const now = new Date();
  const since = now.getTime() - opts.days * 86_400_000;
  const ws = await sdk.studium.loadWorkspace(out);

  let studip: ContextReport["semester"]["studip"] = null;
  try {
    const all = await sdk.courses.semesters.listAll();
    const cur = findCurrentSemester(all);
    if (cur) {
      const start = Date.parse(String(cur.attributes?.start));
      studip = {
        title: String(cur.attributes?.title),
        slug: semesterSlug(String(cur.attributes?.title)),
        week: Number.isFinite(start) ? Math.max(1, Math.ceil((now.getTime() - start) / (7 * 86_400_000))) : undefined,
      };
    }
  } catch {
    // offline — workspace view only
  }

  let today: ContextReport["today"] = null;
  const day = dateKey(now);
  const ttOpts = { from: day, to: addDays(day, 6), icsPath: icsPath(sdk), knownCourses: await workspaceCourses(sdk) };
  const signedIn = !!(await sdk.auth.loadSession());
  for (const offline of signedIn ? [false, true] : [true]) {
    try {
      const tt = await buildTimetable(timetableSources(sdk), { ...ttOpts, offline });
      const entries = tt.days[0]?.entries ?? [];
      const next = tt.entries.find((e) => !e.cancelled && Date.parse(e.start) > now.getTime()) ?? null;
      today = { date: day, source: tt.source, entries, next };
      break;
    } catch {
      // try the cached calendar next
    }
  }

  const tasks = (await readTasks(out))
    .filter((t) => t.status === "open" || t.status === "overdue" || t.status === "upcoming")
    .slice(0, 8)
    .map(({ title, courseTitle, deadline, daysLeft, status, url }) => ({ title, courseTitle, deadline, daysLeft, status, url }));

  const exams = (ws?.nextDeadlines ?? []).slice(0, 5).map((e) => ({
    course: e.courseTitle,
    title: e.title,
    date: e.date,
    daysRemaining: e.daysRemaining,
    confirmed: e.confirmed,
  }));

  const seen = new Set<string>();
  const newFiles = (await readChanges(out, since))
    .reverse()
    .filter((c) => (seen.has(c.path) ? false : (seen.add(c.path), true)))
    .slice(0, 12)
    .map((c) => ({ at: c.at, course: c.courseTitle, name: c.name, path: c.path, change: c.change }));

  const news = (await recentNews(out, ws, since)).slice(0, 8);

  let unreadMessages: number | null = null;
  if (opts.live && signedIn) {
    try {
      unreadMessages = (await sdk.messages.inbox(await meId(sdk), { unread: true, limit: 50 })).length;
    } catch {
      unreadMessages = null;
    }
  }

  const lastSync = await lastSyncAt(out);
  const rolloverNeeded = !!(studip && ws && ws.activeSemester.slug !== studip.slug);
  const next: string[] = [];
  if (!signedIn) next.push("imstudium login   (signed out — briefing from local files only)");
  if (!ws) next.push("imstudium semester start");
  else if (rolloverNeeded) next.push(`imstudium semester start   (${ws.activeSemester.title} → ${studip!.title})`);
  else if (!lastSync || now.getTime() - Date.parse(lastSync) > 24 * 3_600_000) next.push("imstudium sync --extract   (last sync > 1 day)");
  if (tasks.some((t) => t.status === "overdue")) next.push("imstudium tasks --open   (something is overdue)");
  if (unreadMessages) next.push(`imstudium inbox --unread   (${unreadMessages} unread)`);
  if (newFiles.length) next.push("imstudium changes --since 7d");

  return {
    generatedAt: now.toISOString(),
    semester: {
      studip,
      workspace: ws ? { title: ws.activeSemester.title, folder: ws.workspaceFolder, courses: ws.courses.length } : null,
      rolloverNeeded,
      archive: (await listArchivedSemesters(out)).length,
    },
    lastSync,
    today,
    tasks,
    exams,
    newFiles,
    news,
    unreadMessages,
    next,
  };
}

function render(ctx: ContextReport): string {
  const L: string[] = [];
  const s = ctx.semester;
  L.push(
    `${s.studip ? `${s.studip.title} · Woche ${s.studip.week ?? "?"}` : "Semester unbekannt (offline)"}` +
      `${s.workspace ? ` · Workspace ${s.workspace.title} (${s.workspace.courses} Kurse)` : " · kein Workspace"}` +
      `${ctx.lastSync ? ` · Sync ${de(ctx.lastSync, true)}` : ""}`,
  );
  if (s.rolloverNeeded) L.push("⚠ Neues Semester — der Workspace hängt noch am letzten.");

  L.push("", "Heute");
  if (!ctx.today) L.push("  (kein Stundenplan erreichbar)");
  else {
    if (!ctx.today.entries.length) L.push("  Keine Termine.");
    for (const e of ctx.today.entries) L.push(`  ${formatEntry(e)}`);
    if (ctx.today.next && !ctx.today.entries.some((e) => Date.parse(e.start) > Date.now())) {
      L.push(`  Als Nächstes: ${de(ctx.today.next.start)} ${formatEntry(ctx.today.next)}`);
    }
    if (ctx.today.source !== "live") L.push("  (aus calendar.ics)");
  }

  if (ctx.tasks.length) {
    L.push("", "Abgaben");
    for (const t of ctx.tasks) {
      const left = t.daysLeft === null ? "" : t.daysLeft < 0 ? `${-t.daysLeft} d überfällig` : t.daysLeft === 0 ? "heute" : `in ${t.daysLeft} d`;
      L.push(`  ${left.padEnd(14)} ${t.title} · ${t.courseTitle ?? ""}`);
    }
  }
  if (ctx.exams.length) {
    L.push("", "Klausuren");
    for (const e of ctx.exams) {
      L.push(`  ${e.date ? `${de(e.date)} (${e.daysRemaining} d)` : "Termin offen"}  ${e.course}${e.confirmed ? "" : " · unbestätigt"}`);
    }
  }
  if (ctx.newFiles.length) {
    L.push("", "Neu");
    for (const f of ctx.newFiles.slice(0, 8)) L.push(`  ${(f.course ?? "").slice(0, 30).padEnd(30)} ${f.name ?? f.path}`);
    if (ctx.newFiles.length > 8) L.push(`  … ${ctx.newFiles.length - 8} mehr: imstudium changes`);
  }
  if (ctx.news.length) {
    L.push("", "Ankündigungen");
    for (const n of ctx.news.slice(0, 5)) L.push(`  ${n.date.slice(5, 10).split("-").reverse().join(".")}. ${n.course.slice(0, 28)} · ${n.title}`);
  }
  if (ctx.unreadMessages !== null) L.push("", `Nachrichten: ${ctx.unreadMessages} ungelesen`);
  if (ctx.next.length) L.push("", "Als Nächstes", ...ctx.next.map((n) => `  → ${n}`));
  return L.join("\n");
}

export function registerContext(program: Command): void {
  program
    .command("context")
    .description("Your study briefing in one call — semester, today, Abgaben, Klausuren, new files, news")
    .option("--live", "Also ask Stud.IP for unread messages")
    .option("--days <n>", "How far back 'new' reaches", "7")
    .option("-o, --output <dir>", "Workspace directory")
    .action(
      act(async (opts: { live?: boolean; days: string; output?: string }) => {
        const sdk = await getSdk();
        const out = expandPath(opts.output || sdk.workspacePath);
        const ctx = await buildContext(sdk, out, { live: opts.live, days: Number(opts.days) || 7 });
        if (globalOpts.json) output(ctx);
        else output(ctx, render(ctx));
      }),
    );
}
