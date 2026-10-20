import { buildProgram } from "./program.js";

// The entry point only parses: the command tree lives in program.ts,
// every command in commands/*.ts.
await buildProgram().parseAsync();
