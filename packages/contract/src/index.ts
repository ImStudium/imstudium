/**
 * @imstudium/contract — the shapes ImStudium promises on the wire.
 *
 * - `cli/*`: every `imstudium … --json` payload (envelope v1 adds `schemaVersion: "1"`).
 * - `feed/*`: imstudium/source/v1 (discovery, items, pages, ingest).
 * - `envelope`: the v1 envelope and the error document.
 *
 * Import types freely; importing values pulls in zod, so keep runtime imports
 * out of hot CLI paths (the CLI loads this module lazily for `schema`).
 */
export * from "./common.js";
export * from "./envelope.js";
export * from "./cli/context.js";
export * from "./cli/planning.js";
export * from "./cli/content.js";
export * from "./cli/communication.js";
export * from "./cli/workspace.js";
export * from "./feed/index.js";
export * from "./commands.js";
