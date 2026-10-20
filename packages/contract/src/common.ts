import { z } from "zod";

/**
 * Building blocks shared by several CLI outputs. Each mirrors the SDK type of
 * the same name (packages/sdk/src/…); the CLI type-checks its payloads
 * against the inferred types, so a drift fails `tsc`, not an agent.
 */

/** ISO 8601 timestamp (with offset or Z). Kept as a string: agents compare lexically. */
export const IsoDateTime = z.string().describe("ISO 8601 date-time");
/** Calendar day in Europe/Berlin, YYYY-MM-DD. */
export const DayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD (Europe/Berlin)");

export const Person = z.object({
  id: z.string().nullable(),
  name: z.string(),
  username: z.string().optional(),
});
export type Person = z.infer<typeof Person>;

export const DateKind = z.enum([
  "lecture",
  "exercise",
  "session",
  "exam",
  "preliminary",
  "extra",
  "excursion",
  "lab",
  "personal",
  "other",
]);
export type DateKind = z.infer<typeof DateKind>;

/** One concrete date of a course (sdk `CourseDate`). */
export const CourseDate = z.object({
  id: z.string(),
  courseId: z.string().nullable(),
  courseTitle: z.string(),
  start: IsoDateTime,
  end: IsoDateTime,
  location: z.string().nullable(),
  cancelled: z.boolean(),
  kind: DateKind,
  category: z.string().nullable(),
  typeId: z.number().nullable(),
  description: z.string().nullable(),
  recurrence: z.string().nullable(),
  source: z.enum(["live", "ics"]),
});
export type CourseDate = z.infer<typeof CourseDate>;

export const Holiday = z.object({
  date: DayKey,
  name: z.string(),
  official: z.boolean(),
});
export type Holiday = z.infer<typeof Holiday>;

export const TimetableDay = z.object({
  date: DayKey,
  weekday: z.number().int().min(1).max(7),
  label: z.string(),
  holiday: Holiday.nullable(),
  entries: z.array(CourseDate),
});
export type TimetableDay = z.infer<typeof TimetableDay>;

export const CwTaskStatus = z.enum(["open", "overdue", "submitted", "upcoming"]);

/** A Courseware task / Abgabe (sdk `CwTask`). */
export const CwTask = z.object({
  id: z.string(),
  title: z.string(),
  courseId: z.string(),
  courseTitle: z.string().nullable(),
  unitId: z.string().nullable(),
  unitTitle: z.string().nullable(),
  elementId: z.string().nullable(),
  taskGroupId: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  submissionDate: z.string().nullable(),
  deadline: z.string().nullable(),
  submitted: z.boolean(),
  progress: z.number().nullable(),
  renewal: z.enum(["pending", "granted", "declined"]).nullable(),
  renewalDate: z.string().nullable(),
  status: CwTaskStatus,
  daysLeft: z.number().int().nullable(),
  url: z.string().nullable(),
});
export type CwTask = z.infer<typeof CwTask>;

export const CwUnit = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  courseId: z.string().nullable(),
  rootId: z.string().nullable(),
  position: z.number(),
  rangeType: z.enum(["course", "user"]).nullable(),
  rangeId: z.string().nullable(),
  visibleFrom: z.string().nullable(),
  visibleUntil: z.string().nullable(),
  chdate: z.string().nullable(),
});
export type CwUnit = z.infer<typeof CwUnit>;

export const NewsItem = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  date: IsoDateTime,
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  author: Person.nullable(),
  scope: z.enum(["course", "global", "institute", "user", "unknown"]),
  courseId: z.string().nullable(),
  courseTitle: z.string().nullable(),
  commentsAllowed: z.boolean(),
});
export type NewsItem = z.infer<typeof NewsItem>;

export const MessageItem = z.object({
  id: z.string(),
  box: z.enum(["inbox", "outbox", "single"]),
  subject: z.string(),
  text: z.string(),
  date: IsoDateTime,
  read: z.boolean().nullable(),
  priority: z.string().nullable(),
  tags: z.array(z.string()),
  sender: Person,
  recipients: z.array(Person),
  recipientCount: z.number().int(),
});
export type MessageItem = z.infer<typeof MessageItem>;

export const ForumDiscussion = z.object({
  id: z.string(),
  title: z.string(),
  topicId: z.string().nullable(),
  topicName: z.string().nullable(),
  startedBy: Person.nullable(),
  sticky: z.boolean(),
  closed: z.boolean(),
  closedAt: z.string().nullable(),
  views: z.number(),
  postingsCount: z.number(),
  unreadCount: z.number(),
  createdAt: z.string().nullable(),
  lastActivity: z.string().nullable(),
});
export type ForumDiscussion = z.infer<typeof ForumDiscussion>;

export const ForumPosting = z.object({
  id: z.string(),
  discussionId: z.string().nullable(),
  text: z.string(),
  date: IsoDateTime,
  updatedAt: z.string().nullable(),
  author: Person,
  anonymous: z.boolean(),
  moderator: z.boolean(),
});

export const ForumThread = z.object({
  discussion: ForumDiscussion,
  postings: z.array(ForumPosting),
});

export const ForumTopic = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  position: z.number(),
  categoryId: z.string().nullable(),
  discussionsCount: z.number(),
  postingsCount: z.number(),
  unreadCount: z.number(),
  lastActivity: z.string().nullable(),
});

export const ForumCategory = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  position: z.number(),
  topicsCount: z.number(),
  discussionsCount: z.number(),
  postingsCount: z.number(),
  unreadCount: z.number(),
});

export const SearchKind = z.enum(["material", "news", "forum", "courseware", "wiki", "note"]);
export type SearchKind = z.infer<typeof SearchKind>;

/** One local search hit (sdk `SearchHit` without the chunk text). */
export const SearchHit = z.object({
  ref: z.string(),
  citation: z.string(),
  kind: SearchKind,
  course: z.string().optional(),
  path: z.string(),
  page: z.number().int().optional(),
  score: z.number(),
  snippet: z.string(),
});
export type SearchHit = z.infer<typeof SearchHit>;

/** One line of `.imstudium/changes.jsonl`. */
export const ChangeEntry = z.object({
  at: IsoDateTime,
  kind: z.literal("file"),
  change: z.enum(["new", "updated"]),
  courseId: z.string().optional(),
  courseTitle: z.string().optional(),
  name: z.string().optional(),
  path: z.string().describe("Relative to the workspace root"),
});
export type ChangeEntry = z.infer<typeof ChangeEntry>;

export const SemesterProgress = z.object({
  weekNumber: z.number().int(),
  daysElapsed: z.number().int(),
  daysTotal: z.number().int(),
  progressPercent: z.number(),
});

export const SyncReport = z.object({
  downloaded: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  bytes: z.number(),
  errors: z.array(z.object({ fileRefId: z.string(), message: z.string() })),
  courseErrors: z.array(z.object({ courseId: z.string(), courseTitle: z.string(), message: z.string() })).optional(),
});
export type SyncReport = z.infer<typeof SyncReport>;

export const CourseRef = z.object({
  id: z.string(),
  title: z.string(),
  dir: z.string().nullable(),
});
export type CourseRef = z.infer<typeof CourseRef>;
