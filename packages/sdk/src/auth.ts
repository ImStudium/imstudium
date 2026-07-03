import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";
import type { SessionData } from "./types.js";
import { paths } from "./config.js";

const KEYTAR_SERVICE = "digicampus";
const KEYTAR_ACCOUNT = "session";

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

    // Fallback: file-based session in config dir (for CI / no keychain)
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

  async loginWithBrowser(options: {
    instanceOrigin: string;
    timeoutMs?: number;
    headless?: boolean;
  }): Promise<SessionData> {
    let playwright: typeof import("playwright");
    try {
      playwright = await import("playwright");
    } catch {
      throw new Error(
        "Playwright is required for browser login. Install with: pnpm add playwright && npx playwright install chromium",
      );
    }

    const origin = options.instanceOrigin.replace(/\/$/, "");
    const loginUrl = `${origin}/Shibboleth.sso/Login?target=${encodeURIComponent(
      `${origin}/dispatch.php/my_courses?sso=shibboleth`,
    )}`;

    const browser = await playwright.chromium.launch({
      headless: options.headless ?? false,
    });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
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
        throw new Error("Login timed out. Complete MFA in the browser window.");
      }

      const session: SessionData = { type: "cookie", cookies };
      await this.saveSession(session);
      return session;
    } finally {
      await browser.close();
    }
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

    const { exec } = await import("node:child_process");
    const open =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    exec(`${open} "${authUrl.toString()}"`);

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
