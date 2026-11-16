/**
 * Assemble the one package that goes to npm: @imstudium/sdk with the
 * `imstudium` CLI and the `imstudium-mcp` server inside.
 *
 * contract, cli and mcp are private workspace packages. Their builds are
 * bundles: the CLI and the MCP server import `@imstudium/sdk`, which inside
 * the published package resolves to the package itself (Node's self
 * reference through "exports"), and the contract is bundled into each.
 *
 *   bun run build && bun scripts/assemble-sdk.ts   → .release/sdk (npm publish runs there)
 *
 * The script fails when a bundle imports a package the manifest does not
 * list, so a new dependency in the CLI or the MCP server cannot ship broken.
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
export const OUT = join(ROOT, ".release", "sdk");
const REPO = "https://github.com/ImStudium/imstudium";

interface Manifest {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  [key: string]: unknown;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf-8")) as T;
const pkg = (dir: string) => readJson<Manifest>(join(ROOT, "packages", dir, "package.json"));

/**
 * Bare package names a bundle imports (static, dynamic, re-exports and
 * require), without node builtins. require.resolve is a probe inside a try
 * (the MCP server's dev fallback to @imstudium/cli) and does not count.
 */
export function importedPackages(code: string): string[] {
  const names = new Set<string>();
  const specifiers = [...code.matchAll(/(?:^|[\s;])(?:import|export)\s[^"'`;]*?\sfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|^import\s*["']([^"']+)["']|\brequire\d*\(\s*["']([^"']+)["']\s*\)|createRequire\([^)]*\)\(\s*["']([^"']+)["']\s*\)/gm)];
  for (const m of specifiers) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
    if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) continue;
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
    if (builtinModules.includes(name)) continue;
    names.add(name);
  }
  return [...names].sort();
}

/** One dependency list for the published package: every runtime dependency of the four workspace packages, private ones left out. */
export function mergedDependencies(manifests: Manifest[]): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const m of manifests) {
    for (const [name, range] of Object.entries(m.dependencies ?? {})) {
      if (name.startsWith("@imstudium/")) continue;
      if (deps[name] && deps[name] !== range) throw new Error(`${name}: ${deps[name]} in one package, ${range} in ${m.name}; align them first`);
      deps[name] = range;
    }
  }
  return Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
}

/** The published README: links into the repository become absolute, so they work on npmjs.com. */
export function npmReadme(markdown: string): string {
  return markdown.replace(/\]\((?!https?:|mailto:|#)\.?\/?([^)\s]+)\)/g, (_, target: string) => `](${REPO}/blob/main/${target})`);
}

export function assemble(out = OUT): Manifest {
  const sdk = pkg("sdk");
  const parts = ["contract", "cli", "mcp"].map(pkg);
  for (const p of parts) if (!p.private) throw new Error(`${p.name} must stay private: only @imstudium/sdk is published`);
  for (const p of parts) if (p.version !== sdk.version) throw new Error(`${p.name} is ${p.version}, @imstudium/sdk is ${sdk.version}`);

  // cli.js plus the chunks it loads lazily (the contract for `imstudium schema`); program.js is the MCP server's.
  const cliDist = join(ROOT, "packages/cli/dist");
  const cliChunks = existsSync(cliDist) ? readdirSync(cliDist).filter((f) => f.endsWith(".js") && f !== "cli.js" && !f.startsWith("program.")) : [];
  const bundles: Array<[string, string]> = [
    [join(cliDist, "cli.js"), "cli.js"],
    ...cliChunks.map((f): [string, string] => [join(cliDist, f), f]),
    [join(ROOT, "packages/mcp/dist/index.js"), "mcp.js"],
  ];
  for (const f of [join(ROOT, "packages/sdk/dist/index.js"), ...bundles.map(([from]) => from)]) {
    if (!existsSync(f)) throw new Error(`${f} is missing; run bun run build first`);
  }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "dist"), { recursive: true });
  for (const f of readdirSync(join(ROOT, "packages/sdk/dist"))) cpSync(join(ROOT, "packages/sdk/dist", f), join(out, "dist", f));
  for (const [from, to] of bundles) {
    if (existsSync(join(out, "dist", to))) throw new Error(`dist/${to} exists twice`);
    cpSync(from, join(out, "dist", to));
    if (to === "cli.js" || to === "mcp.js") chmodSync(join(out, "dist", to), 0o755);
  }
  cpSync(join(ROOT, "packages/sdk/csl"), join(out, "csl"), { recursive: true });
  cpSync(join(ROOT, "packages/cli/skills"), join(out, "skills"), { recursive: true });
  cpSync(join(ROOT, "packages/cli/mcp.json"), join(out, "mcp.json"));
  cpSync(join(ROOT, "LICENSE"), join(out, "LICENSE"));
  writeFileSync(join(out, "README.md"), npmReadme(readFileSync(join(ROOT, "README.md"), "utf-8")));

  const dependencies = mergedDependencies([sdk, ...parts]);
  const manifest: Manifest = {
    name: sdk.name,
    version: sdk.version,
    description: sdk.description,
    license: sdk.license,
    type: "module",
    author: sdk.author,
    repository: sdk.repository,
    homepage: sdk.homepage,
    bugs: sdk.bugs,
    keywords: sdk.keywords,
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./package.json": "./package.json",
    },
    bin: { imstudium: "dist/cli.js", "imstudium-mcp": "dist/mcp.js" },
    files: ["dist", "csl", "skills", "mcp.json"],
    imsicheren: sdk.imsicheren,
    dependencies,
    engines: sdk.engines,
    publishConfig: sdk.publishConfig,
  };

  const missing: string[] = [];
  for (const f of readdirSync(join(out, "dist")).filter((f) => f.endsWith(".js"))) {
    for (const name of importedPackages(readFileSync(join(out, "dist", f), "utf-8"))) {
      if (name !== sdk.name && !dependencies[name]) missing.push(`dist/${f} imports ${name}`);
    }
  }
  if (missing.length) throw new Error(`not in the published dependencies:\n  ${missing.join("\n  ")}`);

  writeFileSync(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (import.meta.main) {
  const m = assemble();
  console.log(`${m.name}@${m.version} → ${OUT}`);
}
