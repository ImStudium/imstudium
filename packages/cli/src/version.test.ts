import { describe, expect, it } from "vitest";
import { semverLt } from "./version.js";

describe("semverLt", () => {
  it("detects older version", () => {
    expect(semverLt("0.1.0", "0.2.0")).toBe(true);
    expect(semverLt("0.1.9", "0.1.10")).toBe(true);
  });

  it("detects same or newer", () => {
    expect(semverLt("0.2.0", "0.1.0")).toBe(false);
    expect(semverLt("0.1.0", "0.1.0")).toBe(false);
  });
});
