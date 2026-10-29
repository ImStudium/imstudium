import { fileURLToPath } from "node:url";

/**
 * Path of the running CLI bundle (dist/cli.js). tsup bundles every module
 * into that one file, so import.meta.url here is the entry; `update` and
 * `doctor` use it to tell a global install from npx or a dev checkout.
 */
export const CLI_ENTRY = fileURLToPath(import.meta.url);
