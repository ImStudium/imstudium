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
import { loadConfig, saveConfig, getDefaultConfig, paths, expandPath } from "./config.js";

export const SDK_VERSION = "0.2.0";

export * from "./types.js";
export * from "./errors.js";
export * from "./config.js";
export * from "./client.js";
export * from "./jsonapi.js";
export * from "./routes.js";
export * from "./rollover.js";
export * from "./search.js";
export * from "./auth.js";
export * from "./login-url.js";
export * from "./login-helper.js";
export * from "./ui.js";
export * from "./onboard-ui.js";
export * from "./semesters.js";
export * from "./search-corpus.js";
export * from "./workspace-path.js";
export * from "./browser-profile.js";
export * from "./oauth.js";
export * from "./sync.js";
export * from "./studium.js";
export * from "./extract.js";
export * from "./ingest/local-docs.js";
export * from "./extraction-guidance.js";
export * from "./viewer.js";
export * from "./migrate.js";
export * from "./resources/courses.js";
export * from "./resources/files.js";
export * from "./resources/communication.js";
export * from "./resources/courseware.js";
export * from "./content/index.js";
export * from "./resources/planning.js";
export * from "./resources/catalog.js";
export * from "./berlin.js";
export * from "./ics.js";
export * from "./timetable.js";

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
  const config = { ...(await loadConfig()), ...configOverride };
  const auth = new AuthManager();
  auth.setInstanceOrigin(config.instanceOrigin);
  await auth.loadSession();

  const client = new StudIpClient({
    baseUrl: config.baseUrl,
    getAuthHeaders: () => auth.getAuthHeaders(),
    getCookies: () => auth.getCookies(),
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

export { paths };
