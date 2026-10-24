import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The bundled CSL styles and locales ship in `packages/sdk/csl/`. This file
 * sits one level below the package root in both `src/` and `dist/`, so the
 * same relative path works in tests and in the published package.
 */
export function cslAssetsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, "..", "csl");
  if (existsSync(dir)) return dir;
  // bundlers that inline this module elsewhere: walk up until a csl/ folder appears
  let d = here;
  for (let i = 0; i < 5; i++) {
    d = dirname(d);
    if (existsSync(join(d, "csl", "styles"))) return join(d, "csl");
  }
  return dir;
}
