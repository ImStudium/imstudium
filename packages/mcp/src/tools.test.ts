import { describe, expect, it } from "vitest";
import { MCP_TOOLS, TOOL_NAMES } from "./tools.js";

/**
 * What `tools/list` answers (the server returns MCP_TOOLS verbatim). A tool
 * appearing or disappearing is an API and security decision: update the
 * snapshot on purpose (vitest -u) and note it in CHANGELOG.md.
 */
describe("MCP tools/list", () => {
  it("matches the snapshot", async () => {
    const listing = MCP_TOOLS.map((t) => ({ name: t.name, inputSchema: t.inputSchema }));
    await expect(JSON.stringify(listing, null, 2) + "\n").toMatchFileSnapshot("./__snapshots__/tools-list.json");
  });

  it("has no tool that syncs or writes (P-007)", () => {
    expect(TOOL_NAMES).not.toContain("imstudium_sync");
    expect(TOOL_NAMES).toContain("imstudium_sync_dry_run");
    expect(TOOL_NAMES).toContain("imstudium");
  });
});
