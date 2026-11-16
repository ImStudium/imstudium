import { defineConfig, type Options } from "tsup";

// dist/cli.js ships inside @imstudium/sdk (scripts/assemble-sdk.ts), where
// `@imstudium/sdk` resolves to the package itself; @imstudium/contract is
// private and bundled in.
const shared: Options = {
  format: ["esm"],
  clean: false, // two builds share dist/; `bun run build` empties it first
  noExternal: ["@imstudium/contract"],
  external: ["zod"],
  banner: { js: "#!/usr/bin/env node" },
};

export default defineConfig([
  // The command. entry.ts locates the running CLI by import.meta.url, so it
  // must stay in dist/cli.js: only dynamic imports split off, which keeps
  // the contract and zod (`imstudium schema`) out of every start.
  { ...shared, entry: ["src/cli.ts"], splitting: true },
  // The command tree the MCP server parses with (@imstudium/cli/program).
  { ...shared, entry: ["src/program.ts"], splitting: false, dts: true },
]);
