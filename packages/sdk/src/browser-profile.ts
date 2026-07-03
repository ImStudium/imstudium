import { homedir, platform } from "node:os";
import { join } from "node:path";
import { paths } from "./config.js";

export type BrowserProfileMode = "system" | "isolated";

/** Chrome "User Data" root — pass `--profile-directory` for Default, Profile 1, etc. */
export function resolveSystemChromeUserDataDir(): string {
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Application Support", "Google", "Chrome");
  }
  if (platform() === "win32") {
    const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return join(local, "Google", "Chrome", "User Data");
  }
  return join(home, ".config", "google-chrome");
}

/** DigiCampus-only profile — no saved passwords, safe while Chrome is open. */
export function resolveIsolatedProfileDir(): string {
  return join(paths.configDir, "chrome-profile");
}

export function isProfileInUseError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("singletonlock") ||
    lower.includes("process_singleton") ||
    lower.includes("processsingleton") ||
    (lower.includes("profile") &&
      (lower.includes("in use") ||
        lower.includes("already running") ||
        lower.includes("locked")))
  );
}

export function isChromeMissingError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("channel") ||
    lower.includes("executable doesn't exist") ||
    lower.includes("executable does not exist") ||
    lower.includes("failed to launch")
  );
}
