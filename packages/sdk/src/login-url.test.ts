import { describe, expect, it } from "vitest";
import { findSessionCookie, isSessionCookieName, parseSessionCookie, unrecognisedSessionCookieNames } from "./login-url.js";

describe("session cookie names", () => {
  it("knows the Stud.IP 6 and the legacy name", () => {
    expect(isSessionCookieName("Studip_Session")).toBe(true);
    expect(isSessionCookieName("Seminar_Session")).toBe(true);
    expect(isSessionCookieName("cache_session")).toBe(false);
  });

  it("finds whichever session cookie a stored jar carries", () => {
    expect(findSessionCookie({ Studip_Session: "new" })).toEqual({ name: "Studip_Session", value: "new" });
    expect(findSessionCookie({ Seminar_Session: "old" })).toEqual({ name: "Seminar_Session", value: "old" });
    expect(findSessionCookie({ other: "x" })).toBeNull();
    expect(findSessionCookie(undefined)).toBeNull();
  });

  it("parses pasted cookies with or without a name", () => {
    expect(parseSessionCookie("Studip_Session=abc")).toEqual({ name: "Studip_Session", value: "abc" });
    expect(parseSessionCookie("x=1; Seminar_Session=def; y=2")).toEqual({ name: "Seminar_Session", value: "def" });
    expect(parseSessionCookie(' "bare" ')).toEqual({ value: "bare" });
  });
});

describe("renamed session cookies are named, not waited out", () => {
  it("flags session-looking cookies imstudium doesn't know", () => {
    const jar = [{ name: "Studip_NextSession" }, { name: "_shibsession_64656661" }, { name: "cache_session" }, { name: "SRVNAME" }];
    expect(unrecognisedSessionCookieNames(jar)).toEqual(["Studip_NextSession"]);
  });

  it("is quiet when the jar holds a known session or nothing session-like", () => {
    expect(unrecognisedSessionCookieNames([{ name: "Studip_Session" }, { name: "Seminar_Session" }])).toEqual([]);
    expect(unrecognisedSessionCookieNames([{ name: "navigation-length" }])).toEqual([]);
  });
});
