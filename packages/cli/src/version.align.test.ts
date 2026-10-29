import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SDK_VERSION } from "@imstudium/sdk";
import { getCliVersion } from "./version.js";

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = async (name: string) => JSON.parse(await readFile(join(PACKAGES, name, "package.json"), "utf-8")) as { version: string; dependencies?: Record<string, string> };

describe("one version across the packages", () => {
  it("contract, sdk, cli and mcp share a version; the SDK reports it at runtime", async () => {
    const versions = await Promise.all(["contract", "sdk", "cli", "mcp"].map(async (n) => (await pkg(n)).version));
    expect(new Set(versions).size).toBe(1);
    expect(SDK_VERSION).toBe(versions[0]);
    expect(getCliVersion()).toBe(versions[0]);
  });

  it("internal dependencies point at that version", async () => {
    const { version } = await pkg("cli");
    for (const name of ["sdk", "cli", "mcp"]) {
      for (const [dep, range] of Object.entries((await pkg(name)).dependencies ?? {})) {
        if (dep.startsWith("@imstudium/")) expect(range, `${name} → ${dep}`).toBe(`^${version}`);
      }
    }
  });
});
