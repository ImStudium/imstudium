import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { paths } from "@imstudium/sdk";
import type { Sdk } from "./runtime.js";

const ME_FILE = join(paths.dataDir, "me.json");

interface MeCache {
  origin: string;
  id: string;
  username?: string;
  name?: string;
}

/** Your Stud.IP user id, cached per instance so per-user routes cost one call. */
export async function meId(sdk: Sdk): Promise<string> {
  return (await me(sdk)).id;
}

export async function me(sdk: Sdk, options: { refresh?: boolean } = {}): Promise<MeCache> {
  const origin = sdk.config.instanceOrigin;
  if (!options.refresh) {
    try {
      const cached = JSON.parse(await readFile(ME_FILE, "utf-8")) as MeCache;
      if (cached.origin === origin && cached.id) return cached;
    } catch {
      // first call
    }
  }
  const user = await sdk.courses.getMe();
  const entry: MeCache = {
    origin,
    id: user.id,
    username: user.attributes?.username as string | undefined,
    name: user.attributes?.["formatted-name"] as string | undefined,
  };
  await mkdir(dirname(ME_FILE), { recursive: true });
  await writeFile(ME_FILE, JSON.stringify(entry, null, 2) + "\n", { mode: 0o600 });
  return entry;
}
