import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ImstudiumConfig, SessionData } from "./types.js";

const DEFAULT_BASE = "https://digicampus.uni-augsburg.de/jsonapi.php/v1";
const DEFAULT_ORIGIN = "https://digicampus.uni-augsburg.de";
const CONFIG_DIR = join(homedir(), ".config", "imstudium");
const LEGACY_CONFIG_FILE = join(homedir(), ".config", "digicampus", "config.json");
const DATA_DIR = join(homedir(), ".local", "share", "imstudium");

export const paths = {
  configDir: CONFIG_DIR,
  configFile: join(CONFIG_DIR, "config.json"),
  syncStateFile: join(DATA_DIR, "sync-state.json"),
  defaultWorkspace: join(homedir(), "Studium"),
};

export function getDefaultConfig(): ImstudiumConfig {
  return {
    baseUrl: process.env.IMSTUDIUM_BASE_URL || process.env.DIGICAMPUS_BASE_URL || DEFAULT_BASE,
    instanceOrigin: process.env.IMSTUDIUM_ORIGIN || process.env.DIGICAMPUS_ORIGIN || DEFAULT_ORIGIN,
    workspacePath:
      process.env.IMSTUDIUM_WORKSPACE || process.env.DIGICAMPUS_WORKSPACE || paths.defaultWorkspace,
    oauth: {
      clientId: process.env.IMSTUDIUM_OAUTH_CLIENT_ID || process.env.DIGICAMPUS_OAUTH_CLIENT_ID,
      redirectUri: "http://127.0.0.1:0/callback",
    },
  };
}

export async function loadConfig(): Promise<ImstudiumConfig> {
  for (const file of [paths.configFile, LEGACY_CONFIG_FILE]) {
    try {
      const raw = await readFile(file, "utf-8");
      return { ...getDefaultConfig(), ...JSON.parse(raw) };
    } catch {
      // try next path
    }
  }
  return getDefaultConfig();
}

export async function saveConfig(config: Partial<ImstudiumConfig>): Promise<ImstudiumConfig> {
  const current = await loadConfig();
  const merged = { ...current, ...config };
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(paths.configFile, JSON.stringify(merged, null, 2));
  return merged;
}

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "course";
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
