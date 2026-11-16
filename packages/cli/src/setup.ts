import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expandPath, paths } from "@imstudium/sdk";
import {
  type AgentId,
  type AgentProfile,
  type SetupManifest,
  IMSTUDIUM_SETUP_VERSION,
  detectAgents,
  emptyManifest,
  hashContent,
  installedPlugin,
  resolveAgentProfiles,
  uniqueSkillsDirs,
  type PluginInstall,
} from "./agents.js";
import { convertLegacyManifest, ensureMigrated, legacyPaths } from "@imstudium/sdk";

export type { AgentId } from "./agents.js";

export interface SetupOptions {
  yes?: boolean;
  agent?: AgentId | "all";
  workspace?: string;
  project?: boolean;
  /** Install to every harness path, not only detected ones */
  allAgents?: boolean;
  /** Overwrite skills/MCP even when unchanged */
  force?: boolean;
}

export interface SetupItemResult {
  action: "installed" | "skipped" | "updated" | "removed";
  path: string;
  /** Set when a step could not be done: what to run instead. */
  note?: string;
}

export interface SetupResult {
  agents: string[];
  skills: SetupItemResult[];
  mcp: SetupItemResult[];
  workflows: SetupItemResult[];
  project?: SetupItemResult[];
  /** Harnesses whose skills come from the installed imstudium plugin; setup leaves their skills folder to it. */
  plugins: PluginInstall[];
  /** Old copies cleaned up: workflow skills installed under their folder name, standalone skills a plugin now provides. */
  removed: SetupItemResult[];
  manifest: SetupManifest;
}

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_ROOT = join(PKG_ROOT, "skills");
const WORKFLOWS_ROOT = join(SKILLS_ROOT, "workflows");
const MANIFEST_FILE = join(paths.configDir, "setup-manifest.json");

function resolveMcpLaunch(): { command: string; args: string[] } {
  if (process.env.IMSTUDIUM_MCP_LAUNCH === "npx") {
    return { command: "npx", args: ["-y", "@imstudium/mcp"] };
  }
  const local = join(homedir(), ".local", "bin", "imstudium-mcp");
  if (existsSync(local)) {
    return { command: local, args: [] };
  }
  return { command: "npx", args: ["-y", "@imstudium/mcp"] };
}

export function mergeMcpConfig(
  existing: Record<string, unknown>,
  workspace: string,
): Record<string, unknown> {
  const servers =
    (existing.mcpServers as Record<string, Record<string, unknown>> | undefined) ?? {};
  const { digicampus: _legacy, ...rest } = servers;
  const launch = resolveMcpLaunch();
  return {
    ...existing,
    mcpServers: {
      ...rest,
      imstudium: {
        ...launch,
        env: { IMSTUDIUM_WORKSPACE: expandPath(workspace) },
      },
    },
  };
}

export function imstudiumMcpEntry(workspace: string): Record<string, unknown> {
  const merged = mergeMcpConfig({}, workspace) as { mcpServers: Record<string, unknown> };
  return merged.mcpServers.imstudium as Record<string, unknown>;
}

export function mcpEntryMatches(
  existing: Record<string, unknown> | undefined,
  desired: Record<string, unknown>,
): boolean {
  if (!existing) return false;
  return stableJson(existing) === stableJson(desired);
}

function stableJson(obj: unknown): string {
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = sortKeys(record[key]);
          return acc;
        }, {});
    }
    return value;
  };
  return JSON.stringify(sortKeys(obj));
}

async function loadManifest(): Promise<SetupManifest | null> {
  try {
    return JSON.parse(await readFile(MANIFEST_FILE, "utf-8")) as SetupManifest;
  } catch {
    try {
      const legacyFile = join(legacyPaths.configDir, "setup-manifest.json");
      const raw = JSON.parse(await readFile(legacyFile, "utf-8")) as Record<string, unknown>;
      const converted = convertLegacyManifest(raw) as unknown as SetupManifest;
      await saveManifest(converted);
      return converted;
    } catch {
      return null;
    }
  }
}

async function saveManifest(manifest: SetupManifest): Promise<void> {
  await mkdir(dirname(MANIFEST_FILE), { recursive: true });
  manifest.updatedAt = new Date().toISOString();
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function listSkillDirs(root: string): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** The `name:` in a SKILL.md frontmatter, or null. */
export function skillFrontmatterName(content: string): string | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  const m = fm ? /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(fm[1]!) : null;
  return m ? m[1]!.trim() : null;
}

