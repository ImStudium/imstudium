import { describe, it, expect } from "vitest";
import { AGENT_REGISTRY, DIGICAMPUS_SETUP_VERSION } from "./agents.js";

describe("AGENT_REGISTRY", () => {
  it("has unique ids and non-empty labels", () => {
    const ids = AGENT_REGISTRY.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const agent of AGENT_REGISTRY) {
      expect(agent.label.length).toBeGreaterThan(2);
      expect(agent.skillsDir()).toContain("skills");
      expect(agent.mcpFiles().length).toBeGreaterThan(0);
    }
  });

  it("claude-code and claude-desktop share skills dir", () => {
    const code = AGENT_REGISTRY.find((a) => a.id === "claude-code")!;
    const desktop = AGENT_REGISTRY.find((a) => a.id === "claude-desktop")!;
    expect(code.skillsDir()).toBe(desktop.skillsDir());
  });

  it("setup version is semver-like", () => {
    expect(DIGICAMPUS_SETUP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
