import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemble, importedPackages, mergedDependencies, npmReadme } from "./assemble-sdk.js";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const manifest = (dir: string) => JSON.parse(read(`packages/${dir}/package.json`)) as Record<string, unknown> & { version: string };

describe("release (P-008): one public package, @imstudium/sdk", () => {
  it("contract, cli and mcp are private; only sdk publishes, to npmjs.com, public", () => {
    for (const dir of ["contract", "cli", "mcp"]) {
      expect(manifest(dir).private, dir).toBe(true);
      expect(manifest(dir).publishConfig, dir).toBeUndefined();
    }
    const { private: isPrivate, publishConfig } = manifest("sdk") as { private?: boolean; publishConfig?: { registry?: string; access?: string } };
    expect(isPrivate).toBeUndefined();
    expect(publishConfig).toEqual({ access: "public", registry: "https://registry.npmjs.org/" });
  });

  it("release.yml assembles and publishes that one package, by trusted publishing on a tag, never a token", () => {
    const yml = read(".github/workflows/release.yml")
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(yml).toMatch(/push:\s*\n\s*tags:\s*\["v\*"\]/);
    expect(yml).toMatch(/id-token: write/);
    expect(yml).toMatch(/node-version: 24/);
    expect(yml).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|registry-url/);
    expect(yml.indexOf("bun scripts/assemble-sdk.ts")).toBeGreaterThan(yml.indexOf("bun run validate"));
    expect(yml.indexOf("bash scripts/release-publish.sh")).toBeGreaterThan(yml.indexOf("bun scripts/assemble-sdk.ts"));
    expect([...yml.matchAll(/npm publish|release-publish\.sh/g)]).toHaveLength(1);
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
    expect(new Set(["contract", "sdk", "cli", "mcp"].map((d) => manifest(d).version)).size).toBe(1);
  });
});

describe("assemble-sdk", () => {
  it("reads every kind of import a bundle makes, and skips builtins, relative paths and probes", () => {
    const code = [
      'import { Command } from "commander";',
      'import {\n  a,\n  b\n} from "@scope/pkg/sub";',
      'export { x } from "zod";',
      'const m = await import("@firecrawl/anydoc");',
      'const c = require2("citeproc");',
      'createRequire(import.meta.url)("katex");',
      'import "./side.js"; import fs from "node:fs"; import path from "path";',
      'require.resolve("@imstudium/cli/package.json");',
    ].join("\n");
    expect(importedPackages(code)).toEqual(["@firecrawl/anydoc", "@scope/pkg", "citeproc", "commander", "katex", "zod"]);
  });

  it("merges dependencies without the private packages and refuses two ranges for one package", () => {
    expect(
      mergedDependencies([
        { name: "a", version: "1", dependencies: { zod: "^4", "@imstudium/contract": "^0.4.1" } },
        { name: "b", version: "1", dependencies: { commander: "^13", zod: "^4" } },
      ]),
    ).toEqual({ commander: "^13", zod: "^4" });
    expect(() => mergedDependencies([{ name: "a", version: "1", dependencies: { zod: "^4" } }, { name: "b", version: "1", dependencies: { zod: "^3" } }])).toThrow(/zod/);
  });

  it("points the README's repository links at GitHub and leaves the rest", () => {
    expect(npmReadme("[Arbeiten](docs/ARBEITEN.md) [x](./CHANGELOG.md) [site](https://imstudium.com) [top](#install)")).toBe(
      "[Arbeiten](https://github.com/ImStudium/imstudium/blob/main/docs/ARBEITEN.md) [x](https://github.com/ImStudium/imstudium/blob/main/CHANGELOG.md) [site](https://imstudium.com) [top](#install)",
    );
  });

  // Runs on the built packages (`bun run validate` builds before vitest); CI's package job installs the tarball and starts both commands.
  it.skipIf(!existsSync(join(ROOT, "packages/cli/dist/cli.js")))("builds the package: both commands, the SDK with its types, the bundled files", () => {
    const out = join(ROOT, ".release", "test-sdk");
    try {
      const m = assemble(out) as { bin: Record<string, string>; dependencies: Record<string, string>; files: string[] };
      expect(m.bin).toEqual({ imstudium: "dist/cli.js", "imstudium-mcp": "dist/mcp.js" });
      expect(Object.keys(m.dependencies).filter((d) => d.startsWith("@imstudium/"))).toEqual([]);
      for (const f of [...Object.values(m.bin), "dist/index.js", "dist/index.d.ts", "csl/styles", "skills/imstudium-cli/SKILL.md", "mcp.json", "README.md", "LICENSE"]) {
        expect(existsSync(join(out, f)), f).toBe(true);
      }
      expect(readFileSync(join(out, "dist/index.d.ts"), "utf-8")).not.toMatch(/from ['"]@imstudium\/contract/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
