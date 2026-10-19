import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "./config.js";

/**
 * Small disk cache for public, slow-changing Stud.IP data (semesters,
 * holidays). Fresh copy within `ttlMs`; a stale copy still answers when the
 * network fails. Never used for anything personal.
 */
export async function cachedJson<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  if (process.env.IMSTUDIUM_NO_CACHE === "1") return load();
  const file = join(paths.dataDir, "cache", `${createHash("sha256").update(key).digest("hex").slice(0, 24)}.json`);
  let stale: { at: number; value: T } | null = null;
  try {
    stale = JSON.parse(await readFile(file, "utf-8")) as { at: number; value: T };
    if (Date.now() - stale.at < ttlMs) return stale.value;
  } catch {
    // no cache yet
  }
  try {
    const value = await load();
    await mkdir(join(paths.dataDir, "cache"), { recursive: true });
    await writeFile(file, JSON.stringify({ at: Date.now(), value }));
    return value;
  } catch (err) {
    if (stale) return stale.value;
    throw err;
  }
}
