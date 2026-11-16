import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"],
    // Tests never read or write the real ~/.local/share/imstudium cache.
    env: { IMSTUDIUM_NO_CACHE: "1" },
    // Many tests start the built CLI as a process (citeproc, PDF tools); on a
    // busy CI runner three such starts passed 5 s once (16 Nov, arbeit.test).
    testTimeout: 20_000,
  },
});
