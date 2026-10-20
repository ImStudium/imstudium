import type { Command } from "commander";
import {
  buildWikiTree,
  contentDeps,
  coursewareElementUrl,
  expandPath,
  formatBytes,
  formatLocalDate,
  formatLocalDateTime,
  ImstudiumError,
  matchUnit,
  renderWiki,
  sortTasks,
  syncContent,
  wikiPageUrl,
  type ContentSyncResult,
  type CwElementNode,
  type CwTask,
  type CwUnit,
} from "@imstudium/sdk";
import type { CoursewareCourseOutput, CoursewareListOutput, TasksOutput } from "@imstudium/contract";
import { act, getSdk, note, output, type Sdk } from "../runtime.js";
import { currentCourses, resolveCourse, type CourseRef } from "../course-arg.js";

/** Run per course, keep going when one course fails (permissions, tool off). */
async function perCourse<T>(courses: CourseRef[], fn: (c: CourseRef) => Promise<T>): Promise<Array<{ course: CourseRef; value: T }>> {
  const settled = await Promise.allSettled(courses.map(async (course) => ({ course, value: await fn(course) })));
  const out: Array<{ course: CourseRef; value: T }> = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") out.push(s.value);
    else note(`${courses[i]!.title}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
  });
  return out;
}

function courseDirFor(sdk: Sdk, course: CourseRef, override?: string): string {
  if (override) return expandPath(override);
  if (course.dir) return course.dir;
  throw new ImstudiumError(
    `${course.title} is not in your workspace yet`,
    "NO_COURSE_DIR",
    undefined,
    `Run imstudium sync first, or pass -o <course folder> (workspace: ${sdk.workspacePath})`,
  );
}

function pickUnits(units: CwUnit[], query?: string): CwUnit[] {
  if (!query) return units;
  const hits = units.filter((u) => matchUnit(u, query) || u.id.startsWith(query));
  if (!hits.length) {
    throw new ImstudiumError(
      `No unit matches "${query}"`,
      "UNIT_NOT_FOUND",
      404,
      `Units: ${units.map((u) => u.title).join(" · ") || "none"}`,
    );
  }
  return hits;
}

function dueLabel(t: CwTask): string {
  if (t.status === "submitted") return "done";
  if (t.status === "upcoming") return "later";
  if (t.daysLeft === null) return "no date";
  if (t.daysLeft < 0) return `${-t.daysLeft}d late`;
  if (t.daysLeft === 0) return "today";
  if (t.daysLeft === 1) return "tomorrow";
  return `in ${t.daysLeft}d`;
}

function taskLines(tasks: CwTask[], showCourse: boolean): string[] {
  const width = Math.min(40, Math.max(8, ...tasks.map((t) => t.title.length)));
  return tasks.map((t) => {
    const meta = [
      showCourse ? t.courseTitle : null,
      t.unitTitle,
      t.progress !== null && t.status !== "submitted" ? `${Math.round(t.progress)}%` : null,
      t.renewal ? `extension ${t.renewal}` : null,
    ].filter(Boolean);
    const title = t.title.length > width ? `${t.title.slice(0, width - 1)}…` : t.title.padEnd(width);
    return `  ${dueLabel(t).padEnd(9)} ${(formatLocalDateTime(t.deadline) || "—").padEnd(16)}  ${title}  ${meta.join(" · ")}`.trimEnd();
  });
}

function elementJson(origin: string, courseId: string, unitId: string, el: CwElementNode) {
  return {
    id: el.id,
    title: el.title,
    number: el.number,
    depth: el.depth,
    parentId: el.parentId,
    position: el.position,
    canVisit: el.canVisit,
    chdate: el.chdate,
    url: coursewareElementUrl(origin, courseId, unitId, el.id),
  };
}

function saveSummary(r: ContentSyncResult): string {
  const lines: string[] = [];
  if (r.courseware) {
    const c = r.courseware;
    const f = c.files;
    lines.push(
      `Courseware: ${c.units} unit${c.units === 1 ? "" : "s"}, ${c.pages} pages (${c.written} written, ${c.skipped} unchanged${c.removed ? `, ${c.removed} removed` : ""})` +
        `, files ${f.downloaded} downloaded${f.bytes ? ` (${formatBytes(f.bytes)})` : ""}, ${f.skipped} unchanged${f.failed ? `, ${f.failed} failed` : ""}`,
      `  → ${c.dir}`,
    );
  }
  if (r.wiki) {
    lines.push(`Wiki: ${r.wiki.pages} pages (${r.wiki.written} written, ${r.wiki.skipped} unchanged${r.wiki.removed ? `, ${r.wiki.removed} removed` : ""})`, `  → ${r.wiki.dir}`);
  }
  const open = r.tasks.filter((t) => t.status !== "submitted");
  if (r.tasks.length) lines.push(`Tasks: ${open.length} open of ${r.tasks.length}`);
  if (r.errors.length) {
    const first = r.errors[0]!;
    lines.push(`  ! ${r.errors.length} problem${r.errors.length === 1 ? "" : "s"} (first: ${first.scope}${first.id ? ` ${first.id.slice(0, 8)}` : ""}: ${first.message}) — details with --json`);
  }
  return lines.join("\n");
}

export function registerContent(program: Command): void {
  program
    .command("courseware")
    .alias("cw")
    .description("Courseware (Lernmaterial): units, page outline; --save writes markdown + files")
    .argument("[course]", "Course title fragment, slug, number or id (default: all current courses)")
    .option("--unit <idOrTitle>", "Only this unit")
    .option("--save", "Write courseware/<unit>/<NN>-<page>.md and block files into the course folder")
    .option("-o, --output <dir>", "Course folder for --save (default: the course's workspace folder)")
    .option("--no-files", "With --save: skip downloading block files")
    .option("--force", "With --save: rewrite pages even when unchanged")
    .action(
      act(async (courseQuery: string | undefined, opts: { unit?: string; save?: boolean; output?: string; files?: boolean; force?: boolean }) => {
        const sdk = await getSdk();
        const origin = sdk.config.instanceOrigin;

        if (!courseQuery) {
          if (opts.save) throw new ImstudiumError("--save needs a course", "BAD_ARGS", undefined, "imstudium courseware <course> --save");
          const courses = await currentCourses(sdk);
          const rows = await perCourse(courses, (c) => sdk.courseware.listCourseUnits(c.id));
          const withUnits = rows.filter((r) => r.value.length);
          const total = withUnits.reduce((n, r) => n + r.value.length, 0);
          const lines = [`Courseware · ${total} unit${total === 1 ? "" : "s"} in ${withUnits.length} of ${courses.length} courses`, ""];
          for (const { course, value } of withUnits) {
            lines.push(course.title);
            for (const u of value) lines.push(`  ${u.title}${u.visibleFrom && Date.parse(u.visibleFrom) > Date.now() ? ` (from ${formatLocalDate(u.visibleFrom)})` : ""}`);
          }
          if (withUnits.length) lines.push("", "Outline: imstudium courseware <course>   ·   Save: imstudium courseware <course> --save");
          const payload: CoursewareListOutput = { courses: rows.map(({ course, value }) => ({ id: course.id, title: course.title, units: value })), count: total };
          output(payload, lines.join("\n").trimEnd());
          return;
        }

        const course = await resolveCourse(sdk, courseQuery);
        if (opts.save) {
          const dir = courseDirFor(sdk, course, opts.output);
          const result = await syncContent(contentDeps(sdk), { id: course.id, title: course.title }, dir, {
            include: ["courseware", "tasks"],
            unit: opts.unit,
            downloadFiles: opts.files !== false,
            force: opts.force,
          });
          output(result, `${course.title}\n${saveSummary(result)}`);
          return;
        }

        const [units, rawTasks] = await Promise.all([
          sdk.courseware.listCourseUnits(course.id),
          sdk.courseware.listTasks(course.id, { courseTitle: course.title }).catch(() => [] as CwTask[]),
        ]);
        const unitTitles = new Map(units.map((u) => [u.id, u.title]));
        const tasks = rawTasks.map((t) => ({ ...t, unitTitle: t.unitId ? (unitTitles.get(t.unitId) ?? null) : null }));
        const selected = pickUnits(units, opts.unit);
        const outlines = await Promise.all(selected.map((u) => sdk.courseware.loadElementTree(u)));
        const lines = [`${course.title} — ${units.length} courseware unit${units.length === 1 ? "" : "s"}`, ""];
        if (!units.length) lines.push("No courseware in this course (or the tool is not enabled).");
        selected.forEach((u, i) => {
          const els = outlines[i]!;
          const pages = Math.max(0, els.length - 1);
          lines.push(`${u.title}  (${pages} page${pages === 1 ? "" : "s"})`);
          for (const el of els.slice(1)) lines.push(`${"  ".repeat(el.depth)}${el.number} ${el.title}${el.canVisit ? "" : "  [locked]"}`);
          lines.push("");
        });
        const open = tasks.filter((t) => t.status !== "submitted");
        if (tasks.length) lines.push(`Tasks: ${open.length} open of ${tasks.length}`, ...taskLines(open.slice(0, 5), false), "");
        if (units.length) lines.push(`Save as markdown: imstudium courseware "${courseQuery}" --save`);
        const payload: CoursewareCourseOutput = {
          course: { id: course.id, title: course.title },
          units: selected.map((u, i) => ({ ...u, elements: outlines[i]!.map((el) => elementJson(origin, course.id, u.id, el)) })),
          tasks,
        };
        output(payload, lines.join("\n").trimEnd());
      }),
    );

  program
    .command("tasks")
    .description("Courseware tasks (Aufgaben) with deadlines, soonest first")
    .argument("[course]", "Course (default: all current courses)")
    .option("--open", "Hide submitted tasks")
    .action(
      act(async (courseQuery: string | undefined, opts: { open?: boolean }) => {
        const sdk = await getSdk();
        const courses = courseQuery ? [await resolveCourse(sdk, courseQuery)] : await currentCourses(sdk);
        const rows = await perCourse(courses, async (c) => {
          const tasks = await sdk.courseware.listTasks(c.id, { courseTitle: c.title });
          if (!tasks.some((t) => t.unitId)) return tasks;
          // Name the unit each task lives in (one extra call, only when needed).
          const units = await sdk.courseware.listCourseUnits(c.id).catch(() => [] as CwUnit[]);
          const titles = new Map(units.map((u) => [u.id, u.title]));
          return tasks.map((t) => ({ ...t, unitTitle: t.unitId ? (titles.get(t.unitId) ?? null) : null }));
        });
        const all = sortTasks(rows.flatMap((r) => r.value));
        const shown = opts.open ? all.filter((t) => t.status !== "submitted") : all;
        const open = all.filter((t) => t.status !== "submitted").length;
        const overdue = all.filter((t) => t.status === "overdue").length;
        const header = `Courseware tasks · ${open} open${overdue ? ` (${overdue} overdue)` : ""} · ${all.length - open} submitted`;
        const lines = shown.length
          ? [header, "", ...taskLines(shown, !courseQuery)]
          : [all.length ? `${header}\n\nNothing open.` : "No courseware tasks."];
        const payload: TasksOutput = { count: shown.length, open, overdue, tasks: shown };
        output(payload, lines.join("\n"));
      }),
    );

  program
    .command("wiki")
    .description("Course wiki: page tree, one page as markdown, or --save into the workspace")
    .argument("[course]", "Course (default: all current courses)")
    .argument("[page]", "Page name or id to print")
    .option("--save", "Write wiki/<page>.md + wiki/README.md into the course folder")
    .option("-o, --output <dir>", "Course folder for --save")
    .option("--force", "With --save: rewrite unchanged pages")
    .action(
      act(async (courseQuery: string | undefined, pageQuery: string | undefined, opts: { save?: boolean; output?: string; force?: boolean }) => {
        const sdk = await getSdk();
        const origin = sdk.config.instanceOrigin;

        if (!courseQuery) {
          const courses = await currentCourses(sdk);
          const rows = await perCourse(courses, (c) => sdk.wiki.listPages(c.id));
          const withPages = rows.filter((r) => r.value.length);
          const lines = [`Wiki · ${withPages.length} of ${courses.length} courses have pages`, ""];
          for (const { course, value } of withPages) {
            const latest = value.map((p) => p.chdate ?? "").sort().pop();
            lines.push(`  ${String(value.length).padStart(3)} pages  ${course.title}${latest ? `  (updated ${formatLocalDate(latest)})` : ""}`);
          }
          output(
            {
              courses: rows.map(({ course, value }) => ({
                id: course.id,
                title: course.title,
                pages: value.length,
                updated: value.map((p) => p.chdate ?? "").sort().pop() || null,
              })),
            },
            lines.join("\n").trimEnd(),
          );
          return;
        }

        const course = await resolveCourse(sdk, courseQuery);
        if (opts.save) {
          const dir = courseDirFor(sdk, course, opts.output);
          const result = await syncContent(contentDeps(sdk), { id: course.id, title: course.title }, dir, {
            include: ["wiki"],
            force: opts.force,
          });
          output(result, `${course.title}\n${saveSummary(result)}`);
          return;
        }

        const pages = await sdk.wiki.listPages(course.id);
        const nodes = buildWikiTree(pages);
        if (pageQuery) {
          const q = pageQuery.toLowerCase();
          const node =
            nodes.find((n) => n.id === pageQuery) ??
            nodes.find((n) => n.name.toLowerCase() === q) ??
            nodes.find((n) => n.file === `${q}.md` || n.file === q) ??
            nodes.find((n) => n.name.toLowerCase().includes(q));
          if (!node) {
            throw new ImstudiumError(`No wiki page "${pageQuery}" in ${course.title}`, "PAGE_NOT_FOUND", 404, `imstudium wiki "${courseQuery}" lists the pages`);
          }
          const rendered = renderWiki(pages, { origin, courseId: course.id, courseTitle: course.title });
          const page = rendered.pages.find((p) => p.node.id === node.id)!;
          const body = page.markdown.replace(/^---\n[\s\S]*?\n---\n\n?/, "");
          output(
            {
              course: { id: course.id, title: course.title },
              page: { id: node.id, name: node.name, parentId: node.parentId, chdate: node.chdate, version: node.version, url: wikiPageUrl(origin, course.id, node.id), markdown: body },
            },
            `${body.trimEnd()}\n\n${wikiPageUrl(origin, course.id, node.id)}`,
          );
          return;
        }

        const lines = [`${course.title} — wiki, ${nodes.length} page${nodes.length === 1 ? "" : "s"}`, ""];
        const labels = nodes.map((n) => `${"  ".repeat(n.depth + 1)}${n.name}${n.isStart ? " (start)" : ""}`);
        const width = Math.min(60, Math.max(0, ...labels.map((l) => l.length)));
        nodes.forEach((n, i) => {
          lines.push(`${labels[i]!.padEnd(width)}  ${formatLocalDate(n.chdate)}${n.version ? `  v${n.version}` : ""}`.trimEnd());
        });
        if (!nodes.length) lines.push("No wiki pages.");
        else lines.push("", `Read a page: imstudium wiki "${courseQuery}" "<page>"   ·   Save: --save`);
        output(
          {
            course: { id: course.id, title: course.title },
            pages: nodes.map((n) => ({
              id: n.id,
              name: n.name,
              parentId: n.parentId,
              depth: n.depth,
              file: n.file,
              isStart: n.isStart,
              chdate: n.chdate,
              version: n.version,
              url: wikiPageUrl(origin, course.id, n.id),
            })),
          },
          lines.join("\n").trimEnd(),
        );
      }),
    );
}

