import { describe, it, expect } from "vitest";
import {
  AGENT_REGISTRY,
  detectAgents,
  hashContent,
  resolveAgentProfiles,
  uniqueSkillsDirs,
} from "./agents.js";
import { digicampusMcpEntry, mergeMcpConfig, mcpEntryMatches } from "./setup.js";

describe("detectAgents", () => {
  it("returns cursor fallback when nothing detected", () => {
    const all = detectAgents(true);
    expect(all.length).toBe(AGENT_REGISTRY.length);
    expect(all.some((a) => a.id === "cursor")).toBe(true);
    expect(all.some((a) => a.id === "claude-code")).toBe(true);
    expect(all.some((a) => a.id === "codex")).toBe(true);
  });

  it("resolves single agent by id", () => {
    const profiles = resolveAgentProfiles("codex", false);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe("codex");
  });
});

describe("uniqueSkillsDirs", () => {
  it("deduplicates claude-code and claude-desktop skills dir", () => {
    const claudeCode = AGENT_REGISTRY.find((a) => a.id === "claude-code")!;
    const claudeDesktop = AGENT_REGISTRY.find((a) => a.id === "claude-desktop")!;
    const map = uniqueSkillsDirs([claudeCode, claudeDesktop]);
    expect(map.size).toBe(1);
    expect(map.get(claudeCode.skillsDir())?.length).toBe(2);
  });
});

describe("hashContent", () => {
  it("is stable", () => {
    expect(hashContent("a")).toBe(hashContent("a"));
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });
});

describe("mergeMcpConfig", () => {
  it("adds digicampus server without removing others", () => {
    const merged = mergeMcpConfig(
      { mcpServers: { github: { command: "gh" } } },
      "~/Studium",
    ) as { mcpServers: Record<string, unknown> };

    expect(merged.mcpServers.github).toEqual({ command: "gh" });
    expect(merged.mcpServers.digicampus).toMatchObject({
      command: "npx",
      args: ["-y", "digicampus-mcp"],
    });
  });

  it("detects identical mcp entries for skip", () => {
    const desired = digicampusMcpEntry("~/Studium");
    expect(mcpEntryMatches(desired, desired)).toBe(true);
    expect(mcpEntryMatches({ command: "other" }, desired)).toBe(false);
  });
});
