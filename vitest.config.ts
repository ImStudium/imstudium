import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"],
    // Tests never read or write the real ~/.local/share/imstudium cache.
    env: { IMSTUDIUM_NO_CACHE: "1" },
  },
});
