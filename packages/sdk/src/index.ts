import { StudIpClient } from "./client.js";
import { AuthManager } from "./auth.js";
import { SyncEngine } from "./sync.js";
import { StudiumBuilder } from "./studium.js";
import { CoursesResource, DiscoveryResource, ScheduleResource } from "./resources/courses.js";
import { FilesResource, NewsResource, WikiResource } from "./resources/files.js";
import { loadConfig, saveConfig, getDefaultConfig, paths, expandPath } from "./config.js";

export * from "./types.js";
export * from "./errors.js";
export * from "./config.js";
export * from "./client.js";
export * from "./auth.js";
export * from "./sync.js";
export * from "./studium.js";
export * from "./resources/courses.js";
export * from "./resources/files.js";

export interface DigicampusSdk {
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
  config: Awaited<ReturnType<typeof loadConfig>>;
}

export async function createSdk(configOverride?: Partial<ReturnType<typeof getDefaultConfig>>) {
  const config = { ...(await loadConfig()), ...configOverride };
  const auth = new AuthManager();
  await auth.loadSession();

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
    config,
    async saveConfig(partial: Parameters<typeof saveConfig>[0]) {
      return saveConfig(partial);
    },
    workspacePath: expandPath(config.workspacePath),
  } satisfies DigicampusSdk & {
    saveConfig: typeof saveConfig;
    workspacePath: string;
  };
}

export { paths };