interface BundledSkill {
  /** Source folder, e.g. skills/workflows/klausur-prep */
  src: string;
  /** Folder in the bundle: klausur-prep */
  dir: string;
  /** The name the harness knows it by (frontmatter): imstudium-klausur-prep. Installed under this folder. */
  name: string;
  hash: string;
}

/** Core skills and workflows as shipped, each with its frontmatter name. */
async function bundledSkills(kind: "core" | "workflows"): Promise<BundledSkill[]> {
  const root = kind === "core" ? SKILLS_ROOT : WORKFLOWS_ROOT;
  const out: BundledSkill[] = [];
  for (const dir of await listSkillDirs(root)) {
    if (kind === "core" && dir === "workflows") continue;
    const content = await readFile(join(root, dir, "SKILL.md"), "utf-8").catch(() => null);
    if (content === null) continue;
    out.push({ src: join(root, dir), dir, name: skillFrontmatterName(content) ?? dir, hash: hashContent(content) });
  }
  return out;
}

/**
 * Our skills at their install place; plus folders an older setup created under
 * the bundle's folder name (klausur-prep) — only when that folder's SKILL.md
 * carries one of our names, so a student's own skill of that name stays.
 */
async function ourSkillFolders(skillsDir: string, skills: BundledSkill[]): Promise<{ current: string[]; legacy: string[] }> {
  const names = new Set(skills.map((s) => s.name));
  const current: string[] = [];
  const legacy: string[] = [];
  for (const skill of skills) {
    if (existsSync(join(skillsDir, skill.name, "SKILL.md"))) current.push(skill.name);
    if (skill.dir === skill.name) continue;
    const old = await readFile(join(skillsDir, skill.dir, "SKILL.md"), "utf-8").catch(() => null);
    const name = old === null ? null : skillFrontmatterName(old);
    if (name && names.has(name)) legacy.push(skill.dir);
  }
  return { current, legacy };
}

async function removeSkillFolders(skillsDir: string, folders: string[], removed: SetupItemResult[]): Promise<void> {
  for (const f of folders) {
    await rm(join(skillsDir, f), { recursive: true, force: true });
    removed.push({ action: "removed", path: join(skillsDir, f) });
  }
}

/** Every harness in the group gets imstudium's skills from its installed plugin. */
function pluginCovers(group: AgentProfile[]): PluginInstall | null {
  const installs = group.map((a) => installedPlugin(a.id));
  return installs.every(Boolean) ? installs[0]! : null;
}

