import { describe, expect, it } from "vitest";
import {
  isChromeMissingError,
  isProfileInUseError,
  resolveIsolatedProfileDir,
  resolveSystemChromeUserDataDir,
} from "./browser-profile.js";

describe("browser-profile", () => {
  it("resolves system Chrome user data dir", () => {
    const dir = resolveSystemChromeUserDataDir();
    expect(dir).toContain("Chrome");
  });

  it("resolves isolated profile under digicampus config", () => {
    expect(resolveIsolatedProfileDir()).toMatch(/digicampus[/\\]chrome-profile$/);
  });

  it("detects profile-in-use errors", () => {
    expect(isProfileInUseError("Failed to create ProcessSingleton lock")).toBe(true);
    expect(isProfileInUseError("Chrome profile is in use")).toBe(true);
    expect(isProfileInUseError("network error")).toBe(false);
  });

  it("detects missing Chrome channel errors", () => {
    expect(isChromeMissingError("Chromium channel chrome not found")).toBe(true);
    expect(isChromeMissingError("executable doesn't exist at path")).toBe(true);
  });
});
