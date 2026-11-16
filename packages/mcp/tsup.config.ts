import { defineConfig } from "tsup";

export default defineConfig({
  // dist/index.js ships as dist/mcp.js inside @imstudium/sdk
  // (scripts/assemble-sdk.ts). The private CLI command tree and contract are
  // bundled in; `@imstudium/sdk` resolves to the package itself.
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: false,
  noExternal: ["@imstudium/cli", "@imstudium/contract"],
  external: ["@imstudium/sdk", "commander", "playwright", "keytar", "@firecrawl/anydoc", "@firecrawl/pdf-inspector", "zod"],
  banner: { js: "#!/usr/bin/env node" },
});
