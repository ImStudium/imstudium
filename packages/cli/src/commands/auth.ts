import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { ImstudiumError, isChromeRunning, probeOAuthServer } from "@imstudium/sdk";
import { getCliVersion } from "../version.js";
import { act, getSdk, globalOpts, output, type Sdk } from "../runtime.js";

export interface LoginOptions {
  oauth?: boolean;
  manual?: boolean;
  chromeProfile?: boolean;
  profileDirectory?: string;
  relogin?: boolean;
  /** Always open the sign-in browser — do not assume an existing session. */
  force?: boolean;
  onMessage?: (text: string) => void;
}

/**
 * Sign in: OAuth when a client id is configured and Stud.IP offers it,
 * otherwise one dedicated Playwright window. Progress lines go to stderr
 * (stderr), so `--json` stdout carries exactly one document.
 */
export async function runLogin(sdk: Sdk, opts: LoginOptions): Promise<void> {
  // Sign-in prompts go to stderr even under --json (stdout keeps one document):
  // the manual helper's URL is something the student must see.
  const say = (text: string) => {
    opts.onMessage?.(text);
    if (!opts.onMessage && !globalOpts.quiet) console.error(text);
  };
  const loginOpts = { instanceOrigin: sdk.config.instanceOrigin, onMessage: say };
  const forceBrowser = opts.force ?? opts.relogin ?? false;

  if (!forceBrowser && !opts.manual) {
    const valid = await sdk.auth.ensureValidSession({
      instanceOrigin: sdk.config.instanceOrigin,
      clientId: sdk.config.oauth?.clientId,
    });
    if (valid) {
      say("Already signed in — session is valid.");
      return;
    }
  }

  const clientId = sdk.config.oauth?.clientId;
  const useOAuth = opts.oauth || Boolean(clientId);

  if (useOAuth && !opts.manual) {
    if (!clientId) {
      throw new ImstudiumError("Set IMSTUDIUM_OAUTH_CLIENT_ID or config oauth.clientId", "NO_CLIENT_ID");
    }
    const probe = await probeOAuthServer(sdk.config.instanceOrigin, clientId);
    if (probe.status === "ready") {
      await sdk.auth.loginWithOAuth({ instanceOrigin: sdk.config.instanceOrigin, clientId, onMessage: say });
      return;
    }
    if (probe.status === "broken_setup") {
      say("Stud.IP OAuth is not set up on this instance yet — using browser sign-in instead.");
      say(`University admin: ${probe.endpoints.admin}`);
    } else if (probe.status === "no_client") {
      throw new ImstudiumError(
        "OAuth client_id was rejected by Stud.IP.",
        "OAUTH_CLIENT_INVALID",
        undefined,
        "Check oauth.clientId in ~/.config/imstudium/config.json",
      );
    } else if (opts.oauth) {
      throw new ImstudiumError(probe.message || "OAuth is unavailable on this Stud.IP instance.", "OAUTH_UNAVAILABLE");
    } else {
      say(`${probe.message || "OAuth unavailable"} — using browser sign-in.`);
    }
  }

  if (opts.manual) {
    say("Opening manual login helper…");
    await sdk.auth.loginInteractive(loginOpts);
    return;
  }

  const browserBase = {
    instanceOrigin: sdk.config.instanceOrigin,
    profileDirectory: opts.profileDirectory,
    force: forceBrowser,
    onMessage: say,
  };
  say("Opening sign-in browser…");

  if (opts.chromeProfile) {
    if (await isChromeRunning()) {
      throw new ImstudiumError(
        "Google Chrome is still running.",
        "CHROME_PROFILE_LOCKED",
        undefined,
        "Quit Chrome completely, then run: imstudium login --chrome-profile",
      );
    }
    await sdk.auth.loginWithBrowser({ ...browserBase, profile: "system" });
    return;
  }

  // One dedicated Playwright window — never probe the user's open Chrome profile.
  await sdk.auth.loginWithBrowser({ ...browserBase, profile: "isolated" });
}

