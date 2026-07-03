import { describe, expect, it } from "vitest";
import {
  buildLoginHelperHtml,
  parseFormBody,
} from "./login-helper.js";
import { parseSeminarSessionCookie } from "./login-url.js";

describe("login-helper", () => {
  it("renders login helper with host and login link", () => {
    const html = buildLoginHelperHtml({
      origin: "https://digicampus.uni-augsburg.de",
      loginUrl: "https://digicampus.uni-augsburg.de/Shibboleth.sso/Login",
    });
    expect(html).toContain("digicampus.uni-augsburg.de");
    expect(html).toContain("Shibboleth.sso/Login");
    expect(html).toContain('name="cookie"');
  });

  it("parses form body", () => {
    expect(parseFormBody("cookie=abc123", "cookie")).toBe("abc123");
    expect(parseSeminarSessionCookie(parseFormBody("cookie=Seminar_Session%3Dx", "cookie"))).toBe("x");
  });
});
