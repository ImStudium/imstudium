import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { materialVisualPayload } from "./visual.js";

describe("materialVisualPayload", () => {
  it("returns mandatory action when page images exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-vis-"));
    const pages = join(dir, "pages");
    mkdirSync(pages);
    writeFileSync(join(pages, "page-1.png"), "fake");

    const payload = await materialVisualPayload(dir, "Test Slides");
    expect(payload.pageImages).toHaveLength(1);
    expect(payload.viewerHtml).toBeDefined();
    expect(payload.requiredAction).toContain("MANDATORY");
    expect(payload.methods.some((m) => m.id === "read_image")).toBe(true);
    expect(payload.methods.some((m) => m.id === "playwright")).toBe(true);
  });

  it("handles empty extraction dir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-vis-empty-"));
    const payload = await materialVisualPayload(dir, "Empty");
    expect(payload.pageImages).toHaveLength(0);
    expect(payload.viewerHtml).toBeUndefined();
    expect(payload.requiredAction).toContain("No page images");
  });
});
