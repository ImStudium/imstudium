import { createRequire } from "node:module";
import { StudIpClient } from "./client.js";
import { AuthManager } from "./auth.js";
import { SyncEngine } from "./sync.js";
import { StudiumBuilder } from "./studium.js";
import { Extractor } from "./extract.js";
import { CoursesResource, DiscoveryResource, ScheduleResource } from "./resources/courses.js";
import { FilesResource, NewsResource, WikiResource } from "./resources/files.js";
import { ActivityResource, BlubberResource, ForumResource, MessagesResource } from "./resources/communication.js";
import { CoursewareResource } from "./resources/courseware.js";
import { PlanningResource } from "./resources/planning.js";
import { CatalogResource } from "./resources/catalog.js";
import { PeopleResource } from "./resources/people.js";
import { ConsultationsResource } from "./resources/consultations.js";
import { loadConfig, saveConfig, getDefaultConfig, expandPath } from "./config.js";

/**
 * The public surface of @imstudium/sdk — named on purpose, one block per
 * area. Everything not listed here (HTML/UI helpers, normalisers, writers'
 * internals, cache and login plumbing) is internal and may change in any
 * release. Adding an export is an API decision: keep it to what the CLI, the
 * MCP server or an integrator needs (surface.test.ts pins the list).
 */

/** The installed @imstudium/sdk version, read from its package.json (one source of truth). */
export const SDK_VERSION: string = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

// ── Wire types (JSON:API documents, workspace files, config) ─────────────────
export type * from "./types.js";

// ── Errors ───────────────────────────────────────────────────────────────────
export {
  ImstudiumError,
  toImstudiumError,
  ERROR_CODES,
  EXIT_CODES,
  canonicalCode,
  type ErrorCode,
  type ErrorPayload,
} from "./errors.js";
export { isAuthError, isOfflineError } from "./resources/attrs.js";

// ── Config and paths ─────────────────────────────────────────────────────────
export { paths, getDefaultConfig, loadConfig, saveConfig, expandPath, slugify } from "./config.js";

// ── Client and JSON:API ──────────────────────────────────────────────────────
export { StudIpClient, type StudIpClientOptions, type JsonApiQuery, type PageResult } from "./client.js";
export { flatten, flattenAll, htmlToText, type Flat } from "./jsonapi.js";
export {
  readRouteCatalog,
  loadRouteCatalog,
  fetchRouteCatalog,
  matchRoute,
  searchRoutes,
  groupRoutes,
  type ApiRoute,
  type RouteCatalog,
} from "./routes.js";

// ── Sign-in ──────────────────────────────────────────────────────────────────
export { AuthManager, type CookieCheck, type BrowserLoginOptions, type InteractiveLoginOptions } from "./auth.js";
export { probeOAuthServer, oauthEndpoints, type OAuthProbeResult, type OAuthServerStatus } from "./oauth.js";
export { isChromeRunning } from "./browser-profile.js";
/** @internal The onboarding page; moves into the CLI with the SDK split (0.3). */
export { OnboardUI } from "./onboard-ui.js";

// ── Semesters and rollover ───────────────────────────────────────────────────
export {
  SemestersResource,
  findCurrentSemester,
  resolveSemesterByLabel,
  semesterSlug,
  computeSemesterProgress,
  courseActiveInSemester,
  semesterIdFromRelationships,
  type SemesterResource,
  type CourseWithSemester,
  type SemesterProgress,
} from "./semesters.js";
export {
  planRollover,
  applyRollover,
  listArchivedSemesters,
  type RolloverMove,
  type RolloverPlan,
  type RolloverResult,
} from "./rollover.js";

// ── Sync and the Studium workspace ───────────────────────────────────────────
export { SyncEngine, type SyncPart, type SyncOptions } from "./sync.js";
export { StudiumBuilder, normalizeStudiumWorkspace } from "./studium.js";
export { pickCourse, resolveCourseDir } from "./workspace-path.js";
export { ensureMigrated, archiveLegacyConfigDir, convertLegacyManifest, legacyPaths, type MigrationResult } from "./migrate.js";

