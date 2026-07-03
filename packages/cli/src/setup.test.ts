import { describe, it, expect } from "vitest";
import { mergeMcpConfig } from "./setup.js";

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
});
