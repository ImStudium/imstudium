import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { buildAgentVisualPayload, buildSlideViewer } from "./viewer.js";

describe("buildSlideViewer", () => {
  it("writes viewer.html with relative page images", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-view-"));
    const pages = join(dir, "pages");
    mkdirSync(pages);
    writeFileSync(join(pages, "page-1.png"), "x");
    writeFileSync(join(pages, "page-2.png"), "y");

    const { viewerHtml, pageImages } = await buildSlideViewer(dir, "Vorlesung 3");

    expect(pageImages).toHaveLength(2);
    expect(viewerHtml).toContain(join(dir, "viewer.html"));
    const html = await import("node:fs/promises").then((fs) => fs.readFile(viewerHtml, "utf-8"));
    expect(html).toContain('src="pages/page-1.png"');
    expect(html).toContain("Vorlesung 3");
    expect(html).toContain("Playwright");
  });
});

describe("buildAgentVisualPayload", () => {
  it("requires image reading and lists playwright fallback", () => {
    const payload = buildAgentVisualPayload(
      ["/tmp/slide/page-1.png"],
      "/tmp/slide/viewer.html",
    );
    expect(payload.requiredAction).toContain("MANDATORY");
    expect(payload.viewerFileUrl).toBe("file:///tmp/slide/viewer.html");
    expect(payload.methods.some((m) => m.id === "read_image")).toBe(true);
    expect(payload.methods.some((m) => m.id === "playwright")).toBe(true);
  });
});
