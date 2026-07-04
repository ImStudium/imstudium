import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { SessionData } from "./types.js";
import { paths } from "./config.js";
import { ImstudiumError } from "./errors.js";
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
import {
  buildLoginHelperHtml,
  buildLoginSuccessHtml,
  parseFormBody,
  readRequestBody,
} from "./login-helper.js";
import {
  buildOAuthAuthorizeUrl,
  buildPkcePair,
  exchangeOAuthCode,
  refreshOAuthToken,
} from "./oauth.js";

const KEYTAR_SERVICE = "imstudium";
const KEYTAR_ACCOUNT = "session";
const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface BrowserLoginOptions {
  instanceOrigin: string;
  timeoutMs?: number;
  headless?: boolean;
  profile?: BrowserProfileMode;
  profileDirectory?: string;
  force?: boolean;
  onMessage?: (text: string) => void;
}

export interface InteractiveLoginOptions {
  instanceOrigin: string;
  /** Pre-supplied cookie — skips the guided flow entirely (scripts, CI). */
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
  private instanceOrigin = "";

  setInstanceOrigin(origin: string): void {
    this.instanceOrigin = origin.replace(/\/$/, "");
  }

  async loadSession(): Promise<SessionData | null> {
    if (this.session) return this.session;

    const keytar = await getKeytar();
    if (keytar?.getPassword) {
      try {
        const raw = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
        if (raw) {
          this.session = JSON.parse(raw) as SessionData;
          return this.session;
        }
      } catch {
        // fall through to file storage
      }
    }

    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(join(paths.configDir, "session.json"), "utf-8");
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
    if (keytar?.setPassword) {
      try {
        await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, raw);
        return;
      } catch {
        // fall through to file storage
      }
    }

    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(`${paths.configDir}/session.json`, raw, { mode: 0o600 });
  }

  async clearSession(): Promise<void> {
    this.session = null;
    const keytar = await getKeytar();
    if (keytar?.deletePassword) {
      try {
        await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
      } catch {
        // ignore
      }
    }
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(`${paths.configDir}/session.json`);
    } catch {
      // ignore
    }
  }

  /** Refresh OAuth tokens when close to expiry (Stud.IP Refresh Token Grant). */
  async ensureValidSession(options?: {
    instanceOrigin?: string;
    clientId?: string;
  }): Promise<SessionData | null> {
    const session = await this.loadSession();
    if (!session) return null;

    const origin = (options?.instanceOrigin || this.instanceOrigin).replace(/\/$/, "");
    if (session.type === "cookie" && origin && session.cookies?.Seminar_Session) {
      const ok = await this.isCookieValid(origin, session.cookies.Seminar_Session);
      if (!ok) {
        await this.clearSession();
        return null;
      }
      return session;
    }

    if (session.type !== "oauth") return session;

    const clientId = options?.clientId;
    if (!origin || !clientId || !session.refreshToken) return session;

    const expiresAt = session.expiresAt ? Date.parse(session.expiresAt) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt > Date.now() + 60_000) {
      return session;
    }

    const tokens = await refreshOAuthToken({
      instanceOrigin: origin,
      clientId,
      refreshToken: session.refreshToken,
    });

    const refreshed: SessionData = {
      type: "oauth",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? session.refreshToken,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : session.expiresAt,
    };
    await this.saveSession(refreshed);
    return refreshed;
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

  /** Default login: open a browser window and auto-capture the session. */
  async loginInteractive(options: InteractiveLoginOptions): Promise<SessionData> {
    const origin = options.instanceOrigin.replace(/\/$/, "");

    if (options.cookieValue) {
      return this.finishCookieLogin(origin, parseSeminarSessionCookie(options.cookieValue));
    }
    if (process.env.IMSTUDIUM_SESSION_COOKIE) {
      return this.finishCookieLogin(
        origin,
        parseSeminarSessionCookie(process.env.IMSTUDIUM_SESSION_COOKIE),
      );
    }

    return this.runGuidedLogin(origin, options);
  }

  private async finishCookieLogin(origin: string, seminarSession: string): Promise<SessionData> {
    if (!seminarSession) {
      throw new ImstudiumError(
        "Empty session cookie.",
        "LOGIN_INVALID_COOKIE",
        undefined,
        "Provide Seminar_Session after logging in at Stud.IP.",
      );
    }
    const ok = await this.isCookieValid(origin, seminarSession);
    if (!ok) {
      throw new ImstudiumError(
        "Session cookie was rejected by Stud.IP.",
        "LOGIN_INVALID_COOKIE",
        undefined,
        "Log in again and copy a fresh Seminar_Session value.",
      );
    }
    const session: SessionData = {
      type: "cookie",
      cookies: { Seminar_Session: seminarSession },
    };
    await this.saveSession(session);
    return session;
  }

  private async isCookieValid(origin: string, seminarSession: string): Promise<boolean> {
    try {
      const res = await fetch(`${origin}/jsonapi.php/v1/users/me`, {
        headers: {
          Accept: "application/vnd.api+json",
          Cookie: `Seminar_Session=${seminarSession}`,
        },
      });
      const contentType = res.headers.get("content-type") || "";
      return res.ok && contentType.includes("json");
    } catch {
      return false;
    }
  }

  private runGuidedLogin(origin: string, options: InteractiveLoginOptions): Promise<SessionData> {
    const loginUrl = buildShibbolethLoginUrl(origin);

    return new Promise((resolve, reject) => {
      let settled = false;
      const ctx: {
        origin: string;
        loginUrl: string;
        captureUrl?: string;
        onManualSubmit: (raw: string) => Promise<SessionData>;
      } = {
        origin,
        loginUrl,
        onManualSubmit: async (raw) => {
          const session = await this.finishCookieLogin(origin, parseSeminarSessionCookie(raw));
          finish(() => resolve(session));
          return session;
        },
      };

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        fn();
      };

      const server = createServer((req, res) => {
        void this.handleLoginRequest(req, res, ctx);
      });

      const timer = setTimeout(() => {
        finish(() =>
          reject(
            new ImstudiumError(
              "Login timed out.",
              "LOGIN_TIMEOUT",
              undefined,
              "Run imstudium login again.",
            ),
          ),
        );
      }, LOGIN_TIMEOUT_MS);

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          finish(() =>
            reject(new ImstudiumError("Could not start login page.", "LOGIN_FAILED")),
          );
          return;
        }
        const helperUrl = `http://127.0.0.1:${addr.port}/`;
        ctx.captureUrl = `${helperUrl}capture`;
        options.onMessage?.(
          [
            "Manual login helper opened in your browser.",
            `If it did not open: ${helperUrl}`,
            "Prefer automatic login: run imstudium login (without --manual)",
          ].join("\n"),
        );
        if (options.openBrowser !== false) void openInSystemBrowser(helperUrl);
      });

      server.on("error", (err) => {
        finish(() => reject(new ImstudiumError(err.message, "LOGIN_FAILED")));
      });
    });
  }

  private async handleLoginRequest(
    req: IncomingMessage,
    res: ServerResponse,
    ctx: {
      origin: string;
      loginUrl: string;
      captureUrl?: string;
      onManualSubmit: (raw: string) => Promise<SessionData>;
    },
  ): Promise<void> {
    const path = (req.url || "/").split("?")[0];

    if (req.method === "GET" && path === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        buildLoginHelperHtml({
          origin: ctx.origin,
          loginUrl: ctx.loginUrl,
          captureUrl: ctx.captureUrl,
        }),
      );
      return;
    }

    if (req.method === "GET" && path === "/capture") {
      try {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const raw = url.searchParams.get("cookie") ?? "";
        await ctx.onManualSubmit(raw);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildLoginSuccessHtml());
      } catch (err) {
        const message =
          err instanceof ImstudiumError ? err.message : "Invalid session — try again.";
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          buildLoginHelperHtml({
            origin: ctx.origin,
            loginUrl: ctx.loginUrl,
            captureUrl: ctx.captureUrl,
            error: message,
          }),
        );
      }
      return;
    }

    if (req.method === "POST" && path === "/submit") {
      try {
        const body = await readRequestBody(req);
        const raw = parseFormBody(body, "cookie");
        await ctx.onManualSubmit(raw);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildLoginSuccessHtml());
      } catch (err) {
        const message =
          err instanceof ImstudiumError ? err.message : "Invalid session — try again.";
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          buildLoginHelperHtml({
            origin: ctx.origin,
            loginUrl: ctx.loginUrl,
            captureUrl: ctx.captureUrl,
            error: message,
          }),
        );
      }
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  }

  /** Opens Chrome, waits for Shibboleth login, auto-captures Seminar_Session. */
  async loginWithBrowser(options: BrowserLoginOptions): Promise<SessionData> {
    const origin = options.instanceOrigin.replace(/\/$/, "");
    const loginUrl = buildShibbolethLoginUrl(origin);
    const profile = options.profile ?? "isolated";
    const profileDirectory = options.profileDirectory ?? "Default";

    if (!options.force) {
      const stored = await this.loadSession();
      const storedCookie = stored?.cookies?.Seminar_Session;
      if (storedCookie && (await this.isCookieValid(origin, storedCookie))) {
        options.onMessage?.("Already signed in — reusing saved session.");
        return stored;
      }
    }

    const playwright = await loadPlaywright(options.onMessage);

    options.onMessage?.(
      profile === "system"
        ? "Sign in once in the browser (saved passwords work). We'll detect when you're done."
        : "Sign in once in the browser. We'll detect when you're done — no copy/paste needed.",
    );

    const context = await this.launchLoginContext(playwright, {
      profile,
      profileDirectory,
      headless: options.headless ?? false,
    });

    if (process.platform === "darwin") {
      const { exec } = await import("node:child_process");
      exec('osascript -e \'tell application "Google Chrome" to activate\'');
    }

    try {
      let seminarSession: string | null = null;
      if (!options.force) {
        seminarSession = await this.extractSeminarSession(context, origin);
        if (seminarSession) {
          return this.persistCookieSession(seminarSession);
        }
      }

      const page = await this.openLoginPage(context, loginUrl);

      const deadline = Date.now() + (options.timeoutMs ?? LOGIN_TIMEOUT_MS);
      let lastProgress = 0;

      while (Date.now() < deadline) {
        if (context.pages().every((p) => p.isClosed())) {
          throw new ImstudiumError(
            "Browser window was closed before login finished.",
            "LOGIN_CANCELLED",
            undefined,
            "Run imstudium login again and keep the browser window open until you see success.",
          );
        }

        for (const p of context.pages()) {
          if (!p.isClosed()) await this.assistLoginFlow(p);
        }

        seminarSession = await this.extractSeminarSession(context, origin);
        if (seminarSession) break;

        const elapsed = Date.now() - (deadline - (options.timeoutMs ?? LOGIN_TIMEOUT_MS));
        if (elapsed - lastProgress > 30_000) {
          lastProgress = elapsed;
          options.onMessage?.("Still waiting for sign-in in the browser window…");
        }

        await this.sleep(1500);
      }

      if (!seminarSession) {
        throw new ImstudiumError(
          "Login timed out. Complete sign-in in the browser window.",
          "LOGIN_TIMEOUT",
          undefined,
          "Run imstudium login again. Keep the browser window open until you reach your Stud.IP home page.",
        );
      }

      const session = await this.persistCookieSession(seminarSession);

      try {
        const donePage = context.pages().find((p) => !p.isClosed()) ?? page;
        const userName = await this.fetchUserDisplayName(origin, seminarSession);
        await donePage.setContent(
          buildLoginSuccessHtml({
            userName: userName ?? undefined,
            host: new URL(origin).hostname,
          }),
          { waitUntil: "domcontentloaded" },
        );
        await this.sleep(2800);
      } catch {
        // window may already be closing
      }

      return session;
    } finally {
      await context.close();
    }
  }

  private async fetchUserDisplayName(
    origin: string,
    seminarSession: string,
  ): Promise<string | null> {
    try {
      const res = await fetch(`${origin}/jsonapi.php/v1/users/me`, {
        headers: {
          Accept: "application/vnd.api+json",
          Cookie: `Seminar_Session=${seminarSession}`,
        },
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as {
        data?: { attributes?: Record<string, string> };
      };
      return payload.data?.attributes?.["formatted-name"] ?? null;
    } catch {
      return null;
    }
  }

  private async persistCookieSession(seminarSession: string): Promise<SessionData> {
    const session: SessionData = {
      type: "cookie",
      cookies: { Seminar_Session: seminarSession },
    };
    await this.saveSession(session);
    return session;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** One tab at the Shibboleth URL — close spare blank tabs only (never SSO popups). */
  private async openLoginPage(context: BrowserContext, loginUrl: string): Promise<Page> {
    for (const p of context.pages()) {
      if (p.isClosed()) continue;
      const url = p.url();
      if (url === "about:blank" || url === "chrome://newtab/") {
        if (context.pages().filter((x) => !x.isClosed()).length > 1) {
          await p.close().catch(() => {});
        }
      }
    }

    const page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());
    await page.bringToFront().catch(() => {});
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.bringToFront().catch(() => {});
    return page;
  }

  /** Optional: confirm Microsoft "Stay signed in?" only — never touch login/password forms. */
  private async assistLoginFlow(page: Page): Promise<void> {
    if (page.isClosed()) return;
    const url = page.url();
    if (!url.includes("microsoftonline.com")) return;

    // Never click while email/password/MFA fields are on screen.
    const hasAuthInput =
      (await page
        .locator(
          'input[type="password"], input[type="email"], input[name="loginfmt"], input[name="passwd"], input[type="tel"]',
        )
        .count()) > 0;
    if (hasAuthInput) return;

    const body = await page.locator("body").innerText().catch(() => "");
    const isKmsi =
      /stay signed in\?/i.test(body) ||
      /angemeldet bleiben\?/i.test(body) ||
      url.includes("kmsi");
    if (!isKmsi) return;

    const yes = page.locator('input[type="submit"][id="idSIButton9"]').first();
    if (await yes.isVisible().catch(() => false)) {
      await yes.click({ timeout: 3000 }).catch(() => {});
    }
  }

  private async extractSeminarSession(
    context: BrowserContext,
    origin: string,
  ): Promise<string | null> {
    const host = new URL(origin).hostname.replace(/^www\./, "");
    const all = await context.cookies();
    for (const cookie of all) {
      if (cookie.name !== "Seminar_Session") continue;
      const domain = cookie.domain.replace(/^\./, "");
      if (host !== domain && !host.endsWith(`.${domain}`)) continue;
      if (await this.isCookieValid(origin, cookie.value)) return cookie.value;
    }
    return null;
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
    }> = [];

    if (options.profile === "system") {
      attempts.push({
        userDataDir: resolveSystemChromeUserDataDir(),
        channel: "chrome",
        profileDirectory: options.profileDirectory,
      });
    } else {
      attempts.push({
        userDataDir: resolveIsolatedProfileDir(),
        channel: "chrome",
      });
    }

    // Fallback when Chrome channel is missing but an isolated login was requested.
    if (options.profile === "isolated") {
      attempts.push({
        userDataDir: resolveIsolatedProfileDir(),
      });
    }

    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        const args = attempt.profileDirectory
          ? [`--profile-directory=${attempt.profileDirectory}`]
          : [];
        const launchOptions: Parameters<typeof playwright.chromium.launchPersistentContext>[1] = {
          headless: options.headless,
          channel: attempt.channel,
          args,
        };
        // macOS Chrome logs "unsupported command-line flag: --no-sandbox" when Playwright passes it.
        if (process.platform === "darwin") {
          launchOptions.chromiumSandbox = true;
          launchOptions.ignoreDefaultArgs = ["--no-sandbox", "--disable-setuid-sandbox"];
        }
        return await playwright.chromium.launchPersistentContext(
          attempt.userDataDir,
          launchOptions,
        );
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);

        if (options.profile === "system" && attempt.channel === "chrome") {
          if (isProfileInUseError(message)) {
            throw new ImstudiumError(
              "Your Chrome profile is in use.",
              "CHROME_PROFILE_LOCKED",
              undefined,
              "Quit Google Chrome completely, then run imstudium login again.",
            );
          }
          if (isChromeMissingError(message)) {
            continue;
          }
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new ImstudiumError(
      `Could not launch browser for login: ${message}`,
      "BROWSER_LAUNCH_FAILED",
      undefined,
      "Install Google Chrome, then run imstudium login again.",
    );
  }

  /** OAuth2 PKCE — Stud.IP's recommended flow for CLI/desktop apps. */
  async loginWithOAuth(options: {
    instanceOrigin: string;
    clientId: string;
    scope?: string;
    onMessage?: (text: string) => void;
  }): Promise<SessionData> {
    const origin = options.instanceOrigin.replace(/\/$/, "");
    const { verifier, challenge } = buildPkcePair();

    options.onMessage?.(
      "Opening your browser for Stud.IP sign-in… (handles MFA automatically)",
    );

    const { redirectUri, waitForCode } = await startCallbackServer();
    const authUrl = buildOAuthAuthorizeUrl({
      instanceOrigin: origin,
      clientId: options.clientId,
      redirectUri,
      scope: options.scope,
      challenge,
    });

    await openInSystemBrowser(authUrl);

    const code = await waitForCode();
    const tokens = await exchangeOAuthCode({
      instanceOrigin: origin,
      clientId: options.clientId,
      code,
      redirectUri,
      verifier,
    });

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

async function loadPlaywright(onMessage?: (text: string) => void): Promise<typeof import("playwright")> {
  try {
    return await import("playwright");
  } catch {
    onMessage?.("Installing browser support (one-time)…");
    const { execSync } = await import("node:child_process");
    execSync("npx playwright install chrome", { stdio: "inherit" });
    return await import("playwright");
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
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<h1>Sign-in failed</h1><p>${errorDescription || error}</p><p>Close this tab and run imstudium login again.</p>`,
        );
        reject(
          new ImstudiumError(
            errorDescription || error,
            "OAUTH_DENIED",
            undefined,
            "Run imstudium login again.",
          ),
        );
        server.close();
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildLoginSuccessHtml());
        resolveCode!(code);
        server.close();
        return;
      }

      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Missing authorization code</h1>");
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
