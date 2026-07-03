import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export type InstallMode = "global" | "npx" | "development";

const CLI_PACKAGES = ["digicampus", "digicampus-mcp"] as const;

export function getCliVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return (require(pkgPath) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

export function detectInstallMode(entryPath: string): InstallMode {
  try {
    const resolved = realpathSync(entryPath);
    if (resolved.includes(`${join("digicampus", "packages", "cli")}`)) {
      return "development";
    }
    const globalRoot = execSync("npm root -g", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    if (resolved.startsWith(globalRoot)) return "global";
  } catch {
    // npx or local node_modules — treat as npx (always fresh with npx -y)
  }
  return "npx";
}

export function semverLt(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return true;
    if (a[i]! > b[i]!) return false;
  }
  return false;
}

export async function fetchNpmLatest(name: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/latest`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

export interface UpdateCheckResult {
  schemaVersion: "1";
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  installMode: InstallMode;
  packages: Array<{ name: string; current: string; latest: string | null; updateAvailable: boolean }>;
  recommendedAction: string;
}

export async function checkForUpdates(entryPath: string): Promise<UpdateCheckResult> {
  const current = getCliVersion();
  const installMode = detectInstallMode(entryPath);

  const packages: UpdateCheckResult["packages"] = [];
  let latestMain: string | null = null;

  for (const name of CLI_PACKAGES) {
    const latest = await fetchNpmLatest(name);
    if (name === "digicampus") latestMain = latest;
    packages.push({
      name,
      current: name === "digicampus" ? current : current,
      latest,
      updateAvailable: latest ? semverLt(current, latest) : false,
    });
  }

  const updateAvailable = latestMain ? semverLt(current, latestMain) : false;

  return {
    schemaVersion: "1",
    current,
    latest: latestMain,
    updateAvailable,
    installMode,
    packages,
    recommendedAction: "digicampus update",
  };
}

export async function runGlobalUpdate(): Promise<{ ok: boolean; output: string }> {
  try {
    const out = execSync("npm install -g digicampus@latest digicampus-mcp@latest", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, output: out.trim() };
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, output: e.stderr || e.stdout || e.message || "npm install failed" };
  }
}
