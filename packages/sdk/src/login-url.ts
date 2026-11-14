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

/**
 * Stud.IP's session cookie names, newest first. Stud.IP 6 renamed
 * `Seminar_Session` to `Studip_Session`; older instances still use the old one.
 */
export const SESSION_COOKIE_NAMES = ["Studip_Session", "Seminar_Session"] as const;

export interface SessionCookie {
  name: string;
  value: string;
}

export function isSessionCookieName(name: string): boolean {
  return (SESSION_COOKIE_NAMES as readonly string[]).includes(name);
}

/** Cookies Stud.IP or Shibboleth set that are not the Stud.IP login session. */
const NOT_A_STUDIP_SESSION = [/^_shibsession_/i, /^cache_session$/i];

/**
 * Cookie names that look like a session (`…session…`) but are neither a known
 * Stud.IP session name nor a known bystander — a renamed session cookie shows up here.
 */
export function unrecognisedSessionCookieNames(cookies: Array<{ name: string }>): string[] {
  return [
    ...new Set(
      cookies
        .map((c) => c.name)
        .filter((n) => /session/i.test(n) && !isSessionCookieName(n) && !NOT_A_STUDIP_SESSION.some((re) => re.test(n))),
    ),
  ];
}

/** The session cookie a stored cookie jar carries, whichever name it has. */
export function findSessionCookie(cookies: Record<string, string> | undefined): SessionCookie | null {
  if (!cookies) return null;
  for (const name of SESSION_COOKIE_NAMES) {
    const value = cookies[name];
    if (value) return { name, value };
  }
  return null;
}

/**
 * A pasted cookie: `Studip_Session=…`, `Seminar_Session=…`, a whole
 * `Cookie:` header, or the bare value. `name` is set only when the input said it.
 */
export function parseSessionCookie(input: string): { name?: string; value: string } {
  const trimmed = input.trim().replace(/^["']|["']$/g, "");
  for (const name of SESSION_COOKIE_NAMES) {
    const match = trimmed.match(new RegExp(`(?:^|[;\\s])${name}=([^;\\s]+)`));
    if (match) return { name, value: match[1]! };
  }
  return { value: trimmed };
}

/** @deprecated Use parseSessionCookie — this drops the cookie name. */
export function parseSeminarSessionCookie(input: string): string {
  return parseSessionCookie(input).value;
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
