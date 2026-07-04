import { execSync } from "node:child_process";
import { access } from "node:fs/promises";
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

/** ImStudium browser profile — no saved passwords, safe while Chrome is open. */
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

/** True when the user's normal Chrome is running — system profile launch would fail or fight it. */
export async function isChromeRunning(): Promise<boolean> {
  if (platform() === "darwin") {
    try {
      const out = execSync('pgrep -x "Google Chrome" 2>/dev/null || true', {
        encoding: "utf-8",
      });
      if (out.trim()) return true;
    } catch {
      // fall through to lock file
    }
  } else if (platform() === "win32") {
    try {
      const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe" 2>nul', {
        encoding: "utf-8",
      });
      if (/chrome\.exe/i.test(out)) return true;
    } catch {
      // fall through
    }
  } else {
    try {
      const out = execSync(
        "pgrep -x chrome 2>/dev/null || pgrep -x google-chrome 2>/dev/null || true",
        { encoding: "utf-8" },
      );
      if (out.trim()) return true;
    } catch {
      // fall through
    }
  }

  try {
    await access(join(resolveSystemChromeUserDataDir(), "SingletonLock"));
    return true;
  } catch {
    return false;
  }
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
