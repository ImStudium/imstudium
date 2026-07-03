import { describe, it, expect } from "vitest";
import { MCP_TOOLS, TOOL_NAMES } from "./tools.js";

describe("MCP tool schemas", () => {
  it("has unique tool names matching TOOL_NAMES", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(TOOL_NAMES);
  });

  it("every tool has description and inputSchema", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("required tools declare required fields", () => {
    const readMat = MCP_TOOLS.find((t) => t.name === "studium_read_material")!;
    expect(readMat.inputSchema.required).toEqual(["course", "file"]);
    const courseBrief = MCP_TOOLS.find((t) => t.name === "studium_course_brief")!;
    expect(courseBrief.inputSchema.required).toEqual(["course"]);
  });

  it("studium_read_material description mandates visual inspection", () => {
    const t = MCP_TOOLS.find((x) => x.name === "studium_read_material")!;
    expect(t.description.toLowerCase()).toContain("mandatory");
    expect(t.description.toLowerCase()).toMatch(/png|visual|pageimage/);
  });
});
