/**
 * Pinned downloads for the optional on-device runtimes (`setup ocr --math`,
 * `setup speech`). Each piece is an npm tarball, unpacked to
 * <dir>/node_modules/<name>, or a model file saved as <dir>/models/<name>, and
 * nothing is put in place before its SHA-256 matches the pin. A download that
 * broke off resumes where it stopped (downloadToFile), and <dir>/verified.json
 * records each piece once it is verified and in place, so a later run fetches
 * only what is missing or pinned anew.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { ImstudiumError } from "../errors.js";
import { downloadToFile } from "./ocr-runtime.js";

export interface PinnedAsset {
  label: string;
  url: string;
  sha256: string;
  bytes: number;
  /** npm: a package tarball unpacked to node_modules/<name>; file: saved as models/<name>. */
  kind: "npm" | "file";
  name: string;
  /** npm only: members to unpack (relative to package/), e.g. only this platform's binary folder; the whole package when absent. */
  members?: (platformKey: string) => string[];
}

/** The error code a runtime's install failures carry (its default hint names the right setup command). */
export type InstallErrorCode = "OCR_INSTALL_FAILED" | "SPEECH_INSTALL_FAILED";

export const pinnedModulesDir = (dir: string) => join(dir, "node_modules");
export const pinnedModelsDir = (dir: string) => join(dir, "models");
const verifiedFile = (dir: string) => join(dir, "verified.json");
/** Partial downloads, kept across runs so the next one resumes. */
const downloadsDir = (dir: string) => join(dir, "downloads");

/** Where a piece lives once installed (an npm package by its package.json). */
export function pinnedAssetPath(dir: string, a: Pick<PinnedAsset, "kind" | "name">): string {
  return a.kind === "npm" ? join(pinnedModulesDir(dir), a.name, "package.json") : join(pinnedModelsDir(dir), a.name);
}

/** Every piece is on disk (not whether it is the pinned one: see assetUpToDate). */
export function pinnedAssetsPresent(dir: string, assets: readonly PinnedAsset[]): boolean {
  return assets.every((a) => existsSync(pinnedAssetPath(dir, a)));
}

/** Each piece's SHA-256 as recorded when it was verified and put in place. */
export async function readVerified(dir: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(verifiedFile(dir), "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Whether `a` is in place as pinned: its SHA-256 was recorded when it was
 * verified. An install from before the record existed only put a file in place
 * after verifying it, so a file without a record counts when the old marker
 * names the same SHA-256 or names none (a run that broke off before the marker).
 */
export function assetUpToDate(a: Pick<PinnedAsset, "name" | "sha256">, present: boolean, verified: Record<string, string>, legacy: Record<string, string> | undefined): boolean {
  if (!present) return false;
  if (verified[a.name]) return verified[a.name] === a.sha256;
  return !legacy?.[a.name] || legacy[a.name] === a.sha256;
}

async function unpackPackage(archive: string, into: string, members: string[] | undefined, code: InstallErrorCode): Promise<void> {
  const { execFile } = await import("node:child_process");
  await mkdir(into, { recursive: true });
  const wanted = members ? members.map((m) => `package/${m}`) : ["package"];
  await new Promise<void>((resolve, reject) =>
    execFile(
      "tar",
      ["--no-same-owner", "-xzf", archive, "-C", into, "--strip-components=1", ...wanted],
      { maxBuffer: 16 * 1024 * 1024 },
      (err, _out, stderr) => (err ? reject(new ImstudiumError(`Unpacking ${archive} failed: ${stderr || err.message}`, code)) : resolve()),
    ),
  );
}

export interface PinnedInstallResult {
  /** Labels of the pieces fetched in this run. */
  installed: string[];
  /** Labels of the pieces already in place. */
  skipped: string[];
  downloadedBytes: number;
}

/**
 * Download, verify and put in place every piece of `assets` under `dir`.
 * Idempotent and incremental: pieces already verified are kept, a download
 * that broke off resumes (also in the next run), a piece whose pin changed is
 * fetched again, and model files no pin names any more are deleted. `force`
 * deletes `dir` first and fetches everything.
 */
export async function installPinnedAssets(
  dir: string,
  assets: readonly PinnedAsset[],
  options: {
    platformKey: string;
    errorCode: InstallErrorCode;
    force?: boolean;
    onProgress?: (msg: string) => void;
    fetchImpl?: typeof fetch;
    /** SHA-256 per name from a marker written before verified.json existed. */
    legacy?: Record<string, string>;
  },
): Promise<PinnedInstallResult> {
  const installed: string[] = [];
  const skipped: string[] = [];
  let downloadedBytes = 0;
  if (options.force) await rm(dir, { recursive: true, force: true });
  await mkdir(pinnedModelsDir(dir), { recursive: true });
  const verified = await readVerified(dir);
  for (const a of assets) {
    if (assetUpToDate(a, existsSync(pinnedAssetPath(dir, a)), verified, options.legacy)) {
      skipped.push(a.label);
      continue;
    }
    const file = a.url.split("/").pop();
    options.onProgress?.(`downloading ${file} (${Math.round(a.bytes / 1e6)} MB)`);
    const target = a.kind === "file" ? pinnedAssetPath(dir, a) : join(downloadsDir(dir), basename(a.url));
    if (a.kind === "file") await rm(target, { force: true });
    downloadedBytes += await downloadToFile(a.url, a.sha256, target, {
      onProgress: options.onProgress,
      errorCode: options.errorCode,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl, waitMs: 0 } : {}),
    });
    options.onProgress?.(`verified ${file} (sha256 ${a.sha256.slice(0, 12)}…)`);
    if (a.kind === "npm") {
      const dest = join(pinnedModulesDir(dir), a.name);
      const staging = `${dest}.staging`;
      await rm(staging, { recursive: true, force: true });
      await unpackPackage(target, staging, a.members?.(options.platformKey), options.errorCode);
      await rm(dest, { recursive: true, force: true });
      await mkdir(join(dest, ".."), { recursive: true });
      await rename(staging, dest);
      await rm(target, { force: true });
    }
    verified[a.name] = a.sha256;
    await writeFile(verifiedFile(dir), `${JSON.stringify(verified, null, 2)}\n`);
    installed.push(a.label);
  }
  await rm(downloadsDir(dir), { recursive: true, force: true });
  // Models an earlier version pinned are no longer used: free their space.
  const pinned = new Set(assets.filter((a) => a.kind === "file").map((a) => a.name));
  for (const name of await readdir(pinnedModelsDir(dir)).catch(() => [] as string[])) {
    if (!pinned.has(name) && /\.(onnx|json|txt)$/.test(name)) await unlink(join(pinnedModelsDir(dir), name)).catch(() => {});
  }
  return { installed, skipped, downloadedBytes };
}
