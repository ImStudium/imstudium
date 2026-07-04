import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { digicampusMcpEntry, mcpEntryMatches, mergeMcpConfig } from "./setup.js";

describe("mergeMcpConfig", () => {
  it("adds digicampus server without removing existing servers", () => {
    const merged = mergeMcpConfig(
      {
        mcpServers: {
          other: { command: "echo", args: ["hi"] },
        },
      },
      "~/Studium",
    ) as { mcpServers: Record<string, unknown> };

    assert.ok(merged.mcpServers.other);
    assert.ok(merged.mcpServers.digicampus);
    const entry = merged.mcpServers.digicampus as {
      command: string;
      args: string[];
      env: { DIGICAMPUS_WORKSPACE: string };
    };
    assert.equal(entry.command, "npx");
    assert.deepEqual(entry.args, ["-y", "digicampus-mcp"]);
    assert.ok(entry.env.DIGICAMPUS_WORKSPACE.includes("Studium"));
  });

  it("overwrites digicampus entry with new workspace", () => {
    const merged = mergeMcpConfig(
      {
        mcpServers: {
          digicampus: {
            command: "npx",
            args: ["-y", "digicampus-mcp"],
            env: { DIGICAMPUS_WORKSPACE: "/old" },
          },
        },
      },
      "/new/workspace",
    ) as { mcpServers: Record<string, { env: { DIGICAMPUS_WORKSPACE: string } }> };

    assert.equal(merged.mcpServers.digicampus.env.DIGICAMPUS_WORKSPACE, "/new/workspace");
  });
});

describe("mcpEntryMatches", () => {
  it("matches identical entries regardless of key order", () => {
    const desired = digicampusMcpEntry("~/Studium");
    const d = desired as { command: string; args: string[]; env: Record<string, string> };
    const existing = {
      command: "npx",
      args: ["-y", "digicampus-mcp"],
      env: d.env,
    };
    assert.equal(mcpEntryMatches(existing, desired), true);
  });

  it("rejects missing or different entries", () => {
    const desired = digicampusMcpEntry("~/Studium");
    assert.equal(mcpEntryMatches(undefined, desired), false);
    assert.equal(
      mcpEntryMatches({ command: "node", args: ["other.js"] }, desired),
      false,
    );
  });
});
