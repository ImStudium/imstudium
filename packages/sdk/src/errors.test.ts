import { describe, it, expect } from "vitest";
import { parseApiErrors, DigicampusError, readResponseError } from "./errors.js";

describe("DigicampusError", () => {
  it("serializes to JSON for agents", () => {
    const err = new DigicampusError("Not logged in", "UNAUTHORIZED", 401, "Run digicampus login");
    expect(err.toJSON()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Not logged in",
        hint: "Run digicampus login",
        status: 401,
      },
    });
  });

  it("parses JSON:API errors", () => {
    const err = parseApiErrors({ errors: [{ status: "403", detail: "Forbidden" }] });
    expect(err.status).toBe(403);
    expect(err.message).toBe("Forbidden");
  });

  it("falls back when errors array empty", () => {
    const err = parseApiErrors({ errors: [] });
    expect(err.message).toBe("Unknown API error");
  });
});

describe("readResponseError", () => {
  it("parses JSON error body", async () => {
    const res = new Response(
      JSON.stringify({ errors: [{ status: "401", detail: "Auth required" }] }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
    const err = await readResponseError(res);
    expect(err.status).toBe(401);
    expect(err.hint).toContain("login");
  });

  it("handles non-json response", async () => {
    const res = new Response("Gateway Timeout", { status: 504, statusText: "Gateway Timeout" });
    const err = await readResponseError(res);
    expect(err.code).toBe("HTTP_ERROR");
    expect(err.status).toBe(504);
  });
});
