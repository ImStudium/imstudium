import type { Command } from "commander";
import { join } from "node:path";
import {
  ImstudiumError,
  selectNews,
  writeNewsMarkdown,
  type NewsItem,
} from "@imstudium/sdk";
import { act, getSdk, note, output } from "../runtime.js";
import { currentCourses, resolveCourse, type CourseRef } from "../course-arg.js";
import { optionalSince } from "../since.js";
import {
  formatNews,
} from "./communication-format.js";

function intOpt(value: string | undefined, flag: string, fallback?: number): number | undefined {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ImstudiumError(`--${flag} expects a positive whole number, got "${value}"`, "BAD_ARGS");
  }
  return n;
}

function requireDir(course: CourseRef): string {
  if (!course.dir) {
    throw new ImstudiumError(
      `"${course.title}" is not in your Studium workspace yet`,
      "NOT_IN_WORKSPACE",
      undefined,
      "Run imstudium sync (or init) first, then --save writes into the course folder.",
    );
  }
  return course.dir;
}

/**
 * Run `fn` per course. With `strict` (one course the student named) errors surface;
 * otherwise a course that fails (no access, no forum) is noted and skipped.
 */
async function perCourse<T>(
  courses: CourseRef[],
  fn: (c: CourseRef) => Promise<T>,
  strict = false,
): Promise<Array<{ course: CourseRef; value: T }>> {
  if (strict) return Promise.all(courses.map(async (course) => ({ course, value: await fn(course) })));
  const settled = await Promise.allSettled(courses.map(async (course) => ({ course, value: await fn(course) })));
  const out: Array<{ course: CourseRef; value: T }> = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") out.push(s.value);
    else note(`skipped ${courses[i]!.title}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
  });
  return out;
}

const courseJson = (c: CourseRef) => ({ id: c.id, title: c.title, dir: c.dir ?? null });

export function registerCommunication(program: Command): void {
  // ── news ────────────────────────────────────────────────────────────────────
  program
    .command("news")
    .description("Announcements: one course, or all current courses merged newest-first")
    .argument("[course]", "Course title fragment, slug or id (default: all current courses)")
    .option("--since <when>", "Only since 7d, 24h, 2w, today or a date like 2026-10-01")
    .option("--global", "Stud.IP-wide announcements instead of course news")
    .option("--limit <n>", "Newest N (default 30)")
    .option("--save", "Write news/<date>-<title>.md + news/README.md into the course folder(s)")
    .action(
      act(async (query: string | undefined, opts: { since?: string; global?: boolean; limit?: string; save?: boolean }) => {
        const sdk = await getSdk();
        const since = optionalSince(opts.since);
        const limit = intOpt(opts.limit, "limit", 30);

        if (opts.global) {
          if (query) throw new ImstudiumError("--global lists Stud.IP-wide news; leave out the course", "BAD_ARGS");
          const news = await sdk.news.global({ since, limit });
          output({ scope: "global", since: since?.toISOString() ?? null, count: news.length, news }, formatNews(news, { showCourse: true }));
          return;
        }

        const courses = query ? [await resolveCourse(sdk, query)] : await currentCourses(sdk);
        const fetched = await perCourse(courses, (c) => sdk.news.course(c.id, { courseTitle: c.title }), !!query);

        const saved = [];
        if (opts.save) {
          for (const { course, value } of fetched) {
            if (!course.dir && !query) {
              note(`not saved: ${course.title} is not in the workspace (run imstudium sync)`);
              continue;
            }
            const res = await writeNewsMarkdown(join(requireDir(course), "news"), value, { courseTitle: course.title });
            saved.push({ course: courseJson(course), ...res });
            note(`${course.title}: ${res.written} written, ${res.unchanged} unchanged → ${res.dir}`);
          }
        }

        const all: NewsItem[] = fetched.flatMap((f) => f.value);
        const news = selectNews(all, { since, limit });
        output(
          {
            scope: query ? "course" : "courses",
            courses: fetched.map((f) => courseJson(f.course)),
            since: since?.toISOString() ?? null,
            count: news.length,
            news,
            ...(opts.save ? { saved } : {}),
          },
          formatNews(news, { showCourse: !query }),
        );
      }),
    );
}
