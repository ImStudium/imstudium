import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkspacePackages, releaseOrder } from "./release-order.js";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

describe("release order (P-008)", () => {
  const pkgs = readWorkspacePackages(ROOT);
  const order = releaseOrder(pkgs).map((p) => p.dir);

  it("is the topological order of the internal dependencies", () => {
    expect(order).toEqual(["contract", "sdk", "cli", "mcp"]);
    for (const p of pkgs) {
      for (const dep of p.internalDeps) {
        const depDir = pkgs.find((x) => x.name === dep)!.dir;
        expect(order.indexOf(depDir), `${p.dir} after ${depDir}`).toBeLessThan(order.indexOf(p.dir));
      }
    }
  });

  it("release.yml publishes in exactly that order", () => {
    const steps = [...read(".github/workflows/release.yml").matchAll(/release-publish\.sh (\w+)/g)].map((m) => m[1]);
    expect(steps).toEqual(order);
  });

  it("release.yml uses trusted publishing on a tag, never a token", () => {
    const yml = read(".github/workflows/release.yml")
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(yml).toMatch(/push:\s*\n\s*tags:\s*\["v\*"\]/);
    expect(yml).toMatch(/id-token: write/);
    expect(yml).toMatch(/node-version: 24/);
    expect(yml).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|registry-url/);
    const script = read("scripts/release-publish.sh");
    expect(script).toMatch(/npm publish --provenance --access public/);
    expect(script).toMatch(/dist\.attestations/);
  });

  it("the old token workflow is gone", () => {
    expect(() => read(".github/workflows/publish.yml")).toThrow();
    expect(() => read("pnpm-workspace.yaml")).toThrow();
  });

  it("one bun everywhere: packageManager, CI and release", () => {
    const pm = (JSON.parse(read("package.json")) as { packageManager: string }).packageManager;
    expect(pm).toBe("bun@1.4.2");
    for (const wf of ["ci.yml", "release.yml"]) {
      expect(read(`.github/workflows/${wf}`), wf).toMatch(/bun-version: 1\.4\.2/);
    }
  });

  it("every package has the same version", () => {
    expect(new Set(pkgs.map((p) => p.version)).size).toBe(1);
  });
});
