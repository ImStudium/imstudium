import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { getCliVersion } from "./version.js";

export type AgentId =
  | "cursor"
  | "claude-code"
  | "claude-desktop"
  | "codex"
  | "windsurf"
  | "opencode";

export interface AgentProfile {
  id: AgentId;
  label: string;
  detect: () => boolean;
  skillsDir: () => string;
  mcpFiles: () => string[];
}

function claudeDesktopConfigPath(): string {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform() === "win32") {
    return join(process.env.APPDATA || homedir(), "Claude", "claude_desktop_config.json");
  }
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

/** Native paths per harness — Cursor, Claude Code, Claude Desktop/Cowork, Codex, Windsurf, OpenCode. */
export const AGENT_REGISTRY: AgentProfile[] = [
  {
    id: "cursor",
    label: "Cursor",
    detect: () =>
      existsSync(join(homedir(), ".cursor")) ||
      Boolean(process.env.CURSOR_TRACE_ID || process.env.CURSOR_AGENT),
    skillsDir: () => join(homedir(), ".cursor", "skills"),
    mcpFiles: () => [join(homedir(), ".cursor", "mcp.json")],
  },
  {
    id: "claude-code",
    label: "Claude Code",
    detect: () =>
      existsSync(join(homedir(), ".claude")) || Boolean(process.env.CLAUDE_CODE),
    skillsDir: () => join(homedir(), ".claude", "skills"),
    mcpFiles: () => [join(homedir(), ".claude", "mcp.json")],
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop / Cowork",
    detect: () => {
      const cfg = claudeDesktopConfigPath();
      const dir = join(cfg, "..");
      return existsSync(cfg) || existsSync(dir);
    },
    skillsDir: () => join(homedir(), ".claude", "skills"),
    mcpFiles: () => [claudeDesktopConfigPath()],
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    detect: () => existsSync(join(homedir(), ".codex")) || Boolean(process.env.CODEX_HOME),
    skillsDir: () => join(homedir(), ".codex", "skills"),
    mcpFiles: () => [join(homedir(), ".codex", "mcp.json")],
  },
  {
    id: "windsurf",
    label: "Windsurf",
    detect: () => existsSync(join(homedir(), ".codeium", "windsurf")),
    skillsDir: () => join(homedir(), ".codeium", "windsurf", "skills"),
    mcpFiles: () => [join(homedir(), ".codeium", "windsurf", "mcp.json")],
  },
  {
    id: "opencode",
    label: "OpenCode",
    detect: () =>
      existsSync(join(homedir(), ".config", "opencode")) ||
      existsSync(join(homedir(), ".opencode")),
    skillsDir: () => join(homedir(), ".config", "opencode", "skills"),
    mcpFiles: () => [join(homedir(), ".config", "opencode", "mcp.json")],
  },
];

export function detectAgents(all = false): AgentProfile[] {
  if (all) return [...AGENT_REGISTRY];
  const detected = AGENT_REGISTRY.filter((a) => a.detect());
  return detected.length > 0 ? detected : [AGENT_REGISTRY[0]]; // cursor fallback
}

export function getAgent(id: AgentId): AgentProfile | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id);
}

export function resolveAgentProfiles(
  agent?: AgentId | "all",
  allAgents = false,
): AgentProfile[] {
  if (agent && agent !== "all") {
    const one = getAgent(agent);
    return one ? [one] : [];
  }
  return detectAgents(allAgents || agent === "all");
}

/** Deduplicate agents that share the same skills directory (Claude Code + Desktop). */
export function uniqueSkillsDirs(agents: AgentProfile[]): Map<string, AgentProfile[]> {
  const map = new Map<string, AgentProfile[]>();
  for (const a of agents) {
    const dir = a.skillsDir();
    const list = map.get(dir) ?? [];
    list.push(a);
    map.set(dir, list);
  }
  return map;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export const SETUP_MANIFEST_VERSION = "1";
export const IMSTUDIUM_SETUP_VERSION = getCliVersion();

export interface SetupManifest {
  schemaVersion: typeof SETUP_MANIFEST_VERSION;
  imstudiumVersion: string;
  workspace: string;
  skills: Record<string, Record<string, string>>;
  mcp: Record<string, string[]>;
  updatedAt: string;
}

export function emptyManifest(workspace: string): SetupManifest {
  return {
    schemaVersion: SETUP_MANIFEST_VERSION,
    imstudiumVersion: IMSTUDIUM_SETUP_VERSION,
    workspace,
    skills: {},
    mcp: {},
    updatedAt: new Date().toISOString(),
  };
}
