#!/usr/bin/env bun
/**
 * Generated reference docs.
 *
 *   bun run docs            write every generated doc
 *   bun run docs:check      fail (exit 1) when a generated doc is out of date
 *   bun scripts/gen-docs.ts errors   one doc only
 *
 * The same renderers back `scripts/docs.test.ts`, so CI catches drift.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED_DOCS } from "./docs/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const only = args.filter((a) => !a.startsWith("--"));

let stale = 0;
for (const doc of GENERATED_DOCS) {
  if (only.length && !only.includes(doc.id)) continue;
  const path = join(ROOT, doc.path);
  const next = await doc.render();
  const current = await readFile(path, "utf-8").catch(() => "");
  if (current === next) {
    console.error(`up to date  ${doc.path}`);
    continue;
  }
  if (check) {
    stale++;
    console.error(`OUT OF DATE ${doc.path} — run: bun run docs`);
  } else {
    await writeFile(path, next);
    console.error(`wrote       ${doc.path}`);
  }
}
if (stale) process.exit(1);
