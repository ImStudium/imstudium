import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const cli = join(dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");

function run(args: string[]): string {
  return execFileSync(process.execPath, [cli, ...args], {
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

describe("digicampus CLI smoke", () => {
  it("prints help", () => {
    const out = run(["--help"]);
    expect(out).toContain("init");
    expect(out).toContain("studium");
    expect(out).toContain("klausuren");
  });

  it("discovers public JSON:API routes", () => {
    const out = run([
      "discover",
      "--json",
      "--instance",
      "https://digicampus.uni-augsburg.de",
    ]);
    const doc = JSON.parse(out) as { schemaVersion: string; routes?: unknown[] };
    expect(doc.schemaVersion).toBe("1");
    expect(Array.isArray(doc.routes)).toBe(true);
    expect((doc.routes?.length ?? 0) > 50).toBe(true);
  });
});