// ── Extraction, viewer and search ────────────────────────────────────────────
export { Extractor, detectTools, toolHints, extractSlug, type ExtractTools } from "./extract.js";
export { buildSlideViewer, buildAgentVisualPayload, type AgentVisualPayload } from "./viewer.js";
export { searchWorkspace, type SearchKind, type SearchDoc, type SearchHit, type SearchOptions } from "./search.js";
export {
  rebuildSearchIndexes,
  buildCourseSearchIndex,
  buildMaterialsManifest,
  pageRef,
  parsePageRef,
  agentSearchGuidance,
  type AgentSearchGuidance,
  type CourseSearchIndex,
  type WorkspaceSearchIndex,
  type MaterialsManifest,
} from "./search-corpus.js";
export { EXTRACTION_LIMITS_FOR_AGENTS } from "./extraction-guidance.js";

// ── Resources (one per Stud.IP area; GET only) ───────────────────────────────
export { CoursesResource, ScheduleResource, DiscoveryResource, type ListMineOptions, type ResolvedSemesterContext } from "./resources/courses.js";
export { FilesResource, formatFileTree, type FileTreeEntry } from "./resources/files.js";
export { NewsResource, selectNews, writeNewsMarkdown, type NewsItem, type NewsScope, type NewsWriteResult } from "./resources/news.js";
export { WikiResource, buildWikiTree, renderWiki, wikiPageUrl, type WikiPage, type WikiNode } from "./resources/wiki.js";
export { MessagesResource, type MessageItem, type MessageBox } from "./resources/messages.js";
export {
  ForumResource,
  type CourseForum,
  type ForumCategory,
  type ForumTopic,
  type ForumDiscussion,
  type ForumPosting,
  type ForumThread,
  type ForumWriteResult,
} from "./resources/forum.js";
export { BlubberResource, type BlubberThread, type BlubberComment, type BlubberThreadWithComments } from "./resources/blubber.js";
export { ActivityResource, parseActivityTypes, ACTIVITY_TYPES, type ActivityItem, type ActivityType } from "./resources/activity.js";
export { syncCommunication, type SyncCommunicationOptions, type SyncCommunicationResult } from "./resources/communication.js";
export { displayName, excerpt, isoDay, isoMinute, toMs, type Person } from "./resources/comm-util.js";
export {
  CoursewareResource,
  sortTasks,
  coursewareElementUrl,
  type CwUnit,
  type CwElement,
  type CwElementNode,
  type CwTask,
  type CwTaskStatus,
} from "./resources/courseware.js";
export { PlanningResource, type CourseDate, type DateKind, type WeeklySlot, type Holiday } from "./resources/planning.js";
export { CatalogResource, type CatalogCourse, type CatalogCourseDetails, type StudyAreaNode, type ModuleInfo, type CourseOfStudyInfo } from "./resources/catalog.js";
export { PeopleResource, type CoursePeople, type CoursePerson } from "./resources/people.js";
export {
  ConsultationsResource,
  consultationBookingUrl,
  type ConsultationBlockInfo,
  type ConsultationSlotInfo,
} from "./resources/consultations.js";

// ── Courseware and wiki content ──────────────────────────────────────────────
export { syncContent, contentDeps, matchUnit, type ContentPart, type ContentSyncResult, type ContentSyncOptions } from "./content/sync-content.js";
export { parseFrontmatter, formatBytes } from "./content/markdown.js";

