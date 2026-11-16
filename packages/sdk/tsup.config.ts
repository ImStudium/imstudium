import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // @imstudium/contract is a private workspace package: its error table is
  // bundled in, and its types are inlined into index.d.ts.
  dts: {
    resolve: [/^@imstudium\/contract/],
    compilerOptions: { rootDir: "..", paths: { "@imstudium/contract/errors": ["../contract/src/errors.ts"] } },
  },
  clean: true,
  noExternal: ["@imstudium/contract"],
  external: ["keytar", "playwright", "@firecrawl/anydoc", "@firecrawl/pdf-inspector", "zod"],
});
