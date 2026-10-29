import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["keytar", "playwright", "@firecrawl/anydoc", "@firecrawl/pdf-inspector"],
});
