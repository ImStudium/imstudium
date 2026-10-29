import type { Command } from "commander";
import {
  applyRollover,
  computeSemesterProgress,
  findCurrentSemester,
  ImstudiumError,
  listArchivedSemesters,
  planRollover,
  resolveSemesterByLabel,
  semesterSlug,
  type SemesterResource,
} from "@imstudium/sdk";
import type { ChangesOutput, SemesterOutput, SemesterStartOutput } from "@imstudium/contract";
import { act, getSdk, note, output } from "../runtime.js";
import { readChanges, runSync } from "../pipeline.js";
import { resetCourseCache, workspaceCourse } from "../course-arg.js";
import { courseOption, limitOption, optionalLimit, outputOption, parseSince, sinceOption, workspaceDir } from "../kit/args.js";
import { berlinDate as fmtDate, berlinDateTime, berlinDayMonth, cell, courseLabel } from "../kit/format.js";

export function registerSemester(program: Command): void {
  const semester = program
    .command("semester")
    .description("Where you are in the semester; start a new one (archive the last, sync the new)")
    .addOption(outputOption())
    .action(
      act(async (opts: { output?: string }) => {
        const sdk = await getSdk();
        const out = workspaceDir(sdk, opts);
        // /semesters is public: this works before login and offline from cache below.
        let all: SemesterResource[] = [];
        try {
          all = await sdk.courses.semesters.listAll();
        } catch {
          // offline
        }
        const now = all.length ? findCurrentSemester(all) : null;
        const ws = await sdk.studium.loadWorkspace(out);
        const archive = await listArchivedSemesters(out);
        const nowSlug = now ? semesterSlug(String(now.attributes?.title)) : undefined;
        const needsRollover = !!(nowSlug && ws && ws.activeSemester.slug !== nowSlug);
        const progress = now ? computeSemesterProgress(now) : undefined;
        const lectures = now?.attributes as Record<string, string> | undefined;

        const lines = [
          now
            ? `Stud.IP now  ${now.attributes?.title} · week ${progress?.weekNumber ?? "?"} · lectures ${fmtDate(lectures?.["start-of-lectures"])} – ${fmtDate(lectures?.["end-of-lectures"])}`
            : "Stud.IP now  (offline — could not read /semesters)",
          ws
            ? `Workspace    ${ws.activeSemester.title} in ${ws.workspaceFolder}/ · ${ws.courses.length} courses · built ${fmtDate(ws.generatedAt)}`
            : "Workspace    none yet — imstudium init",
          archive.length
            ? `Archive      ${archive.map((a) => `${a.title ?? a.slug} (${a.courses})`).join(" · ")}`
            : "Archive      empty",
          "",
          needsRollover
            ? `→ New semester. Run: imstudium semester start   (archives ${ws!.activeSemester.slug}/, syncs ${now!.attributes?.title})`
            : ws
              ? "→ Up to date. Daily: imstudium sync --extract"
              : "→ imstudium login && imstudium semester start",
        ];
        const str = (v: unknown) => (typeof v === "string" ? v : undefined);
        const payload: SemesterOutput = {
            current: now
              ? {
                  id: now.id,
                  title: String(now.attributes?.title ?? ""),
                  slug: nowSlug,
                  start: str(now.attributes?.start),
                  end: str(now.attributes?.end),
                  startOfLectures: lectures?.["start-of-lectures"],
                  endOfLectures: lectures?.["end-of-lectures"],
                  ...progress,
                }
              : null,
            workspace: ws
              ? { title: ws.activeSemester.title, slug: ws.activeSemester.slug, folder: ws.workspaceFolder, courses: ws.courses.length, generatedAt: ws.generatedAt }
              : null,
            archive,
            needsRollover,
            next: needsRollover ? "imstudium semester start" : ws ? "imstudium sync --extract" : "imstudium semester start",
          };
        output(payload, lines.join("\n"));
      }),
    );

  semester
    .command("start")
    .description("Archive the previous semester folder and sync the new semester")
    .addOption(outputOption())
    .option("--semester <label>", "Target semester (default: the one running now)")
    .option("--extract", "Extract materials and build the search index after syncing")
    .option("--dry-run", "Show what would move and download")
    .action(
      act(async (opts: { output?: string; semester?: string; extract?: boolean; dryRun?: boolean }) => {
        const sdk = await getSdk();
        const out = workspaceDir(sdk, opts);
        const all = await sdk.courses.semesters.listAll();
        const target = opts.semester ? resolveSemesterByLabel(all, opts.semester) : findCurrentSemester(all);
        if (!target) {
          throw new ImstudiumError(
            opts.semester ? `No semester matches "${opts.semester}"` : "No semester is running right now",
            "SEMESTER_NOT_FOUND",
            undefined,
            "imstudium semester start --semester \"WS 2026/27\"",
          );
        }
        const title = String(target.attributes?.title);
        const slug = semesterSlug(title);
        const plan = await planRollover(out, slug);

        note(`Semester start: ${title} → ${slug}/`);
        for (const m of plan.moves) note(`  archive ${m.slug}/ → archive/${m.slug}/`);
        for (const c of plan.conflicts) note(`  ⚠ archive/${c}/ already exists — leaving ${c}/ in place`);

        if (opts.dryRun) {
          const preview = await runSync(sdk, { out, semesterId: target.id, dryRun: true, onProgress: note });
          const dry: SemesterStartOutput = { semester: { id: target.id, title, slug }, plan, downloads: preview.report.downloaded };
          output(
            dry,
            `Dry run: ${plan.moves.length} folder(s) to archive, ${preview.report.downloaded} file(s) to download.`,
          );
          return;
        }

        // Make sure we can reach Stud.IP as you before moving anything.
        await sdk.courses.getMe();
        const rolled = await applyRollover(plan);
        resetCourseCache();
        const result = await runSync(sdk, {
          out,
          semesterId: target.id,
          extract: opts.extract,
          onProgress: note,
        });
        const ws = result.workspace;
        const { files: _files, ...report } = result.report;
        const payload: SemesterStartOutput = { semester: { id: target.id, title, slug }, rollover: rolled, report, extracted: result.extracted };
        output(
          payload,
          [
            `${title} ready in ${slug}/ — ${ws?.courses.length ?? 0} courses, ${result.report.downloaded} files downloaded${opts.extract ? `, ${result.extracted} extracted` : ""}.`,
            rolled.moved.length ? `Archived: ${rolled.moved.map((s) => `archive/${s}/`).join(", ")}` : "",
            ...(result.report.courseErrors ?? []).map((e) => `⚠ ${e.courseTitle}: ${e.message}`),
            "",
            "Next: imstudium today · imstudium week · imstudium changes",
            opts.extract ? "" : "      imstudium sync --extract   (markdown + search index for agents)",
          ]
            .filter((l, i, a) => l !== "" || a[i - 1] !== "")
            .join("\n"),
        );
      }),
    );

  program
    .command("changes")
    .description("What arrived from Stud.IP recently (new and updated files)")
    .addOption(sinceOption("24h, 7d, 2w or a date", "7d"))
    .addOption(courseOption())
    .addOption(limitOption("all"))
    .addOption(outputOption())
    .action(
      act(async (opts: { since: string; course?: string; limit?: string; output?: string }) => {
        const sdk = await getSdk();
        const out = workspaceDir(sdk, opts);
        const since = parseSince(opts.since).getTime();
        const limit = optionalLimit(opts.limit);
        // Same resolver as search/extract: shortcuts, slugs and ids work; a title fragment without a workspace.
        const ws = opts.course ? await sdk.studium.loadWorkspace(out) : null;
        const course = ws && opts.course ? workspaceCourse(sdk, ws, opts.course) : null;
        const q = opts.course?.toLowerCase();
        const matches = (c: { courseId?: string; courseTitle?: string }) =>
          !opts.course || (course ? c.courseId === course.id || c.courseTitle === course.title : (c.courseTitle ?? "").toLowerCase().includes(q!));
        const seen = new Set<string>();
        const changes = (await readChanges(out, since))
          .reverse()
          .filter(matches)
          .filter((c) => (seen.has(c.path) ? false : (seen.add(c.path), true)))
          .slice(0, limit);
        const lines = changes.length
          ? changes.map((c) => `${berlinDayMonth(c.at)}  ${cell(c.change === "new" ? "new" : "updated", 7)}  ${courseLabel(c.courseTitle, 34)}  ${c.name ?? c.path}`)
          : [`Nothing new since ${berlinDateTime(since)}. Run imstudium sync to check Stud.IP.`];
        const payload: ChangesOutput = { since: new Date(since).toISOString(), count: changes.length, changes };
        output(payload, lines.join("\n"));
      }),
    );
}
