import { describe, it, expect } from "vitest";
import { TOOL_NAMES } from "./tools.js";

describe("MCP tools", () => {
  it("exposes the Studium + sync tool surface", () => {
    expect(TOOL_NAMES).toEqual([
      "studium_overview",
      "studium_klausuren",
      "studium_course_brief",
      "studium_find_materials",
      "studium_read_material",
      "digicampus_sync",
      "digicampus_sync_dry_run",
      "digicampus_list_courses",
      "digicampus_whoami",
    ]);
  });
});
