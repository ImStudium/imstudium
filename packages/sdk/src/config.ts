import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureMigrated } from "./migrate.js";
import type { ImstudiumConfig, SessionData } from "./types.js";

const DEFAULT_BASE = "https://digicampus.uni-augsburg.de/jsonapi.php/v1";
const DEFAULT_ORIGIN = "https://digicampus.uni-augsburg.de";
const CONFIG_DIR = join(homedir(), ".config", "imstudium");
const DATA_DIR = join(homedir(), ".local", "share", "imstudium");

export const paths = {
  configDir: CONFIG_DIR,
  configFile: join(CONFIG_DIR, "config.json"),
  dataDir: DATA_DIR,
  syncStateFile: join(DATA_DIR, "sync-state.json"),
  routesFile: join(DATA_DIR, "routes.json"),
  defaultWorkspace: join(homedir(), "Studium"),
};

export function getDefaultConfig(): ImstudiumConfig {
  return {
    baseUrl: process.env.IMSTUDIUM_BASE_URL || DEFAULT_BASE,
    instanceOrigin: process.env.IMSTUDIUM_ORIGIN || DEFAULT_ORIGIN,
    workspacePath: process.env.IMSTUDIUM_WORKSPACE || paths.defaultWorkspace,
    oauth: {
      clientId: process.env.IMSTUDIUM_OAUTH_CLIENT_ID,
      redirectUri: "http://127.0.0.1:0/callback",
    },
  };
}

/**
 * Per-process overrides. They beat config.json — Echo and other launchers point one
 * run at another workspace with IMSTUDIUM_WORKSPACE — and are never written back.
 */
export function envConfigOverrides(env: NodeJS.ProcessEnv = process.env): Partial<ImstudiumConfig> {
  const o: Partial<ImstudiumConfig> = {};
  if (env.IMSTUDIUM_WORKSPACE) o.workspacePath = env.IMSTUDIUM_WORKSPACE;
  if (env.IMSTUDIUM_ORIGIN) o.instanceOrigin = env.IMSTUDIUM_ORIGIN;
  if (env.IMSTUDIUM_BASE_URL) o.baseUrl = env.IMSTUDIUM_BASE_URL;
  return o;
}

/** config.json as saved, without environment overrides. */
async function readSavedConfig(): Promise<Partial<ImstudiumConfig>> {
  try {
    return JSON.parse(await readFile(paths.configFile, "utf-8")) as Partial<ImstudiumConfig>;
  } catch {
    return {};
  }
}

/** Defaults < config.json < environment (IMSTUDIUM_WORKSPACE, IMSTUDIUM_ORIGIN, IMSTUDIUM_BASE_URL). */
export async function loadConfig(): Promise<ImstudiumConfig> {
  await ensureMigrated();
  return { ...getDefaultConfig(), ...(await readSavedConfig()), ...envConfigOverrides() };
}

export async function saveConfig(config: Partial<ImstudiumConfig>): Promise<ImstudiumConfig> {
  await ensureMigrated();
  // Merge into what's on disk only: neither an environment override nor a default
  // derived from one (getDefaultConfig reads IMSTUDIUM_*) may become the saved setting.
  const onDisk = { ...(await readSavedConfig()), ...config };
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(paths.configFile, JSON.stringify(onDisk, null, 2));
  return { ...getDefaultConfig(), ...onDisk, ...envConfigOverrides() };
}

/** ASCII slug: diacritics folded, anything else `-`, cut at `max` characters (80; extractSlug asks for the whole). */
export function slugify(text: string, max = 80): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "course";
}

export function expandPath(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export type { SessionData };
