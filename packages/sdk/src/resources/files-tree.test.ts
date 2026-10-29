import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildFileTree, folderPaths, formatFileTree, type FileRefResource, type FolderResource } from "./files.js";
import { fileRef, folder, hid } from "../test/content-fixtures.js";

const ROOT = hid("froot");
const LECT = hid("flect");
const EX = hid("fex");

const folders = [
  folder(ROOT, "", null, "RootFolder"),
  folder(LECT, "Lectures", ROOT),
  folder(EX, "Exercises/2026", LECT),
] as FolderResource[];
const refs = [
  fileRef(hid("f1"), "syllabus.pdf", 1000, true, ROOT),
  fileRef(hid("f2"), "01-intro.pdf", 2_000_000, true, LECT),
  fileRef(hid("f3"), "sheet1.pdf", 30_000, true, EX),
] as FileRefResource[];

describe("file tree", () => {
  it("maps the course root folder to the files/ root (layout: tree)", () => {
    const paths = folderPaths(folders);
    assert.equal(paths.get(ROOT), "");
    assert.equal(paths.get(LECT), "Lectures");
    assert.equal(paths.get(EX), "Lectures/Exercises_2026");
  });

  it("nests folders before files with recursive sizes and counts", () => {
    const [root] = buildFileTree(folders, refs);
    assert.equal(root!.fileCount, 3);
    assert.equal(root!.size, 2_031_000);
    assert.deepEqual(root!.children!.map((c) => c.name), ["Lectures", "syllabus.pdf"]);
    const lectures = root!.children![0]!;
    assert.deepEqual(lectures.children!.map((c) => c.path), ["Lectures/Exercises_2026", "Lectures/01-intro.pdf"]);
  });

  it("prints an aligned tree with sizes and dates", () => {
    const lines = formatFileTree(buildFileTree(folders, refs));
    assert.equal(lines.length, 6);
    assert.match(lines[0]!, /^\/\s+3 files · 1\.9 MB\s+2026-10-01$/);
    assert.match(lines[1]!, /^├── Lectures\/\s+2 files · 1\.9 MB/);
    assert.match(lines[2]!, /^│   ├── Exercises\/2026\/\s+1 file · 29 KB/);
    assert.match(lines[3]!, /^│   │   └── sheet1\.pdf\s+29 KB/);
    assert.match(lines[4]!, /^│   └── 01-intro\.pdf\s+1\.9 MB/);
    assert.match(lines[5]!, /^└── syllabus\.pdf\s+1000 B\s+2026-10-04$/);
  });
});