async function cleanupLegacySkills(skillsDir: string): Promise<string[]> {
  const removed: string[] = [];
  for (const name of await listSkillDirs(skillsDir)) {
    if (!name.startsWith("digicampus-")) continue;
    await rm(join(skillsDir, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

export async function installSkillIfChanged(
  src: string,
  dest: string,
  force: boolean,
): Promise<SetupItemResult> {
  const srcFile = join(src, "SKILL.md");
  const destFile = join(dest, "SKILL.md");
  const srcContent = await readFile(srcFile, "utf-8");
  const srcHash = hashContent(srcContent);

  if (!force) {
    try {
      const destContent = await readFile(destFile, "utf-8");
      if (hashContent(destContent) === srcHash) {
        return { action: "skipped", path: dest };
      }
    } catch {
      // new install
    }
  }

  let hadPrevious = false;
  try {
    await readFile(destFile, "utf-8");
    hadPrevious = true;
  } catch {
    // new
  }

  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
  return { action: hadPrevious ? "updated" : "installed", path: dest };
}

export async function installMcpFile(
  file: string,
  workspace: string,
  force: boolean,
): Promise<SetupItemResult> {
  const desired = imstudiumMcpEntry(workspace);
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(file, "utf-8")) as Record<string, unknown>;
  } catch {
    // new file
  }

  const servers = (existing.mcpServers as Record<string, Record<string, unknown>>) ?? {};
  if (!force && mcpEntryMatches(servers.imstudium, desired)) {
    return { action: "skipped", path: file };
  }

  const merged = mergeMcpConfig(existing, workspace);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
  return { action: servers.imstudium ? "updated" : "installed", path: file };
}

export async function installProjectMcp(
  workspace: string,
  force = false,
): Promise<SetupItemResult> {
  const file = join(expandPath(workspace), "mcp.json");
  return installMcpFile(file, workspace, force);
}

async function installSkillsForAgents(
  agents: AgentProfile[],
  manifest: SetupManifest,
  force: boolean,
  removed: SetupItemResult[],
): Promise<SetupItemResult[]> {
  const results: SetupItemResult[] = [];
  const skills = await bundledSkills("core");
  const all = [...skills, ...(await bundledSkills("workflows"))];
  const byDir = uniqueSkillsDirs(agents);

  for (const [skillsDir, group] of byDir) {
    const plugin = pluginCovers(group);
    if (plugin) {
      // The plugin ships the same skills: a second copy here would show every skill twice.
      const ours = await ourSkillFolders(skillsDir, all);
      await removeSkillFolders(skillsDir, [...ours.current, ...ours.legacy], removed);
      for (const a of group) delete manifest.skills[a.id];
      results.push({ action: "skipped", path: `${skillsDir} (skills come from the ${plugin.key} plugin)` });
      continue;
    }
    await mkdir(skillsDir, { recursive: true });
    await cleanupLegacySkills(skillsDir);
    for (const skill of skills) {
      results.push(await installSkillIfChanged(skill.src, join(skillsDir, skill.name), force));
      for (const a of group) {
        manifest.skills[a.id] ??= {};
        manifest.skills[a.id][skill.name] = skill.hash;
      }
    }
  }
  return results;
}

async function installWorkflowsForAgents(
  agents: AgentProfile[],
  force: boolean,
  removed: SetupItemResult[],
): Promise<SetupItemResult[]> {
  const results: SetupItemResult[] = [];
  const workflows = await bundledSkills("workflows");
  const byDir = uniqueSkillsDirs(agents);

  for (const [skillsDir, group] of byDir) {
    if (pluginCovers(group)) continue; // handled (and cleaned) with the skills
    // 0.2.0 installed workflows under their folder name (klausur-prep) while their
    // frontmatter says imstudium-klausur-prep: move to the frontmatter name.
    const { legacy } = await ourSkillFolders(skillsDir, workflows);
    await removeSkillFolders(skillsDir, legacy, removed);
    for (const wf of workflows) {
      results.push(await installSkillIfChanged(wf.src, join(skillsDir, wf.name), force));
    }
  }
  return results;
}

/** Claude Code: `claude mcp add-json -s user` — never hand-edit ~/.claude.json, it is live state. */
async function installClaudeCodeMcp(workspace: string, force: boolean): Promise<SetupItemResult> {
  const { spawnSync } = await import("node:child_process");
  const where = "claude mcp (user scope)";
  const probe = spawnSync("claude", ["mcp", "get", "imstudium"], { encoding: "utf-8" });
  if (probe.error) {
    const entry = JSON.stringify({ type: "stdio", ...imstudiumMcpEntry(workspace) });
    return { action: "skipped", path: where, note: `Claude Code: the claude CLI is not on PATH, so the MCP server is not registered there. Run: claude mcp add-json -s user imstudium '${entry}'` };
  }
  const exists = probe.status === 0;
  if (exists && !force) return { action: "skipped", path: where };
  if (exists) spawnSync("claude", ["mcp", "remove", "imstudium", "-s", "user"], { encoding: "utf-8" });
  const entry = { type: "stdio", ...imstudiumMcpEntry(workspace) };
  const add = spawnSync("claude", ["mcp", "add-json", "-s", "user", "imstudium", JSON.stringify(entry)], {
    encoding: "utf-8",
  });
  if (add.status !== 0) return { action: "skipped", path: where, note: `Claude Code: claude mcp add-json failed: ${(add.stderr || add.stdout).trim().slice(0, 120)}` };
  return { action: exists ? "updated" : "installed", path: where };
}

function tomlString(value: string): string {
  return JSON.stringify(value); // TOML basic strings share JSON escaping for our values
}

/** Codex: one `[mcp_servers.imstudium]` table in config.toml, replaced in place. */
export function upsertCodexToml(existing: string, workspace: string): string {
  const entry = imstudiumMcpEntry(workspace) as { command: string; args: string[]; env: Record<string, string> };
  const block = [
    "[mcp_servers.imstudium]",
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
    `env = { ${Object.entries(entry.env)
      .map(([k, v]) => `${k} = ${tomlString(v)}`)
      .join(", ")} }`,
  ].join("\n");
  const re = /^\[mcp_servers\.imstudium\][\s\S]*?(?=^\[|(?![\s\S]))/m;
  if (re.test(existing)) return existing.replace(re, `${block}\n\n`).replace(/\n{3,}$/, "\n");
  return `${existing.replace(/\s*$/, "")}${existing.trim() ? "\n\n" : ""}${block}\n`;
}

async function installCodexMcp(file: string, workspace: string, force: boolean): Promise<SetupItemResult> {
  let existing = "";
  try {
    existing = await readFile(file, "utf-8");
  } catch {
    // new file
  }
  const next = upsertCodexToml(existing, workspace);
  const had = existing.includes("[mcp_servers.imstudium]");
  if (next === existing || (had && !force && next.trim() === existing.trim())) return { action: "skipped", path: file };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, next);
  return { action: had ? "updated" : "installed", path: file };
}

/** OpenCode: `mcp.imstudium = { type: "local", command: [...], environment }` in opencode.json. */
async function installOpenCodeMcp(file: string, workspace: string, force: boolean): Promise<SetupItemResult> {
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(file, "utf-8")) as Record<string, unknown>;
  } catch {
    // new file
  }
  const entry = imstudiumMcpEntry(workspace) as { command: string; args: string[]; env: Record<string, string> };
  const desired = { type: "local", command: [entry.command, ...entry.args], environment: entry.env, enabled: true };
  const mcp = (existing.mcp as Record<string, Record<string, unknown>> | undefined) ?? {};
  if (!force && mcpEntryMatches(mcp.imstudium, desired)) return { action: "skipped", path: file };
  const merged = { $schema: "https://opencode.ai/config.json", ...existing, mcp: { ...mcp, imstudium: desired } };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
  return { action: mcp.imstudium ? "updated" : "installed", path: file };
}

