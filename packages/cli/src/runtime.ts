import type { CommanderError } from "commander";
import { createSdk, EXIT_CODES, ImstudiumError, toImstudiumError, type CreateSdkOptions } from "@imstudium/sdk";

export interface GlobalOpts {
  json?: boolean;
  quiet?: boolean;
  instance?: string;
}

/** Filled by the root command's preAction hook; shared by every command module. */
export const globalOpts: GlobalOpts = {};

export type Sdk = Awaited<ReturnType<typeof createSdk>>;

export function output(data: unknown, text?: string) {
  if (globalOpts.json) {
    console.log(JSON.stringify({ schemaVersion: "1", ...((typeof data === "object" && data) || { data }) }, null, 2));
  } else if (text) {
    console.log(text);
  } else if (typeof data === "string") {
    console.log(data);
  }
}

/** Human line on stderr unless --json/--quiet — keeps stdout clean for pipes. */
export function note(text: string) {
  if (!globalOpts.json && !globalOpts.quiet) console.error(text);
}

/**
 * Report an error and exit with its table exit code (docs/ERRORS.md):
 * 1 internal · 2 usage · 3 gated · 4 auth · 5 not found · 6 offline ·
 * 7 upstream · 8 workspace. Under --json the body goes to stderr as one
 * JSON document; stdout stays empty.
 */
export function fail(err: unknown): never {
  const error = toImstudiumError(err);
  if (globalOpts.json || jsonRequested()) {
    console.error(JSON.stringify(error.toJSON(), null, 2));
  } else {
    console.error(`Error: ${error.message}`);
    if (error.hint) console.error(`Hint: ${error.hint}`);
  }
  process.exit(error.exitCode);
}

/**
 * Commander's exit hook: help and --version exit as usual; usage errors
 * (unknown command, missing argument, bad option) exit 2 and, under --json,
 * print the same error document as every other failure.
 */
export function commanderExit(err: CommanderError): never {
  if (err.exitCode === 0 || err.code === "commander.helpDisplayed" || err.code === "commander.version" || err.code === "commander.help") {
    process.exit(err.exitCode);
  }
  if (jsonRequested()) {
    fail(
      new ImstudiumError(
        err.message.replace(/^error:\s*/i, ""),
        "BAD_ARGS",
        undefined,
        "imstudium --help lists the commands; imstudium <command> --help their flags",
        { commander: err.code },
      ),
    );
  }
  process.exit(EXIT_CODES.usage);
}

/** Commander prints its own usage error in human mode; under --json only our JSON goes out. */
export const commanderOutput = {
  outputError: (str: string, write: (s: string) => void) => {
    if (!jsonRequested()) write(str);
  },
};

/** --json before the preAction hook ran (Commander usage errors). */
export function jsonRequested(argv: string[] = process.argv): boolean {
  return argv.includes("--json");
}

export async function getSdk(options?: CreateSdkOptions): Promise<Sdk> {
  const partial = globalOpts.instance
    ? {
        baseUrl: `${globalOpts.instance.replace(/\/$/, "")}/jsonapi.php/v1`,
        instanceOrigin: globalOpts.instance.replace(/\/$/, ""),
      }
    : undefined;
  return createSdk(partial, options);
}

/** Wrap an async action so every command reports errors the same way. */
export function act<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (e) {
      fail(e);
    }
  };
}
