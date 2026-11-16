import { describe, expect, it } from "vitest";
import { MCP_TOOLS, TOOL_NAMES, validateToolArgs } from "./tools.js";

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

  it("checks every call against the tool's inputSchema before it runs", () => {
    expect(validateToolArgs("imstudium", { args: ["today"] })).toBeNull();
    expect(validateToolArgs("imstudium", { args: "today" })).toMatch(/"args" must be an array of strings/);
    expect(validateToolArgs("imstudium", {})).toMatch(/needs "args"/);
    expect(validateToolArgs("imstudium_sync_dry_run", { course: 123 })).toMatch(/"course" must be a string/);
    expect(validateToolArgs("imstudium_sync_dry_run", undefined)).toBeNull();
    expect(validateToolArgs("studium_read_material", { course: "stat", file: "blatt", page: 3 })).toBeNull();
    for (const file of ["", "  ", null, []]) expect(validateToolArgs("studium_read_material", { course: "stat", file }), JSON.stringify(file)).not.toBeNull();
    for (const page of [0, -1, 1.5, "abc"]) expect(validateToolArgs("studium_read_material", { course: "stat", file: "blatt", page }), JSON.stringify(page)).not.toBeNull();
  });

  it("has no tool that syncs or writes (P-007)", () => {
    expect(TOOL_NAMES).not.toContain("imstudium_sync");
    expect(TOOL_NAMES).toContain("imstudium_sync_dry_run");
    expect(TOOL_NAMES).toContain("imstudium");
  });
});
