import { createSdk, ImstudiumError } from "@imstudium/sdk";

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

export function fail(err: unknown): never {
  const error =
    err instanceof ImstudiumError
      ? err
      : new ImstudiumError(err instanceof Error ? err.message : String(err), "UNKNOWN");
  if (globalOpts.json) {
    console.error(JSON.stringify(error.toJSON(), null, 2));
  } else {
    console.error(`Error: ${error.message}`);
    if (error.hint) console.error(`Hint: ${error.hint}`);
  }
  process.exit(1);
}

export async function getSdk(): Promise<Sdk> {
  const partial = globalOpts.instance
    ? {
        baseUrl: `${globalOpts.instance.replace(/\/$/, "")}/jsonapi.php/v1`,
        instanceOrigin: globalOpts.instance.replace(/\/$/, ""),
      }
    : undefined;
  return createSdk(partial);
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
