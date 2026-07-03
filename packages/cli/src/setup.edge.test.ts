import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { emptyManifest } from "./agents.js";
import {
  digicampusMcpEntry,
  formatSetupSummary,
  installMcpFile,
  installSkillIfChanged,
  mergeMcpConfig,
  mcpEntryMatches,
  type SetupResult,
} from "./setup.js";

describe("mergeMcpConfig edge cases", () => {
  it("expands ~/ workspace in env", () => {
    const merged = mergeMcpConfig({}, "~/Studium") as {
      mcpServers: { digicampus: { env: Record<string, string> } };
    };
    expect(merged.mcpServers.digicampus.env.DIGICAMPUS_WORKSPACE).not.toContain("~");
  });

  it("preserves unrelated top-level keys", () => {
    const merged = mergeMcpConfig({ foo: "bar", mcpServers: {} }, "/tmp/ws") as Record<string, unknown>;
    expect(merged.foo).toBe("bar");
  });

  it("updates digicampus entry when workspace changes", () => {
    const a = digicampusMcpEntry("/tmp/a");
    const b = digicampusMcpEntry("/tmp/b");
    expect(mcpEntryMatches(a, b)).toBe(false);
  });

  it("installMcpFile updates when workspace path changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-mcp-ws-"));
    const file = join(dir, "mcp.json");
    await installMcpFile(file, "/tmp/ws-a", false);
    const updated = await installMcpFile(file, "/tmp/ws-b", false);
    expect(updated.action).toBe("updated");
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    expect(parsed.mcpServers.digicampus.env.DIGICAMPUS_WORKSPACE).toBe("/tmp/ws-b");
  });
});

describe("installMcpFile idempotency", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dc-mcp-"));
  });

  it("installs then skips on second run", async () => {
    const file = join(dir, "mcp.json");
    const first = await installMcpFile(file, dir, false);
    const second = await installMcpFile(file, dir, false);
    expect(first.action).toBe("installed");
    expect(second.action).toBe("skipped");
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    expect(parsed.mcpServers.github).toBeUndefined();
    expect(parsed.mcpServers.digicampus.command).toBe("npx");
  });

  it("merges without removing existing servers", async () => {
    const file = join(dir, "mcp.json");
    writeFileSync(
      file,
      JSON.stringify({ mcpServers: { other: { command: "echo" } } }, null, 2),
    );
    await installMcpFile(file, dir, false);
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    expect(parsed.mcpServers.other.command).toBe("echo");
    expect(parsed.mcpServers.digicampus).toBeDefined();
  });

  it("force rewrites identical config", async () => {
    const file = join(dir, "mcp.json");
    await installMcpFile(file, dir, false);
    const second = await installMcpFile(file, dir, true);
    expect(second.action).toBe("updated");
  });
});

describe("installSkillIfChanged", () => {
  it("installs, skips, then updates on content change", async () => {
    const root = mkdtempSync(join(tmpdir(), "dc-skill-"));
    const src = join(root, "skill-a");
    const dest = join(root, "dest", "skill-a");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "SKILL.md"), "version 1");

    const first = await installSkillIfChanged(src, dest, false);
    expect(first.action).toBe("installed");

    const second = await installSkillIfChanged(src, dest, false);
    expect(second.action).toBe("skipped");

    writeFileSync(join(src, "SKILL.md"), "version 2");
    const third = await installSkillIfChanged(src, dest, false);
    expect(third.action).toBe("updated");
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toBe("version 2");
  });
});

describe("formatSetupSummary", () => {
  it("handles empty and mixed actions", () => {
    const result: SetupResult = {
      agents: ["cursor"],
      skills: [
        { action: "installed", path: "/a" },
        { action: "skipped", path: "/b" },
      ],
      mcp: [{ action: "skipped", path: "/mcp" }],
      workflows: [],
      manifest: emptyManifest("/tmp"),
    };
    const summary = formatSetupSummary(result);
    expect(summary).toContain("cursor");
    expect(summary).toContain("1 new");
    expect(summary).toContain("1 unchanged");
  });
});
