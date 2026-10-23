import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "vitest";
import { isInside, sanitizeFilename } from "./sync.js";
import { folderPaths, type FolderResource } from "./resources/files.js";
import { folder, hid } from "./test/content-fixtures.js";

// Folder and file names come from whoever may create them in a course.
// layout "tree" (the pipeline's default) turns folder names into path
// segments; none of them may lead out of the course folder.
describe("sync paths from Stud.IP names", () => {
  it("a file called . or .. is a name, not a path", () => {
    assert.equal(sanitizeFilename(".."), "_");
    assert.equal(sanitizeFilename(" . "), "_");
    assert.equal(sanitizeFilename("..."), "_");
    assert.equal(sanitizeFilename("../../.bashrc"), ".._.._.bashrc");
    assert.equal(sanitizeFilename(".latexmkrc"), ".latexmkrc");
    assert.equal(sanitizeFilename("Blatt 1.pdf"), "Blatt 1.pdf");
    assert.equal(sanitizeFilename(""), "file");
  });

  it("isInside accepts children only", () => {
    const dir = join("/tmp", "ws", "WS2026-27", "statistik");
    assert.equal(isInside(dir, join(dir, "files", "a.pdf")), true);
    assert.equal(isInside(dir, join(dir, "files", "..notes", "a.pdf")), true);
    assert.equal(isInside(dir, dir), false);
    assert.equal(isInside(dir, join(dir, "files", "..", "..", "x")), false);
    assert.equal(isInside(dir, join(dir, "..", "statistik-2", "x")), false);
    assert.equal(isInside(dir, "/home/student/.ssh/authorized_keys"), false);
  });

  it("nested folders called .. stay inside the course folder", () => {
    const root = hid("root");
    const a = hid("up-a");
    const b = hid("up-b");
    const c = hid("up-c");
    const ssh = hid("ssh");
    const paths = folderPaths([
      folder(root, "", null, "RootFolder"),
      folder(a, "..", root),
      folder(b, "..", a),
      folder(c, "..", b),
      folder(ssh, ".ssh", c),
    ] as FolderResource[]);
    const courseDir = join("/tmp", "ws", "WS2026-27", "statistik");
    const dest = join(courseDir, "files", paths.get(ssh)!, sanitizeFilename("authorized_keys"));
    assert.equal(isInside(courseDir, dest), true, dest);
  });
});
