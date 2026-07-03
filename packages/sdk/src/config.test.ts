import { describe, it, expect } from "vitest";
import { slugify } from "./config.js";

describe("slugify", () => {
  it("converts course titles to slugs", () => {
    expect(slugify("Analysis II")).toBe("Analysis-II");
    expect(slugify("Lineare Algebra 1")).toBe("Lineare-Algebra-1");
  });
});
