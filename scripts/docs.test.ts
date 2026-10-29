import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_DOCS } from "./docs/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("generated docs are up to date (bun run docs)", () => {
  for (const doc of GENERATED_DOCS) {
    it(doc.path, async () => {
      const current = await readFile(join(ROOT, doc.path), "utf-8").catch(() => "");
      expect(current, `${doc.path} is stale — run: bun run docs`).toBe(await doc.render());
    });
  }
});