export function registerAuth(program: Command): void {
  program
    .command("login")
    .description("Sign in via browser — opens Stud.IP login every time")
    .option("--oauth", "Use OAuth2 PKCE (requires registered client_id)")
    .option("--chrome-profile", "Use your Chrome profile with saved passwords (quit Chrome first)")
    .option("--profile-directory <name>", "Chrome profile folder with --chrome-profile", "Default")
    .option("--manual", "Expert fallback: local helper page with manual session paste")
    .option("--relogin", "Alias for login (browser sign-in always runs)")
    .action(
      act(async (opts: LoginOptions) => {
        const sdk = await getSdk();
        await runLogin(sdk, { ...opts, force: true });
        const me = await sdk.courses.getMe();
        const name = (me.attributes?.["formatted-name"] as string) || me.id;
        const session = await sdk.auth.loadSession();
        output({ user: { id: me.id, name }, sessionType: session?.type ?? null }, `Logged in as ${name}`);
      }),
    );

  program
    .command("logout")
    .description("Clear stored session")
    .action(
      act(async () => {
        const sdk = await getSdk();
        await sdk.auth.clearSession();
        output({ ok: true }, "Logged out");
      }),
    );

  program
    .command("status")
    .description("Auth and instance status")
    .action(
      act(async () => {
        const sdk = await getSdk();
        const session = await sdk.auth.loadSession();
        const oauth = await probeOAuthServer(sdk.config.instanceOrigin, sdk.config.oauth?.clientId);
        if (!session) {
          output(
            {
              authenticated: false,
              cliVersion: getCliVersion(),
              oauth: {
                status: oauth.status,
                message: oauth.message,
                recommended: oauth.status === "ready" ? "imstudium login --oauth" : "imstudium login",
                adminUrl: oauth.endpoints.admin,
              },
            },
            [
              "Not logged in. Run: imstudium login",
              oauth.status === "broken_setup"
                ? "Note: Stud.IP OAuth is not configured on this instance — browser sign-in is used."
                : oauth.status === "ready" && sdk.config.oauth?.clientId
                  ? "OAuth is ready — imstudium login will use it automatically."
                  : oauth.status === "ready"
                    ? "OAuth is available — register a client (see docs/OAUTH.md) for one-click login."
                    : "",
            ]
              .filter(Boolean)
              .join("\n"),
          );
          return;
        }
        const me = await sdk.courses.getMe();
        const props = await sdk.discovery.getProperties();
        const name = String(me.attributes?.["formatted-name"] ?? me.id);
        const studipVersion = props["studip-version"];
        output(
          {
            authenticated: true,
            cliVersion: getCliVersion(),
            user: { id: me.id, name },
            studipVersion,
            workspace: sdk.workspacePath,
            sessionType: session.type,
            oauth: { status: oauth.status, adminUrl: oauth.endpoints.admin },
            next: "imstudium update",
          },
          [
            `Signed in as ${name} (${session.type}) on ${sdk.config.instanceOrigin}${studipVersion ? ` · Stud.IP ${studipVersion}` : ""}`,
            `Workspace: ${sdk.workspacePath}`,
            `CLI ${getCliVersion()} · OAuth ${oauth.status}`,
          ].join("\n"),
        );
      }),
    );

  const session = program.command("session").description("Session management: import a Stud.IP session cookie");
  session
    .command("import")
    .description("Store a Seminar_Session cookie (from --cookie or a Netscape cookie file)")
    .option("--cookie <value>", "Seminar_Session cookie value")
    .option("--file <path>", "Netscape cookie file")
    .action(
      act(async (opts: { cookie?: string; file?: string }) => {
        const sdk = await getSdk();
        if (opts.cookie) {
          await sdk.auth.importCookies({ Seminar_Session: opts.cookie });
        } else if (opts.file) {
          await sdk.auth.importFromNetscapeCookieFile(await readFile(opts.file, "utf-8"));
        } else {
          throw new ImstudiumError("Provide --cookie or --file", "BAD_ARGS", undefined, "imstudium session import --cookie <value>");
        }
        output({ ok: true }, "Session imported");
      }),
    );
}
