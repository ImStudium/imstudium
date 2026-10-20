import { Option } from "commander";
import { expandPath, ImstudiumError } from "@imstudium/sdk";
import type { Sdk } from "../runtime.js";

export { optionalSince, parseDuration, parseSince } from "../since.js";

/**
 * Shared flags, so every command spells them the same way:
 *
 *   -o, --output <dir>   the Studium workspace to read/write (default: config / IMSTUDIUM_WORKSPACE)
 *   -n, --limit <n>      newest/first N, strictly a positive whole number
 *   --since <when>       24h, 7d, 2w, today or a date
 *   --course <name>      title fragment, shortcut, slug, number or id
 *
 * `--json`, `--quiet` and `--instance` are global (root) options.
 */

export function outputOption(description = "Workspace directory (default: ~/Studium or IMSTUDIUM_WORKSPACE)"): Option {
  return new Option("-o, --output <dir>", description);
}

export function limitOption(fallback: number | "all", what = "Newest N"): Option {
  return new Option("-n, --limit <n>", `${what} (default ${fallback})`);
}

export function sinceOption(description = "Only since 24h, 7d, 2w, today or a date like 2026-10-01", fallback?: string): Option {
  const o = new Option("--since <when>", description);
  return fallback ? o.default(fallback) : o;
}

export function courseOption(description = "Only this course: title fragment, shortcut, slug, number or id"): Option {
  return new Option("--course <name>", description);
}

/** The workspace a command works on: `-o` wins, then config / IMSTUDIUM_WORKSPACE. */
export function workspaceDir(sdk: Pick<Sdk, "workspacePath">, opts: { output?: string }): string {
  return expandPath(opts.output || sdk.workspacePath);
}

/** Strict `--limit`: a whole number ≥ `min` (default 1), or the command's default. */
export function parseLimit(value: string | undefined, fallback: number, flag = "limit", min = 1): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!/^\s*\d+\s*$/.test(value) || !Number.isInteger(n) || n < min) {
    const what = min === 1 ? "a positive whole number" : `a whole number ≥ ${min}`;
    throw new ImstudiumError(`--${flag} expects ${what}, got "${value}"`, "BAD_ARGS", undefined, `e.g. --${flag} ${Math.max(fallback, min)}`);
  }
  return n;
}

/** Same as parseLimit, but undefined stays undefined (no limit). */
export function optionalLimit(value: string | undefined, flag = "limit"): number | undefined {
  return value === undefined || value === "" ? undefined : parseLimit(value, 0, flag);
}

/** A positional `[course]` or `--course`: the flag wins, the positional stays for compatibility. */
export function courseArg(positional: string | undefined, opts: { course?: string }): string | undefined {
  return opts.course ?? positional;
}