// ── Time: Europe/Berlin, timetable, calendar ─────────────────────────────────
export {
  BERLIN,
  WEEKDAYS_SHORT_DE,
  WEEKDAYS_LONG_DE,
  dateKey,
  parseDateKey,
  isDateKey,
  addDays,
  weekdayOf,
  startOfDay,
  hhmm,
  dayLabel,
  germanDate,
  toZonedIso,
} from "./berlin.js";
export {
  buildTimetable,
  weekRange,
  rhythmLabel,
  syncPlanning,
  offlinePlanningSnapshot,
  writeStundenplanMarkdown,
  type CourseRefLite,
  type Timetable,
  type TimetableDay,
  type TimetableOptions,
  type TimetableSources,
  type SemesterLite,
  type PlanningSnapshot,
  type CourseScheduleEntry,
} from "./timetable.js";
export { parseIcs, expandIcs, type IcsEvent, type IcsOccurrence } from "./ics.js";

// ── The SDK object ───────────────────────────────────────────────────────────

export interface ImstudiumSdk {
  client: StudIpClient;
  auth: AuthManager;
  courses: CoursesResource;
  files: FilesResource;
  wiki: WikiResource;
  courseware: CoursewareResource;
  news: NewsResource;
  messages: MessagesResource;
  forum: ForumResource;
  blubber: BlubberResource;
  activity: ActivityResource;
  schedule: ScheduleResource;
  planning: PlanningResource;
  catalog: CatalogResource;
  people: PeopleResource;
  consultations: ConsultationsResource;
  discovery: DiscoveryResource;
  sync: SyncEngine;
  studium: StudiumBuilder;
  extractor: Extractor;
  config: Awaited<ReturnType<typeof loadConfig>>;
}

export interface CreateSdkOptions {
  /** Renew an expired session headless from the saved login profile (default true). */
  silentRefresh?: boolean;
}

/**
 * Build the SDK without touching the network. The session is checked lazily:
 * the first 401 triggers one silent renewal, so local commands work offline
 * and a stale cookie never blocks startup.
 */
export async function createSdk(
  configOverride?: Partial<ReturnType<typeof getDefaultConfig>>,
  options: CreateSdkOptions = {},
) {
  const saved = await loadConfig();
  const config = { ...saved, ...configOverride };
  const auth = new AuthManager();
  // A pre-0.2 session (no origin) belongs to the *saved* instance, never to --instance.
  auth.setConfiguredOrigin(saved.instanceOrigin);
  auth.setInstanceOrigin(config.instanceOrigin);
  await auth.loadSession();

  const client = new StudIpClient({
    baseUrl: config.baseUrl,
    getAuthHeaders: () => auth.getAuthHeaders(),
    getCookies: () => auth.getCookies(),
    getSessionOrigin: () => auth.getSessionOrigin(),
    userAgent: `imstudium/${SDK_VERSION} (+https://github.com/ImStudium/imstudium)`,
    onUnauthorized:
      options.silentRefresh === false
        ? undefined
        : async () => {
            if (auth.getAuthHeaders().Authorization) {
              const s = await auth.ensureValidSession({
                instanceOrigin: config.instanceOrigin,
                clientId: config.oauth?.clientId,
              });
              return !!s;
            }
            return auth.refreshSilently({ instanceOrigin: config.instanceOrigin });
          },
  });

  return {
    client,
    auth,
    courses: new CoursesResource(client),
    files: new FilesResource(client),
    wiki: new WikiResource(client),
    courseware: new CoursewareResource(client),
    news: new NewsResource(client),
    messages: new MessagesResource(client),
    forum: new ForumResource(client),
    blubber: new BlubberResource(client),
    activity: new ActivityResource(client),
    schedule: new ScheduleResource(client),
    planning: new PlanningResource(client),
    catalog: new CatalogResource(client),
    people: new PeopleResource(client),
    consultations: new ConsultationsResource(client),
    discovery: new DiscoveryResource(client),
    sync: new SyncEngine(client),
    studium: new StudiumBuilder(client),
    extractor: new Extractor(),
    config,
    async saveConfig(partial: Parameters<typeof saveConfig>[0]) {
      return saveConfig(partial);
    },
    workspacePath: expandPath(config.workspacePath),
  } satisfies ImstudiumSdk & {
    saveConfig: typeof saveConfig;
    workspacePath: string;
  };
}
