import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";
import type { BrowserContext } from "playwright";
import type { SessionData } from "./types.js";
import { paths } from "./config.js";
import { DigicampusError } from "./errors.js";
import {
  type BrowserProfileMode,
  isChromeMissingError,
  isProfileInUseError,
  resolveIsolatedProfileDir,
  resolveSystemChromeUserDataDir,
} from "./browser-profile.js";
import {
  buildShibbolethLoginUrl,
  openInSystemBrowser,
  parseSeminarSessionCookie,
} from "./login-url.js";

const KEYTAR_SERVICE = "digicampus";
const KEYTAR_ACCOUNT = "session";

export interface BrowserLoginOptions {
  instanceOrigin: string;
  timeoutMs?: number;
  headless?: boolean;
  profile?: BrowserProfileMode;
  profileDirectory?: string;
}

export interface InteractiveLoginOptions {
  instanceOrigin: string;
  /** Read one line from the user (Seminar_Session value). Required unless cookieValue is set. */
  prompt?: (question: string) => Promise<string>;
  /** Pre-supplied cookie — skips prompt (for tests / automation). */
  cookieValue?: string;
  openBrowser?: boolean;
  onMessage?: (text: string) => void;
}

async function getKeytar() {
  try {
    return await import("keytar");
  } catch {
    return null;
  }
}

export class AuthManager {
  private session: SessionData | null = null;

