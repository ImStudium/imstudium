export function buildShibbolethLoginUrl(instanceOrigin: string): string {
  const origin = instanceOrigin.replace(/\/$/, "");
  return `${origin}/Shibboleth.sso/Login?target=${encodeURIComponent(
    `${origin}/dispatch.php/my_courses?sso=shibboleth`,
  )}`;
}

export function parseSeminarSessionCookie(input: string): string {
  const trimmed = input.trim().replace(/^["']|["']$/g, "");
  const match = trimmed.match(/Seminar_Session=([^;\s]+)/);
  return match ? match[1] : trimmed;
}

export async function openInSystemBrowser(url: string): Promise<void> {
  const { exec } = await import("node:child_process");
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}