async function installMcpForAgents(
  agents: AgentProfile[],
  workspace: string,
  manifest: SetupManifest,
  force: boolean,
): Promise<SetupItemResult[]> {
  const results: SetupItemResult[] = [];
  const seen = new Set<string>();

  for (const agent of agents) {
    manifest.mcp[agent.id] ??= [];
    for (const file of agent.mcpFiles()) {
      if (seen.has(file)) continue;
      seen.add(file);
      const result =
        agent.mcpStyle === "claude-cli"
          ? await installClaudeCodeMcp(workspace, force)
          : agent.mcpStyle === "codex-toml"
            ? await installCodexMcp(file, workspace, force)
            : agent.mcpStyle === "opencode"
              ? await installOpenCodeMcp(file, workspace, force)
              : await installMcpFile(file, workspace, force);
      results.push(result);
      if (result.action !== "skipped") manifest.mcp[agent.id].push(result.path);
    }
  }
  return results;
}

export async function runSetup(
  what: "skills" | "mcp" | "workflows" | "all" | "status" | "migrate",
  opts: SetupOptions = {},
): Promise<SetupResult> {
  await ensureMigrated();
  const workspace = expandPath(opts.workspace ?? homedir() + "/Studium");
  const agents = resolveAgentProfiles(opts.agent, opts.allAgents || opts.agent === "all");
  const prev = await loadManifest();
  const manifest = prev?.workspace === workspace && !opts.force
    ? { ...prev, workspace }
    : emptyManifest(workspace);

  manifest.imstudiumVersion = IMSTUDIUM_SETUP_VERSION;
  const result: SetupResult = {
    agents: agents.map((a) => a.id),
    skills: [],
    mcp: [],
    workflows: [],
    plugins: agents.map((a) => installedPlugin(a.id)).filter((p): p is PluginInstall => !!p),
    removed: [],
    manifest,
  };

  if (what === "migrate") {
    opts.force = true;
    what = "all";
  }

  if (what === "status") return result;

  const force = Boolean(opts.force);

  if (what === "skills" || what === "all") {
    result.skills = await installSkillsForAgents(agents, manifest, force, result.removed);
  }
  if (what === "workflows" || what === "all") {
    result.workflows = await installWorkflowsForAgents(agents, force, result.removed);
  }
  if (what === "mcp") { // CLI-first: `setup all` = skills only; MCP is opt-in via `setup mcp`
    result.mcp = await installMcpForAgents(agents, workspace, manifest, force);
    if (opts.project !== false) {
      result.project = [await installProjectMcp(workspace, force)];
    }
  }

  await saveManifest(manifest);
  return result;
}

export interface SetupStatusReport {
  detected: Array<{ id: string; label: string; skillsDir: string; mcpFiles: string[]; plugin: string | null }>;
  /** Harnesses with the imstudium plugin installed and enabled (their skills come from it). */
  plugins: PluginInstall[];
  configured: string[];
  manifest: SetupManifest | null;
  upToDate: boolean;
  stale: boolean;
  staleSkills: string[];
  /** Per harness (harnesses sharing a skills folder together), what setup would install or update there. */
  staleByAgent: StaleAgentSkills[];
  workspace: string;
}

