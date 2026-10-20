import { defineConfig } from "tsup";

export default defineConfig({
  // program.ts is the command tree the MCP door parses with
  // (@imstudium/cli/program). No code splitting: dist/cli.js must stay one
  // self-contained bundle (entry.ts locates the running CLI by import.meta.url).
  entry: ["src/cli.ts", "src/program.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  splitting: false,
  banner: { js: "#!/usr/bin/env node" },
});
