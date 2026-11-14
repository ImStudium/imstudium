import { describe, expect, it } from "vitest";
import { downloadName } from "./courses.js";

// `files download <id>` without -o writes the uploader's file name into the
// current folder; that name must never reach another folder.
describe("files download target", () => {
  it("keeps an ordinary name", () => {
    expect(downloadName("Blatt 1.pdf", "id")).toBe("Blatt 1.pdf");
    expect(downloadName(".latexmkrc", "id")).toBe(".latexmkrc");
  });

  it("never writes outside the current folder", () => {
    expect(downloadName("../../.bashrc", "id")).toBe(".._.._.bashrc");
    expect(downloadName("/etc/passwd", "id")).toBe("_etc_passwd");
    expect(downloadName("..\\..\\x.ps1", "id")).toBe(".._.._x.ps1");
    expect(downloadName("..", "id")).toBe("_");
    expect(downloadName(" . ", "id")).toBe("_");
  });

  it("falls back to the file id without a name", () => {
    expect(downloadName(undefined, "abc123")).toBe("abc123");
    expect(downloadName("   ", "abc123")).toBe("abc123");
  });
});