export interface StaleAgentSkills {
  /** Harness ids sharing this skills folder, e.g. ["cursor"]. */
  agents: string[];
  labels: string[];
  /** Bundled skills not there at all. */
  missing: string[];
  /** Bundled skills there in another version. */
  outdated: string[];
}

async function findStaleSkills(agents: AgentProfile[]): Promise<StaleAgentSkills[]> {
  const bundled = [...(await bundledSkills("core")), ...(await bundledSkills("workflows"))];
  const out: StaleAgentSkills[] = [];
  for (const [skillsDir, group] of uniqueSkillsDirs(agents)) {
    if (pluginCovers(group)) continue; // the plugin keeps its own skills current
    const missing: string[] = [];
    const outdated: string[] = [];
    for (const skill of bundled) {
      try {
        const content = await readFile(join(skillsDir, skill.name, "SKILL.md"), "utf-8");
        if (hashContent(content) !== skill.hash) outdated.push(skill.name);
      } catch {
        missing.push(skill.name);
      }
    }
    if (missing.length || outdated.length) out.push({ agents: group.map((a) => a.id), labels: group.map((a) => a.label), missing: missing.sort(), outdated: outdated.sort() });
  }
  return out;
}

export async function getSetupStatus(workspace?: string): Promise<SetupStatusReport> {
  const ws = expandPath(workspace ?? homedir() + "/Studium");
  const manifest = await loadManifest();
  const agentProfiles = detectAgents();
  const plugins = agentProfiles.map((a) => installedPlugin(a.id)).filter((p): p is PluginInstall => !!p);
  const detected = agentProfiles.map((a) => ({
    id: a.id,
    label: a.label,
    skillsDir: a.skillsDir(),
    mcpFiles: a.mcpFiles(),
    plugin: plugins.find((p) => p.agent === a.id)?.key ?? null,
  }));
  const configured = manifest
    ? Object.keys(manifest.mcp).filter((id) => (manifest.mcp[id]?.length ?? 0) > 0)
    : [];
  const agentsToCheck =
    configured.length > 0
      ? resolveAgentProfiles("all", true).filter((a) => configured.includes(a.id))
      : agentProfiles;
  const staleByAgent = await findStaleSkills(agentsToCheck.length > 0 ? agentsToCheck : agentProfiles);
  const staleSkills = [...new Set(staleByAgent.flatMap((g) => [...g.missing, ...g.outdated]))].sort();
  const versionOk = manifest?.imstudiumVersion === IMSTUDIUM_SETUP_VERSION;
  const workspaceOk = manifest?.workspace === ws;
  const skillsOk = staleSkills.length === 0;
  // Every detected harness gets its skills from the plugin: nothing for setup to keep current.
  const allPlugin = agentProfiles.length > 0 && agentProfiles.every((a) => plugins.some((p) => p.agent === a.id));
  const upToDate = allPlugin || Boolean(manifest && versionOk && workspaceOk && skillsOk);
  const stale = !upToDate;

  return { detected, plugins, configured, manifest, upToDate, stale, staleSkills, staleByAgent, workspace: ws };
}

/** @deprecated use resolveAgentProfiles */
export function resolveAgents(agent?: AgentId | "all"): AgentId[] {
  return resolveAgentProfiles(agent, agent === "all").map((a) => a.id);
}

export function formatSetupSummary(result: SetupResult): string {
  const count = (items: SetupItemResult[]) => ({
    installed: items.filter((i) => i.action === "installed").length,
    updated: items.filter((i) => i.action === "updated").length,
    skipped: items.filter((i) => i.action === "skipped" && !i.note).length,
  });
  const s = count(result.skills);
  const m = count(result.mcp);
  const w = count(result.workflows);
  const parts = [
    `Agents: ${result.agents.join(", ") || "none"}`,
    `Skills: ${s.installed} new, ${s.updated} updated, ${s.skipped} unchanged`,
    `MCP: ${m.installed} new, ${m.updated} updated, ${m.skipped} unchanged`,
  ];
  if (result.workflows.length) {
    parts.push(`Workflows: ${w.installed + w.updated} changed, ${w.skipped} unchanged`);
  }
  if (result.plugins.length) {
    parts.push(`Plugin: ${[...new Set(result.plugins.map((p) => `${p.key} (${p.agent})`))].join(", ")} brings the skills there`);
  }
  if (result.removed.length) parts.push(`Cleaned up: ${result.removed.length} old skill folder${result.removed.length === 1 ? "" : "s"}`);
  const notes = [...result.skills, ...result.mcp, ...result.workflows].flatMap((i) => (i.note ? [i.note] : []));
  return [parts.join(" · "), ...notes].join("\n");
}
