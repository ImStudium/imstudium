import { access, cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "imstudium");
const DATA_DIR = join(homedir(), ".local", "share", "imstudium");
const LEGACY_CONFIG_DIR = join(homedir(), ".config", "digicampus");
const LEGACY_DATA_DIR = join(homedir(), ".local", "share", "digicampus");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const SESSION_FILE = join(CONFIG_DIR, "session.json");
const SETUP_MANIFEST_FILE = join(CONFIG_DIR, "setup-manifest.json");
const SYNC_STATE_FILE = join(DATA_DIR, "sync-state.json");
const CHROME_PROFILE_DIR = join(CONFIG_DIR, "chrome-profile");
const LEGACY_KEYTAR_SERVICE = "digicampus";
const LEGACY_KEYTAR_ACCOUNT = "session";
const MIGRATION_MARKER = join(CONFIG_DIR, ".migrated-from-digicampus");

export interface MigrationResult {
  migrated: string[];
  skipped: string[];
}

let migrationPromise: Promise<MigrationResult> | null = null;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function copyIfMissing(src: string, dest: string, label: string, result: MigrationResult) {
  if (!(await exists(src))) {
    result.skipped.push(label);
    return;
  }
  if (await exists(dest)) {
    result.skipped.push(label);
    return;
  }
  await mkdir(join(dest, ".."), { recursive: true });
  await cp(src, dest, { recursive: true });
  result.migrated.push(label);
}

async function migrateKeytarSession(result: MigrationResult): Promise<void> {
  const keytar = await import("keytar").catch(() => null);
  if (!keytar?.getPassword || !keytar.setPassword) {
    result.skipped.push("keytar-session");
    return;
  }

  try {
    const existing = await keytar.getPassword("imstudium", LEGACY_KEYTAR_ACCOUNT);
    if (existing) {
      result.skipped.push("keytar-session");
      return;
    }
  } catch {
    // continue
  }

  try {
    const legacy = await keytar.getPassword(LEGACY_KEYTAR_SERVICE, LEGACY_KEYTAR_ACCOUNT);
    if (!legacy) {
      result.skipped.push("keytar-session");
      return;
    }
    await keytar.setPassword("imstudium", LEGACY_KEYTAR_ACCOUNT, legacy);
    result.migrated.push("keytar-session");
  } catch {
    result.skipped.push("keytar-session");
  }
}

export function convertLegacyManifest(raw: Record<string, unknown>): Record<string, unknown> {
  const next = { ...raw };
  if (!next.imstudiumVersion && typeof next.digicampusVersion === "string") {
    next.imstudiumVersion = next.digicampusVersion;
  }
  delete next.digicampusVersion;
  return next;
}

/** Idempotent: move DigiCampus config/session/data into ~/.config/imstudium. */
export async function migrateLegacyInstall(): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: [], skipped: [] };

  const legacyPresent = await exists(LEGACY_CONFIG_DIR);
  const markerPresent = await exists(MIGRATION_MARKER);
  if (!legacyPresent && markerPresent) return result;

  await mkdir(CONFIG_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  await copyIfMissing(
    join(LEGACY_CONFIG_DIR, "config.json"),
    CONFIG_FILE,
    "config.json",
    result,
  );
  await copyIfMissing(
    join(LEGACY_CONFIG_DIR, "session.json"),
    SESSION_FILE,
    "session.json",
    result,
  );
  await copyIfMissing(
    join(LEGACY_CONFIG_DIR, "setup-manifest.json"),
    SETUP_MANIFEST_FILE,
    "setup-manifest.json",
    result,
  );
  await copyIfMissing(
    join(LEGACY_CONFIG_DIR, "chrome-profile"),
    CHROME_PROFILE_DIR,
    "chrome-profile",
    result,
  );
  await copyIfMissing(
    join(LEGACY_DATA_DIR, "sync-state.json"),
    SYNC_STATE_FILE,
    "sync-state.json",
    result,
  );

  if (await exists(SETUP_MANIFEST_FILE)) {
    try {
      const raw = JSON.parse(await readFile(SETUP_MANIFEST_FILE, "utf-8")) as Record<string, unknown>;
      if ("digicampusVersion" in raw) {
        await writeFile(SETUP_MANIFEST_FILE, `${JSON.stringify(convertLegacyManifest(raw), null, 2)}\n`);
        result.migrated.push("setup-manifest-fields");
      }
    } catch {
      // ignore corrupt manifest
    }
  }

  await migrateKeytarSession(result);

  if (legacyPresent || result.migrated.length > 0) {
    await writeFile(
      MIGRATION_MARKER,
      `${new Date().toISOString()}\n`,
    );
  }

  return result;
}

export function ensureMigrated(): Promise<MigrationResult> {
  if (!migrationPromise) migrationPromise = migrateLegacyInstall();
  return migrationPromise;
}

/** Best-effort rename of legacy config dir after a successful migration. */
export async function archiveLegacyConfigDir(): Promise<boolean> {
  if (!(await exists(LEGACY_CONFIG_DIR))) return false;
  const archive = join(homedir(), ".config", "digicampus.archived");
  if (await exists(archive)) return false;
  try {
    await rename(LEGACY_CONFIG_DIR, archive);
    return true;
  } catch {
    return false;
  }
}

export const legacyPaths = {
  configDir: LEGACY_CONFIG_DIR,
  dataDir: LEGACY_DATA_DIR,
};
