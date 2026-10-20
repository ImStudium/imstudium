import type { Command } from "commander";
import { join } from "node:path";
import {
  ImstudiumError,
  parseActivityTypes,
  selectNews,
  toMs,
  writeNewsMarkdown,
  type ForumDiscussion,
  type NewsItem,
} from "@imstudium/sdk";
import type { ForumCourseOutput, ForumSaveOutput, ForumListOutput, MessagesOutput, NewsOutput } from "@imstudium/contract";
import { act, getSdk, note, output } from "../runtime.js";
import { meId } from "../me.js";
import { currentCourses, resolveCourse, type CourseRef } from "../course-arg.js";
import { optionalSince, parseSince } from "../since.js";
import {
  formatActivities,
  formatBlubberComments,
  formatBlubberThreads,
  formatDiscussions,
  formatMessage,
  formatMessages,
  formatNews,
  formatThread,
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
          const payload: NewsOutput = { scope: "global", since: since?.toISOString() ?? null, count: news.length, news };
          output(payload, formatNews(news, { showCourse: true }));
          return;
        }

        const courses = query ? [await resolveCourse(sdk, query)] : await currentCourses(sdk);
        const fetched = await perCourse(courses, (c) => sdk.news.course(c.id, { courseTitle: c.title }), !!query);

        const saved: NonNullable<NewsOutput["saved"]> = [];
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
        const payload: NewsOutput = {
          scope: query ? "course" : "courses",
          courses: fetched.map((f) => courseJson(f.course)),
          since: since?.toISOString() ?? null,
          count: news.length,
          news,
          ...(opts.save ? { saved } : {}),
        };
        output(payload, formatNews(news, { showCourse: !query }));
      }),
    );

  // ── messages ────────────────────────────────────────────────────────────────
  program
    .command("inbox")
    .description("Your Stud.IP messages, newest first (reading never marks them read)")
    .option("--unread", "Only unread messages")
    .option("--since <when>", "Only since 7d, 24h, today or a date")
    .option("--limit <n>", "Newest N (default 20)")
    .action(
      act(async (opts: { unread?: boolean; since?: string; limit?: string }) => {
        const sdk = await getSdk();
        const since = optionalSince(opts.since);
        const messages = await sdk.messages.inbox(await meId(sdk), {
          unread: opts.unread,
          since,
          limit: intOpt(opts.limit, "limit", 20),
        });
        const payload: MessagesOutput = { box: "inbox", unreadOnly: !!opts.unread, since: since?.toISOString() ?? null, count: messages.length, messages };
        output(payload, formatMessages(messages) + (messages.length ? "\n\nRead one: imstudium message <id>" : ""));
      }),
    );

  program
    .command("outbox")
    .description("Messages you sent, newest first")
    .option("--since <when>", "Only since 7d, 24h, today or a date")
    .option("--limit <n>", "Newest N (default 20)")
    .action(
      act(async (opts: { since?: string; limit?: string }) => {
        const sdk = await getSdk();
        const since = optionalSince(opts.since);
        const messages = await sdk.messages.outbox(await meId(sdk), { since, limit: intOpt(opts.limit, "limit", 20) });
        const payload: MessagesOutput = { box: "outbox", since: since?.toISOString() ?? null, count: messages.length, messages };
        output(payload, formatMessages(messages));
      }),
    );

  program
    .command("message")
    .description("One message in full, with sender and recipients (does not mark it read)")
    .argument("<id>", "Message id from imstudium inbox/outbox")
    .action(
      act(async (id: string) => {
        const sdk = await getSdk();
        const message = await sdk.messages.get(id);
        output({ message }, formatMessage(message));
      }),
    );

  // ── forum ───────────────────────────────────────────────────────────────────
  program
    .command("forum")
    .description("Course forum: discussions newest activity first, one thread, or --save as markdown")
    .argument("[course]", "Course (default: recent discussions of all current courses)")
    .option("--discussion <id>", "Show one discussion with all postings")
    .option("--since <when>", "Only discussions active since 7d, today or a date")
    .option("--limit <n>", "Newest N discussions (default 30)")
    .option("--save", "Write forum/<topic>/<discussion>.md + forum/README.md into the course folder(s)")
    .action(
      act(async (query: string | undefined, opts: { discussion?: string; since?: string; limit?: string; save?: boolean }) => {
        const sdk = await getSdk();
        if (opts.discussion) {
          const thread = await sdk.forum.thread(opts.discussion);
          output({ thread }, formatThread(thread));
          return;
        }
        const since = optionalSince(opts.since);
        const limit = intOpt(opts.limit, "limit", 30);
        const courses = query ? [await resolveCourse(sdk, query)] : await currentCourses(sdk);

        if (opts.save) {
          const saved: ForumSaveOutput["saved"] = [];
          for (const course of courses) {
            if (!course.dir && !query) {
              note(`not saved: ${course.title} is not in the workspace (run imstudium sync)`);
              continue;
            }
            const res = await sdk.forum.exportCourseForum(course.id, join(requireDir(course), "forum"), {
              courseTitle: course.title,
            });
            saved.push({ course: courseJson(course), ...res });
            note(
              res.available
                ? `${course.title}: ${res.discussions} discussions, ${res.fetched} fetched, ${res.written} written → ${res.dir}`
                : `${course.title}: no forum`,
            );
          }
          output({ saved }, `Saved forum of ${saved.filter((s) => s.available).length}/${saved.length} course(s).`);
          return;
        }

        const overviews = await perCourse(courses, (c) => sdk.forum.overview(c.id, { since }), !!query);
        const discussions: Array<ForumDiscussion & { courseId: string; courseTitle: string }> = overviews
          .flatMap(({ course, value }) => value.discussions.map((d) => ({ ...d, courseId: course.id, courseTitle: course.title })))
          .sort((a, b) => toMs(b.lastActivity) - toMs(a.lastActivity))
          .slice(0, limit);

        if (query && overviews[0]) {
          const { course, value } = overviews[0];
          const unread = value.discussions.reduce((s, d) => s + d.unreadCount, 0);
          const header = value.available
            ? `${course.title} — forum: ${value.topics.length} topics, ${value.discussions.length} discussions${unread ? `, ${unread} unread postings` : ""}`
            : `${course.title} has no forum (or you cannot read it).`;
          const payload: ForumCourseOutput = { course: courseJson(course), forum: { ...value, discussions } };
          output(
            payload,
            value.available ? `${header}\n\n${formatDiscussions(discussions)}\n\nRead one: imstudium forum --discussion <id>` : header,
          );
          return;
        }
        const payload: ForumListOutput = { courses: overviews.map((o) => ({ ...courseJson(o.course), available: o.value.available })), since: since?.toISOString() ?? null, count: discussions.length, discussions };
        output(
          payload,
          formatDiscussions(discussions, { showCourse: true }),
        );
      }),
    );

  // ── blubber ─────────────────────────────────────────────────────────────────
  program
    .command("blubber")
    .description("Blubber chats: a course's threads with latest comments, or your stream")
    .argument("[course]", "Course (default: your Blubber stream)")
    .option("--thread <id>", "Show the latest comments of one thread")
    .option("--since <when>", "Only since 7d, today or a date")
    .option("--limit <n>", "Threads (stream) or comments per thread (default 10)")
    .action(
      act(async (query: string | undefined, opts: { thread?: string; since?: string; limit?: string }) => {
        const sdk = await getSdk();
        const since = optionalSince(opts.since);
        const limit = intOpt(opts.limit, "limit", 10);

        if (opts.thread) {
          const comments = await sdk.blubber.comments(opts.thread, { limit: intOpt(opts.limit, "limit", 30), since });
          output({ threadId: opts.thread, count: comments.length, comments }, formatBlubberComments(comments));
          return;
        }
        if (query) {
          const course = await resolveCourse(sdk, query);
          const threads = await sdk.blubber.courseWithComments(course.id, { limit, since });
          output(
            { course: courseJson(course), count: threads.length, threads },
            threads.length
              ? threads.map((t) => `${formatBlubberThreads([t])}\n${formatBlubberComments(t.comments)}`).join("\n\n")
              : `${course.title} has no Blubber threads.`,
          );
          return;
        }
        const threads = await sdk.blubber.mine({ limit, since });
        output(
          { since: since?.toISOString() ?? null, count: threads.length, threads },
          formatBlubberThreads(threads) + (threads.length ? "\n\nRead one: imstudium blubber --thread <id>" : ""),
        );
      }),
    );

  // ── activity stream ─────────────────────────────────────────────────────────
  program
    .command("feed")
    .description("What happened in your courses: Stud.IP's activity stream, newest first")
    .option("--since <when>", "Since 24h, 7d, 2w, today or a date", "7d")
    .option("--type <types>", "documents, news, forum, wiki, message, participants, schedule, courseware (comma-separated)")
    .option("--course <course>", "Only this course")
    .option("--limit <n>", "Newest N (default 50)")
    .action(
      act(async (opts: { since: string; type?: string; course?: string; limit?: string }) => {
        const sdk = await getSdk();
        const since = parseSince(opts.since);
        let types;
        try {
          types = parseActivityTypes(opts.type);
        } catch (e) {
          throw new ImstudiumError(e instanceof Error ? e.message : String(e), "BAD_ARGS");
        }
        const course = opts.course ? await resolveCourse(sdk, opts.course) : undefined;
        const activities = await sdk.activity.stream(await meId(sdk), {
          since,
          types,
          courseId: course?.id,
          limit: intOpt(opts.limit, "limit", 50),
        });
        output(
          {
            since: since.toISOString(),
            types: types ?? null,
            course: course ? courseJson(course) : null,
            count: activities.length,
            activities,
          },
          formatActivities(activities),
        );
      }),
    );
}