  async loadSession(): Promise<SessionData | null> {
    if (this.session) return this.session;

    const keytar = await getKeytar();
    if (keytar) {
      const raw = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
      if (raw) {
        this.session = JSON.parse(raw) as SessionData;
        return this.session;
      }
    }

    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(`${paths.configDir}/session.json`, "utf-8");
      this.session = JSON.parse(raw) as SessionData;
      return this.session;
    } catch {
      return null;
    }
  }

  async saveSession(session: SessionData): Promise<void> {
    this.session = session;
    const raw = JSON.stringify(session);

    const keytar = await getKeytar();
    if (keytar) {
      await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, raw);
      return;
    }

    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(`${paths.configDir}/session.json`, raw, { mode: 0o600 });
  }

  async clearSession(): Promise<void> {
    this.session = null;
    const keytar = await getKeytar();
    if (keytar) await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(`${paths.configDir}/session.json`);
    } catch {
      // ignore
    }
  }

  getCookies(): Record<string, string> {
    return this.session?.cookies ?? {};
  }

  getAuthHeaders(): Record<string, string> {
    if (this.session?.type === "oauth" && this.session.accessToken) {
      return { Authorization: `Bearer ${this.session.accessToken}` };
    }
    return {};
  }

  async importCookies(cookies: Record<string, string>): Promise<void> {
    await this.saveSession({ type: "cookie", cookies });
  }

  async importFromNetscapeCookieFile(content: string): Promise<void> {
    const cookies: Record<string, string> = {};
    for (const line of content.split("\n")) {
      if (line.startsWith("#") || !line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length >= 7) {
        cookies[parts[5]] = parts[6];
      }
    }
    if (!cookies.Seminar_Session) {
      throw new Error("No Seminar_Session cookie found in file");
    }
    await this.importCookies(cookies);
  }

  /** Default login — opens your normal browser, then paste one cookie. No extra installs. */
  async loginInteractive(options: InteractiveLoginOptions): Promise<SessionData> {
    const origin = options.instanceOrigin.replace(/\/$/, "");
    const loginUrl = buildShibbolethLoginUrl(origin);

    if (options.openBrowser !== false) {
      await openInSystemBrowser(loginUrl);
    }

    options.onMessage?.(
      [
        "",
        "① Log in with your university account in the browser window (saved passwords work).",
        "② When you see your courses page, copy your session cookie:",
        "",
        "   Quick: on DigiCampus, press F12 → Console, paste this line, Enter:",
        "   copy(document.cookie.match(/Seminar_Session=([^;]+)/)?.[1]||'')",
        "",
        "   Or: DevTools → Application → Cookies → Seminar_Session → copy Value",
        "",
      ].join("\n"),
    );

    let raw = options.cookieValue;
    if (!raw) {
      if (!options.prompt) {
        throw new DigicampusError(
          "Interactive login needs a terminal.",
          "LOGIN_NOT_INTERACTIVE",
          undefined,
          "Run digicampus login in a terminal, or: digicampus session import --cookie \"<value>\"",
        );
      }
      raw = await options.prompt("③ Paste Seminar_Session here: ");
    }

    const seminarSession = parseSeminarSessionCookie(raw);
    if (!seminarSession) {
      throw new DigicampusError(
        "Empty session cookie.",
        "LOGIN_INVALID_COOKIE",
        undefined,
        "Copy the Seminar_Session value after logging in at DigiCampus.",
      );
    }

    await this.verifyCookie(origin, seminarSession);

    const session: SessionData = {
      type: "cookie",
      cookies: { Seminar_Session: seminarSession },
    };
    await this.saveSession(session);
    return session;
  }

  private async verifyCookie(origin: string, seminarSession: string): Promise<void> {
    const apiUrl = `${origin}/jsonapi.php/v1/users/me`;
    const res = await fetch(apiUrl, {
      headers: {
        Accept: "application/vnd.api+json",
        Cookie: `Seminar_Session=${seminarSession}`,
      },
    });
    if (!res.ok) {
      throw new DigicampusError(
        "Session cookie was rejected by DigiCampus.",
        "LOGIN_INVALID_COOKIE",
        res.status,
        "Log in again in your browser and paste a fresh Seminar_Session value.",
      );
    }
  }

  /** Optional — Playwright automated capture (requires playwright + chrome). */
  async loginWithBrowser(options: BrowserLoginOptions): Promise<SessionData> {
    let playwright: typeof import("playwright");
    try {
      playwright = await import("playwright");
    } catch {
      throw new DigicampusError(
        "Playwright is required for browser login.",
        "PLAYWRIGHT_MISSING",
        undefined,
        "Install: npm install -g digicampus (includes playwright) or npx playwright install chrome",
      );
    }

    const origin = options.instanceOrigin.replace(/\/$/, "");
    const loginUrl = buildShibbolethLoginUrl(origin);

    const profile = options.profile ?? "system";
    const profileDirectory = options.profileDirectory ?? "Default";
    const context = await this.launchLoginContext(playwright, {
      profile,
      profileDirectory,
      headless: options.headless ?? false,
    });

    try {
      const pages = context.pages();
      const page = pages[0] ?? (await context.newPage());
      await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

      const deadline = Date.now() + (options.timeoutMs ?? 300_000);
      let cookies: Record<string, string> = {};

      while (Date.now() < deadline) {
        const all = await context.cookies(origin);
        const map: Record<string, string> = {};
        for (const c of all) map[c.name] = c.value;
        if (map.Seminar_Session) {
          cookies = map;
          try {
            const apiUrl = `${origin}/jsonapi.php/v1/users/me`;
            const res = await fetch(apiUrl, {
              headers: {
                Accept: "application/vnd.api+json",
                Cookie: `Seminar_Session=${map.Seminar_Session}`,
              },
            });
            if (res.ok) break;
          } catch {
            // keep waiting
          }
        }
        await page.waitForTimeout(1500);
      }

      if (!cookies.Seminar_Session) {
        throw new DigicampusError(
          "Login timed out. Complete MFA in the browser window.",
          "LOGIN_TIMEOUT",
          undefined,
          profile === "system"
            ? "Quit Chrome if the window closed early, then run digicampus login again."
            : "Try: digicampus login (uses your Chrome profile with saved passwords)",
        );
      }

      const session: SessionData = { type: "cookie", cookies };
      await this.saveSession(session);
      return session;
    } finally {
      await context.close();
    }
  }

  private async launchLoginContext(
    playwright: typeof import("playwright"),
    options: {
      profile: BrowserProfileMode;
      profileDirectory: string;
      headless: boolean;
    },
  ): Promise<BrowserContext> {
    const attempts: Array<{
      userDataDir: string;
      channel?: "chrome";
      profileDirectory?: string;
      label: string;
    }> = [];

    if (options.profile === "system") {
      attempts.push({
        userDataDir: resolveSystemChromeUserDataDir(),
        channel: "chrome",
        profileDirectory: options.profileDirectory,
        label: "system Chrome profile",
      });
    }

    attempts.push({
      userDataDir: resolveIsolatedProfileDir(),
      label: "isolated DigiCampus profile",
    });

    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        const args = attempt.profileDirectory
          ? [`--profile-directory=${attempt.profileDirectory}`]
          : [];
        return await playwright.chromium.launchPersistentContext(attempt.userDataDir, {
          headless: options.headless,
          channel: attempt.channel,
          args,
        });
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);

        if (options.profile === "system" && attempt.channel === "chrome") {
          if (isProfileInUseError(message)) {
            throw new DigicampusError(
              "Your Chrome profile is in use.",
              "CHROME_PROFILE_LOCKED",
              undefined,
              "Quit Google Chrome completely, then run digicampus login --automated. Or use: digicampus login",
            );
          }
          if (isChromeMissingError(message)) {
            continue;
          }
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new DigicampusError(
      `Could not launch browser for login: ${message}`,
      "BROWSER_LAUNCH_FAILED",
      undefined,
      "Install Google Chrome, or use: digicampus login (normal browser)",
    );
  }

  /** OAuth2 PKCE stub — requires registered client_id */
  async loginWithOAuth(options: {
    instanceOrigin: string;
    clientId: string;
    scope?: string;
  }): Promise<SessionData> {
    const origin = options.instanceOrigin.replace(/\/$/, "");
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    const { redirectUri, waitForCode } = await startCallbackServer();
    const authUrl = new URL(`${origin}/dispatch.php/api/oauth2/authorize`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", options.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", options.scope ?? "api");
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    await openInSystemBrowser(authUrl.toString());

    const code = await waitForCode();
    const tokenRes = await fetch(`${origin}/dispatch.php/api/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: options.clientId,
        code_verifier: verifier,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`OAuth token exchange failed: ${text}`);
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const session: SessionData = {
      type: "oauth",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : undefined,
    };
    await this.saveSession(session);
    return session;
  }
}

function startCallbackServer(): Promise<{
  port: number;
  redirectUri: string;
  waitForCode: () => Promise<string>;
}> {
  return new Promise((resolve, reject) => {
    let resolveCode: (code: string) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      setTimeout(() => rej(new Error("OAuth callback timed out")), 300_000);
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Login successful. You can close this window.</h1>");
        resolveCode(code);
        server.close();
      } else {
        res.writeHead(400);
        res.end("Missing code");
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("No port"));
      const port = addr.port;
      resolve({
        port,
        redirectUri: `http://127.0.0.1:${port}/callback`,
        waitForCode: () => codePromise,
      });
    });
  });
}
