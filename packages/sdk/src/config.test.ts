import { describe, it, expect } from "vitest";
import { slugify, expandPath } from "./config.js";
import { homedir } from "node:os";
import { join } from "node:path";

describe("slugify", () => {
  it("converts course titles to slugs", () => {
    expect(slugify("Analysis II")).toBe("Analysis-II");
    expect(slugify("Lineare Algebra 1")).toBe("Lineare-Algebra-1");
  });

  it("handles umlauts and empty input", () => {
    expect(slugify("Übungen für Analysis")).toBe("Ubungen-fur-Analysis");
    expect(slugify("   ")).toBe("course");
  });
});

describe("expandPath", () => {
  it("expands ~ and ~/ paths", () => {
    expect(expandPath("~")).toBe(homedir());
    expect(expandPath("~/Studium")).toBe(join(homedir(), "Studium"));
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandPath("/tmp/foo")).toBe("/tmp/foo");
  });
});
