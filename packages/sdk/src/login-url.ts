/** Shibboleth entityID per Stud.IP host — skips DFN-AAI org picker when set. */
const KNOWN_SHIB_IDP: Record<string, string> = {
  "digicampus.uni-augsburg.de":
    "https://idp.rz.uni-augsburg.de/simplesaml/saml2/idp/metadata.php",
};

export function buildShibbolethLoginUrl(instanceOrigin: string): string {
  const origin = instanceOrigin.replace(/\/$/, "");
  const host = new URL(origin).hostname;
  const target = `${origin}/?sso=shibboleth&cancel_login=1&again=yes`;
  const params = new URLSearchParams({ target });
  const entityId = KNOWN_SHIB_IDP[host];
  if (entityId) params.set("entityID", entityId);
  return `${origin}/Shibboleth.sso/Login?${params}`;
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
