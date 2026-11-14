import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listSkillSources, PLUGIN_DIR, PLUGIN_SKILLS_DIR, pluginDocs } from "./docs/plugin.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(ROOT, PLUGIN_DIR);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function frontmatter(path: string): Record<string, string> {
  const fm = readFileSync(path, "utf-8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  return Object.fromEntries(
    fm
      .split("\n")
      .map((l) => l.match(/^([a-z-]+):\s*(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1]!, m[2]!]),
  );
}

describe("agent plugin (plugins/imstudium)", () => {
  it("ships exactly the bundled skills — nothing stale left behind (bun run docs)", () => {
    const generated = new Set(pluginDocs().map((d) => d.path));
    const onDisk = walk(join(ROOT, PLUGIN_SKILLS_DIR))
      .map((p) => relative(ROOT, p))
      .filter((p) => !p.endsWith(".DS_Store"));
    expect(onDisk.filter((p) => !generated.has(p)), "stale files in the plugin's skills/").toEqual([]);
    expect(listSkillSources().length).toBeGreaterThanOrEqual(10);
  });

  it("every skill has a name and a description, and the name matches its folder", () => {
    for (const dir of readdirSync(join(ROOT, PLUGIN_SKILLS_DIR))) {
      const fm = frontmatter(join(ROOT, PLUGIN_SKILLS_DIR, dir, "SKILL.md"));
      expect(fm.name, dir).toBe(dir);
      expect(fm.description, dir).toBeTruthy();
    }
  });

  it("commands and agents carry frontmatter with a description", () => {
    const files = [...walk(join(PLUGIN, "commands")), ...walk(join(PLUGIN, "agents"))];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(frontmatter(file).description, relative(PLUGIN, file)).toBeTruthy();
  });

  it("the Claude Code and Codex manifests share name and version with the CLI", () => {
    const cli = JSON.parse(readFileSync(join(ROOT, "packages/cli/package.json"), "utf-8"));
    for (const manifest of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
      const m = JSON.parse(readFileSync(join(PLUGIN, manifest), "utf-8"));
      expect(m.name, manifest).toBe("imstudium");
      expect(m.version, manifest).toBe(cli.version);
    }
  });

  it("the MCP launcher is a bare executable name (Codex rejects anything else)", () => {
    const mcp = JSON.parse(readFileSync(join(PLUGIN, ".mcp.json"), "utf-8"));
    for (const server of Object.values(mcp.mcpServers) as Array<{ command: string }>) {
      expect(server.command).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("hooks.json points at scripts that exist", () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, "hooks/hooks.json"), "utf-8"));
    const commands = Object.values(hooks.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)
      .flat()
      .flatMap((m) => m.hooks.map((h) => h.command));
    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of commands) {
      const script = cmd.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/)?.[1];
      expect(script, cmd).toBeTruthy();
      expect(existsSync(join(PLUGIN, script!)), script).toBe(true);
    }
  });

  it("the SessionStart hook stays silent outside a study workspace", () => {
    const cwd = mkdtempSync(join(tmpdir(), "imstudium-hook-"));
    const out = execFileSync(process.execPath, [join(PLUGIN, "hooks/session-start.mjs")], {
      input: JSON.stringify({ cwd, hook_event_name: "SessionStart" }),
      env: { ...process.env, PATH: "" }, // no imstudium on PATH either
    });
    expect(String(out)).toBe("");
  });
});
