/**
 * Publish order of the workspace packages: a package is published only after
 * every @imstudium/* package it depends on (npm would otherwise serve a
 * version that points at a dependency that does not exist yet).
 *
 *   bun scripts/release-order.ts      → prints the package dirs, one per line
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface WorkspacePackage {
  dir: string;
  name: string;
  version: string;
  internalDeps: string[];
}

export function readWorkspacePackages(root = join(import.meta.dirname, "..")): WorkspacePackage[] {
  const base = join(root, "packages");
  const pkgs = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const json = JSON.parse(readFileSync(join(base, d.name, "package.json"), "utf-8")) as {
        name: string;
        version: string;
        private?: boolean;
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      return { dir: d.name, json };
    })
    .filter(({ json }) => !json.private);
  const names = new Set(pkgs.map((p) => p.json.name));
  return pkgs.map(({ dir, json }) => ({
    dir,
    name: json.name,
    version: json.version,
    internalDeps: Object.keys({ ...json.dependencies, ...json.peerDependencies }).filter((d) => names.has(d)),
  }));
}

/** Topological order (dependencies first); ties broken by name so the order is stable. Throws on a cycle. */
export function releaseOrder(pkgs: WorkspacePackage[]): WorkspacePackage[] {
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const out: WorkspacePackage[] = [];
  const visit = (p: WorkspacePackage) => {
    if (done.has(p.name)) return;
    if (visiting.has(p.name)) throw new Error(`dependency cycle at ${p.name}`);
    visiting.add(p.name);
    for (const d of [...p.internalDeps].sort()) visit(byName.get(d)!);
    visiting.delete(p.name);
    done.add(p.name);
    out.push(p);
  };
  for (const p of [...pkgs].sort((a, b) => a.name.localeCompare(b.name))) visit(p);
  return out;
}

if (import.meta.main) {
  for (const p of releaseOrder(readWorkspacePackages())) console.log(p.dir);
}
