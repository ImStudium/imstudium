import { defineConfig } from "tsup";

export default defineConfig({
  // `errors` is a separate, zod-free entry: the SDK and the CLI load it on
  // every start, so it must stay cheap to import.
  entry: ["src/index.ts", "src/errors.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
});
