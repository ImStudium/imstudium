import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  AGENT_REGISTRY,
  detectAgents,
  getAgent,
  hashContent,
  resolveAgentProfiles,
  uniqueSkillsDirs,
} from "./agents.js";

describe("detectAgents", () => {
  it("returns all agents when all=true", () => {
    const agents = detectAgents(true);
    assert.equal(agents.length, AGENT_REGISTRY.length);
    assert.deepEqual(
      agents.map((a) => a.id),
      ["cursor", "claude-code", "claude-desktop", "codex", "windsurf", "opencode"],
    );
  });

  it("falls back to cursor when nothing detected", () => {
    const keys = ["CURSOR_TRACE_ID", "CURSOR_AGENT", "CLAUDE_CODE", "CODEX_HOME"] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) delete process.env[k];
      const agents = detectAgents(false);
      if (agents.length === 1) {
        assert.equal(agents[0]!.id, "cursor");
      } else {
        assert.ok(agents.length >= 1);
      }
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});

describe("resolveAgentProfiles", () => {
  it("returns a single agent by id", () => {
    const agents = resolveAgentProfiles("windsurf");
    assert.equal(agents.length, 1);
    assert.equal(agents[0]!.id, "windsurf");
    assert.ok(agents[0]!.skillsDir().includes("windsurf"));
  });

  it("returns all agents when agent=all", () => {
    const agents = resolveAgentProfiles("all");
    assert.equal(agents.length, AGENT_REGISTRY.length);
  });

  it("returns all agents when allAgents=true", () => {
    const agents = resolveAgentProfiles(undefined, true);
    assert.equal(agents.length, AGENT_REGISTRY.length);
  });
});

describe("uniqueSkillsDirs", () => {
  it("deduplicates Claude Code and Claude Desktop skills dirs", () => {
    const claudeCode = getAgent("claude-code")!;
    const claudeDesktop = getAgent("claude-desktop")!;
    const map = uniqueSkillsDirs([claudeCode, claudeDesktop]);
    assert.equal(map.size, 1);
    assert.equal(map.get(claudeCode.skillsDir())!.length, 2);
  });

  it("keeps separate dirs for cursor and codex", () => {
    const agents = resolveAgentProfiles("all", true).filter((a) =>
      ["cursor", "codex"].includes(a.id),
    );
    const map = uniqueSkillsDirs(agents);
    assert.equal(map.size, 2);
  });
});

describe("hashContent", () => {
  it("returns stable 16-char hex prefix", () => {
    const a = hashContent("hello");
    const b = hashContent("hello");
    assert.equal(a, b);
    assert.equal(a.length, 16);
  });

  it("differs for different content", () => {
    assert.notEqual(hashContent("a"), hashContent("b"));
  });
});

describe("Claude Desktop MCP path", () => {
  it("uses platform-specific config path", () => {
    const agent = getAgent("claude-desktop")!;
    const files = agent.mcpFiles();
    assert.equal(files.length, 1);
    assert.ok(files[0]!.includes("claude_desktop_config.json"));
  });
});
