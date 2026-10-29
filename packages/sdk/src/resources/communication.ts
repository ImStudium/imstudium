import { join } from "node:path";
import type { ForumResource, ForumWriteResult } from "./forum.js";
import type { NewsResource, NewsWriteResult } from "./news.js";

export * from "./comm-util.js";
export * from "./news.js";
export * from "./messages.js";
export * from "./forum.js";
export * from "./blubber.js";
export * from "./activity.js";

/** Anything that carries the news and forum resources — the SDK object itself works. */
export interface CommunicationDeps {
  news: Pick<NewsResource, "exportCourseNews">;
  forum: Pick<ForumResource, "exportCourseForum">;
}

export interface SyncCommunicationOptions {
  /** Write news/ (default true). */
  news?: boolean;
  /** Write forum/ (default true). */
  forum?: boolean;
  /** Report nothing written, touch nothing. */
  dryRun?: boolean;
  /** Parallel thread fetches for the forum (default 4). */
  concurrency?: number;
}

export interface SyncCommunicationResult {
  courseId: string;
  news?: NewsWriteResult;
  forum?: ForumWriteResult;
  errors: Array<{ area: "news" | "forum"; message: string }>;
}

/**
 * Write one course's communication into its workspace folder:
 * `<courseDir>/news/*.md` + README and `<courseDir>/forum/<topic>/<thread>.md` + README.
 * Never throws for a single area — failures land in `errors` so a sync keeps going.
 * Personal messages are deliberately never written into the course workspace.
 */
export async function syncCommunication(
  deps: CommunicationDeps,
  course: { id: string; title?: string },
  courseDir: string,
  options: SyncCommunicationOptions = {},
): Promise<SyncCommunicationResult> {
  const result: SyncCommunicationResult = { courseId: course.id, errors: [] };
  if (options.dryRun) return result;

  if (options.news !== false) {
    try {
      result.news = await deps.news.exportCourseNews(course.id, join(courseDir, "news"), {
        courseTitle: course.title,
      });
    } catch (err) {
      result.errors.push({ area: "news", message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (options.forum !== false) {
    try {
      result.forum = await deps.forum.exportCourseForum(course.id, join(courseDir, "forum"), {
        courseTitle: course.title,
        concurrency: options.concurrency,
      });
      for (const e of result.forum.errors) {
        result.errors.push({ area: "forum", message: `${e.discussionId}: ${e.message}` });
      }
    } catch (err) {
      result.errors.push({ area: "forum", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
