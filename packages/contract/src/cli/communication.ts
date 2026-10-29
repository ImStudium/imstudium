import { z } from "zod";
import { CourseRef, ForumCategory, ForumDiscussion, ForumThread, ForumTopic, MessageItem, NewsItem } from "../common.js";

const Since = z.string().nullable().describe("ISO lower bound from --since, null without it");

/** `imstudium news --json` */
export const NewsOutput = z
  .object({
    scope: z.enum(["global", "course", "courses"]),
    courses: z.array(CourseRef).optional(),
    since: Since,
    count: z.number().int(),
    news: z.array(NewsItem),
    saved: z
      .array(
        z.object({
          course: CourseRef,
          dir: z.string(),
          total: z.number().int(),
          written: z.number().int(),
          unchanged: z.number().int(),
          files: z.array(z.string()),
        }),
      )
      .optional()
      .describe("With --save: one write report per course"),
  })
  .describe("Announcements, newest first");
export type NewsOutput = z.infer<typeof NewsOutput>;

/** `imstudium inbox|outbox --json` */
export const MessagesOutput = z
  .object({
    box: z.enum(["inbox", "outbox"]),
    unreadOnly: z.boolean().optional(),
    since: Since,
    count: z.number().int(),
    messages: z.array(MessageItem),
  })
  .describe("Stud.IP messages, newest first (reading never marks them read)");
export type MessagesOutput = z.infer<typeof MessagesOutput>;

export const DiscussionWithCourse = ForumDiscussion.extend({ courseId: z.string(), courseTitle: z.string() });

/** `imstudium forum --json` (no course): recent discussions of all current courses. */
export const ForumListOutput = z.object({
  courses: z.array(CourseRef.extend({ available: z.boolean() })),
  since: Since,
  count: z.number().int(),
  discussions: z.array(DiscussionWithCourse),
});

/** `imstudium forum <course> --json` */
export const ForumCourseOutput = z.object({
  course: CourseRef,
  forum: z.object({
    courseId: z.string(),
    available: z.boolean(),
    categories: z.array(ForumCategory),
    topics: z.array(ForumTopic),
    discussions: z.array(DiscussionWithCourse),
  }),
});

/** `imstudium forum --discussion <id> --json` */
export const ForumThreadOutput = z.object({ thread: ForumThread });

/** `imstudium forum [course] --save --json` */
export const ForumSaveOutput = z.object({
  saved: z.array(
    z.object({
      course: CourseRef,
      dir: z.string(),
      available: z.boolean(),
      discussions: z.number().int(),
      fetched: z.number().int(),
      written: z.number().int(),
      unchanged: z.number().int(),
      files: z.array(z.string()),
      errors: z.array(z.object({ discussionId: z.string(), message: z.string() })),
    }),
  ),
});

export const ForumOutput = z
  .union([ForumThreadOutput, ForumCourseOutput, ForumSaveOutput, ForumListOutput])
  .describe("Forum discussions; one thread with --discussion; write report with --save");
export type ForumOutput = z.infer<typeof ForumOutput>;
export type ForumListOutput = z.infer<typeof ForumListOutput>;
export type ForumCourseOutput = z.infer<typeof ForumCourseOutput>;
export type ForumSaveOutput = z.infer<typeof ForumSaveOutput>;
