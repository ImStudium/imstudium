import { describe, expect, it } from "vitest";
import { checkArgs } from "./cli-bridge.js";

describe("MCP CLI door", () => {
  it("lets read-only commands through", () => {
    expect(checkArgs(["context"])).toBeNull();
    expect(checkArgs(["api", "/users/me/courses", "--flat"])).toBeNull();
    expect(checkArgs(["search", "Erwartungswert", "--archive"])).toBeNull();
  });

  it("refuses writes, logins and unknown commands", () => {
    expect(checkArgs(["api", "/messages", "-X", "POST", "--write"])).toMatch(/not allowed/);
    expect(checkArgs(["news", "--save"])).toMatch(/not allowed/);
    expect(checkArgs(["login"])).toMatch(/Not available/);
    expect(checkArgs(["semester", "start"])).toMatch(/terminal/);
    expect(checkArgs(["sync"])).toMatch(/Not available/);
    expect(checkArgs([])).toMatch(/Not available/);
  });
});
