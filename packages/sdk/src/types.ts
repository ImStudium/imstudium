/** JSON:API resource object */
export interface JsonApiResource<T extends string = string> {
  type: T;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, JsonApiRelationship>;
  links?: Record<string, string>;
  meta?: Record<string, unknown>;
}

export interface JsonApiRelationship {
  data?: JsonApiIdentifier | JsonApiIdentifier[] | null;
  links?: Record<string, string>;
}

export interface JsonApiIdentifier {
  type: string;
  id: string;
}

export interface JsonApiDocument<T extends JsonApiResource = JsonApiResource> {
  data?: T | T[] | null;
  errors?: JsonApiError[];
  meta?: {
    page?: { offset: number; limit: number; total: number };
    [key: string]: unknown;
  };
  links?: Record<string, string | null>;
  included?: JsonApiResource[];
}

export interface JsonApiError {
  status?: string;
  title?: string;
  detail?: string;
  code?: string;
}

export interface CourseAttributes {
  "course-number"?: string;
  title?: string;
  subtitle?: string;
  "course-type"?: string;
  description?: string;
  location?: string;
  miscellaneous?: string;
  audience?: string;
  requirements?: string;
  "teaching-method"?: string;
  achievement?: string;
  credits?: number;
  capacity?: number;
  visible?: boolean;
}

export interface FileRefAttributes {
  name?: string;
  description?: string;
  mkdate?: string;
  chdate?: string;
  downloads?: number;
  filesize?: number;
}

export interface FolderAttributes {
  "folder-type"?: string;
  name?: string;
  description?: string;
  mkdate?: string;
  chdate?: string;
  "is-visible"?: boolean;
  "is-readable"?: boolean;
}

export interface UserAttributes {
  "formatted-name"?: string;
  "family-name"?: string;
  "given-name"?: string;
  username?: string;
  email?: string;
}

export interface EventAttributes {
  title?: string;
  description?: string;
  "start-date"?: string;
  "end-date"?: string;
  location?: string;
  category?: string;
}

export interface NewsAttributes {
  title?: string;
  content?: string;
  mkdate?: string;
  chdate?: string;
  "publication-start"?: string;
  "publication-end"?: string;
  "comments-allowed"?: boolean;
}

export interface WikiPageAttributes {
  keyword?: string;
  content?: string;
  chdate?: string;
  version?: number;
}

export interface StudiumCourse {
  id: string;
  title: string;
  courseNumber?: string;
  courseType?: string;
  subtitle?: string;
  description?: string;
  achievement?: string;
  credits?: number;
  semester?: string;
  semesterId?: string;
  lecturers?: string[];
  schedule: StudiumScheduleEntry[];
  examDates: StudiumExamDate[];
  fileCount: number;
  folderCount: number;
  lastSynced?: string;
  slug: string;
}

export interface StudiumScheduleEntry {
  title: string;
  start?: string;
  end?: string;
  location?: string;
  courseId?: string;
  courseTitle?: string;
}

export interface StudiumExamDate {
  courseId: string;
  courseTitle: string;
  date?: string;
  title: string;
  location?: string;
  confirmed: boolean;
  source: "event" | "achievement" | "miscellaneous";
  daysRemaining?: number;
}

/** Temporal context so agents default to "now" instead of the oldest enrollment. */
export interface StudiumSemesterInfo {
  id: string;
  title: string;
  slug: string;
  isCurrent: boolean;
  start?: string;
  end?: string;
  /** ISO-week-ish counter within the semester, e.g. "week 5". */
  weekNumber?: number;
  daysElapsed?: number;
  daysTotal?: number;
  progressPercent?: number;
}

export interface StudiumSemesterSummary {
  id: string;
  title: string;
  slug: string;
  isCurrent: boolean;
  synced: boolean;
}

export interface StudiumWorkspace {
  schemaVersion: "2";
  generatedAt: string;
  instanceUrl: string;
  user?: { id: string; name: string };
  /** The semester this workspace snapshot focuses on — always check this first. */
  activeSemester: StudiumSemesterInfo;
  /** Nearby semesters not synced by default; sync explicitly with --semester. */
  otherSemesters: StudiumSemesterSummary[];
  /** Relative folder holding course dirs for this snapshot, e.g. "SS2026" or "archive/WS2025-26". */
  workspaceFolder: string;
  /** @deprecated kept for backward compat; use activeSemester.title */
  semesters: string[];
  /** @deprecated kept for backward compat; use activeSemester.id */
  semesterId?: string;
  /** @deprecated kept for backward compat; use activeSemester.slug */
  semesterSlug?: string;
  courses: StudiumCourse[];
  nextDeadlines: StudiumExamDate[];
}

export interface SyncStateEntry {
  fileRefId: string;
  chdate?: string;
  etag?: string;
  localPath: string;
  sha256?: string;
  downloadedAt: string;
}

export interface SyncState {
  version: 1;
  entries: Record<string, SyncStateEntry>;
}

export interface SyncReport {
  downloaded: number;
  skipped: number;
  failed: number;
  bytes: number;
  errors: Array<{ fileRefId: string; message: string }>;
  files: Array<{ fileRefId: string; path: string; action: "download" | "skip" | "fail" }>;
}

export interface DigicampusConfig {
  baseUrl: string;
  workspacePath: string;
  instanceOrigin: string;
  oauth?: {
    clientId?: string;
    redirectUri?: string;
  };
  /** Override Stud.IP semester id for sync/studium (default: calendar current). */
  semesterId?: string;
  user?: { id: string; name: string };
}

export interface SessionData {
  type: "cookie" | "oauth";
  cookies?: Record<string, string>;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}

export type MaterialKind = "pdf" | "office" | "image" | "text" | "unsupported";

export interface ExtractResult {
  source: string;
  outDir: string;
  kind: MaterialKind;
  pages: number;
  hasImages?: boolean;
  tool?: string;
  skipped?: boolean;
  error?: string;
  hint?: string;
}

export interface ExtractManifest {
  schemaVersion: "1";
  source: string;
  kind: MaterialKind;
  pages: number;
  tool?: string;
  error?: string;
  extractedAt: string;
  sourceMtimeMs: number;
  sourceSize: number;
}

export interface FileTreeNode {
  id: string;
  name: string;
  type: "folder" | "file";
  children?: FileTreeNode[];
  fileRefId?: string;
  filesize?: number;
  chdate?: string;
}
