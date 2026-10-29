import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { imstudiumMcpEntry, mcpEntryMatches, mergeMcpConfig } from "./setup.js";

describe("mergeMcpConfig", () => {
  beforeEach(() => {
    process.env.IMSTUDIUM_MCP_LAUNCH = "npx";
  });

  afterEach(() => {
    delete process.env.IMSTUDIUM_MCP_LAUNCH;
  });
  it("removes legacy digicampus MCP server", () => {
    const merged = mergeMcpConfig(
      {
        mcpServers: {
          digicampus: {
            command: "npx",
            args: ["-y", "digicampus-mcp"],
            env: { DIGICAMPUS_WORKSPACE: "/old" },
          },
          other: { command: "echo", args: ["hi"] },
        },
      },
      "~/Studium",
    ) as { mcpServers: Record<string, unknown> };

    assert.equal(merged.mcpServers.digicampus, undefined);
    assert.ok(merged.mcpServers.other);
    assert.ok(merged.mcpServers.imstudium);
  });

  it("adds imstudium server without removing existing servers", () => {
    const merged = mergeMcpConfig(
      {
        mcpServers: {
          other: { command: "echo", args: ["hi"] },
        },
      },
      "~/Studium",
    ) as { mcpServers: Record<string, unknown> };

    assert.ok(merged.mcpServers.other);
    assert.ok(merged.mcpServers.imstudium);
    const entry = merged.mcpServers.imstudium as {
      command: string;
      args: string[];
      env: { IMSTUDIUM_WORKSPACE: string };
    };
    assert.equal(entry.command, "npx");
    assert.deepEqual(entry.args, ["-y", "@imstudium/mcp"]);
    assert.ok(entry.env.IMSTUDIUM_WORKSPACE.includes("Studium"));
  });

  it("overwrites imstudium entry with new workspace", () => {
    const merged = mergeMcpConfig(
      {
        mcpServers: {
          imstudium: {
            command: "npx",
            args: ["-y", "@imstudium/mcp"],
            env: { IMSTUDIUM_WORKSPACE: "/old" },
          },
        },
      },
      "/new/workspace",
    ) as { mcpServers: Record<string, { env: { IMSTUDIUM_WORKSPACE: string } }> };

    assert.equal(merged.mcpServers.imstudium.env.IMSTUDIUM_WORKSPACE, "/new/workspace");
  });
});

describe("mcpEntryMatches", () => {
  beforeEach(() => {
    process.env.IMSTUDIUM_MCP_LAUNCH = "npx";
  });

  afterEach(() => {
    delete process.env.IMSTUDIUM_MCP_LAUNCH;
  });

  it("matches identical entries regardless of key order", () => {
    const desired = imstudiumMcpEntry("~/Studium");
    const d = desired as { command: string; args: string[]; env: Record<string, string> };
    const existing = {
      command: "npx",
      args: ["-y", "@imstudium/mcp"],
      env: d.env,
    };
    assert.equal(mcpEntryMatches(existing, desired), true);
  });

  it("rejects missing or different entries", () => {
    const desired = imstudiumMcpEntry("~/Studium");
    assert.equal(mcpEntryMatches(undefined, desired), false);
    assert.equal(
      mcpEntryMatches({ command: "node", args: ["other.js"] }, desired),
      false,
    );
  });
});

describe("upsertCodexToml", () => {
  it("appends one imstudium table and replaces it in place later", async () => {
    const { upsertCodexToml } = await import("./setup.js");
    const base = 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n';
    const once = upsertCodexToml(base, "/tmp/Studium");
    expect(once).toContain("[mcp_servers.imstudium]");
    expect(once).toContain('IMSTUDIUM_WORKSPACE = "/tmp/Studium"');
    expect(once.startsWith(base.trimEnd())).toBe(true);
    const twice = upsertCodexToml(once, "/tmp/Other");
    expect(twice.match(/\[mcp_servers\.imstudium\]/g)).toHaveLength(1);
    expect(twice).toContain('IMSTUDIUM_WORKSPACE = "/tmp/Other"');
    expect(twice).toContain("[mcp_servers.other]");
  });

  it("keeps tables that follow the imstudium table", async () => {
    const { upsertCodexToml } = await import("./setup.js");
    const base = '[mcp_servers.imstudium]\ncommand = "old"\n\n[profiles.fast]\nmodel = "x"\n';
    const out = upsertCodexToml(base, "/tmp/S");
    expect(out).toContain("[profiles.fast]");
    expect(out).not.toContain('"old"');
  });
});
