import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "./sync.js";

describe("sanitizeFilename", () => {
  it("replaces illegal path characters", () => {
    expect(sanitizeFilename('lecture:01/slides.pdf')).toBe("lecture_01_slides.pdf");
  });

  it("falls back to file for empty names", () => {
    expect(sanitizeFilename("   ")).toBe("file");
  });
});
