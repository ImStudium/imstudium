import { describe, expect, it } from "vitest";
import {
  buildShibbolethLoginUrl,
  parseSeminarSessionCookie,
} from "./login-url.js";

describe("login-url", () => {
  it("builds Shibboleth login URL", () => {
    const url = buildShibbolethLoginUrl("https://digicampus.uni-augsburg.de");
    expect(url).toContain("Shibboleth.sso/Login");
    expect(url).toContain(encodeURIComponent("my_courses"));
  });

  it("parses raw Seminar_Session value", () => {
    expect(parseSeminarSessionCookie("abc123")).toBe("abc123");
  });

  it("parses Seminar_Session= prefix", () => {
    expect(parseSeminarSessionCookie("Seminar_Session=abc123")).toBe("abc123");
  });

  it("strips quotes", () => {
    expect(parseSeminarSessionCookie('"abc123"')).toBe("abc123");
  });
});
