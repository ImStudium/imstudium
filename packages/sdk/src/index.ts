import { StudIpClient } from "./client.js";
import { AuthManager } from "./auth.js";
import { SyncEngine } from "./sync.js";
import { StudiumBuilder } from "./studium.js";
import { Extractor } from "./extract.js";
import { CoursesResource, DiscoveryResource, ScheduleResource } from "./resources/courses.js";
import { FilesResource, NewsResource, WikiResource } from "./resources/files.js";
import { loadConfig, saveConfig, getDefaultConfig, paths, expandPath } from "./config.js";

export * from "./types.js";
export * from "./errors.js";
export * from "./config.js";
export * from "./client.js";
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
export * from "./viewer.js";
export * from "./resources/courses.js";
export * from "./resources/files.js";

export interface ImstudiumSdk {
  client: StudIpClient;
  auth: AuthManager;
  courses: CoursesResource;
  files: FilesResource;
  wiki: WikiResource;
  news: NewsResource;
  schedule: ScheduleResource;
  discovery: DiscoveryResource;
  sync: SyncEngine;
  studium: StudiumBuilder;
  extractor: Extractor;
  config: Awaited<ReturnType<typeof loadConfig>>;
}

export async function createSdk(configOverride?: Partial<ReturnType<typeof getDefaultConfig>>) {
  const config = { ...(await loadConfig()), ...configOverride };
  const auth = new AuthManager();
  auth.setInstanceOrigin(config.instanceOrigin);
  await auth.loadSession();
  await auth.ensureValidSession({
    instanceOrigin: config.instanceOrigin,
    clientId: config.oauth?.clientId,
  });

  const client = new StudIpClient({
    baseUrl: config.baseUrl,
    getAuthHeaders: () => auth.getAuthHeaders(),
    getCookies: () => auth.getCookies(),
  });

  return {
    client,
    auth,
    courses: new CoursesResource(client),
    files: new FilesResource(client),
    wiki: new WikiResource(client),
    news: new NewsResource(client),
    schedule: new ScheduleResource(client),
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
