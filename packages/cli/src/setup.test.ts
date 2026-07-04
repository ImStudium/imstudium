import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { imstudiumMcpEntry, mcpEntryMatches, mergeMcpConfig } from "./setup.js";

describe("mergeMcpConfig", () => {
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
