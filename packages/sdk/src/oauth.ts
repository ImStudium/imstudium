import { randomBytes, createHash } from "node:crypto";
import { ImstudiumError } from "./errors.js";

/** Stud.IP OAuth2 endpoints — see docs.gitlab.studip.de/entwicklung/functions/oauth2/ */
export function oauthEndpoints(instanceOrigin: string) {
  const origin = instanceOrigin.replace(/\/$/, "");
  return {
    authorize: `${origin}/dispatch.php/api/oauth2/authorize`,
    token: `${origin}/dispatch.php/api/oauth2/token`,
    admin: `${origin}/dispatch.php/admin/oauth2`,
  };
}

export type OAuthServerStatus = "ready" | "broken_setup" | "no_client" | "unreachable";

export interface OAuthProbeResult {
  status: OAuthServerStatus;
  message?: string;
  endpoints: ReturnType<typeof oauthEndpoints>;
}

/** Check whether this Stud.IP instance can serve OAuth2 (keys + client). */
export async function probeOAuthServer(
  instanceOrigin: string,
  clientId?: string,
): Promise<OAuthProbeResult> {
  const endpoints = oauthEndpoints(instanceOrigin);
  const url = new URL(endpoints.authorize);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId || "probe");
  url.searchParams.set("redirect_uri", "http://127.0.0.1:1/callback");
  url.searchParams.set("scope", "api");
  url.searchParams.set("code_challenge", "probe");
  url.searchParams.set("code_challenge_method", "S256");

  try {
    const res = await fetch(url.toString(), { redirect: "manual" });
    const contentType = res.headers.get("content-type") || "";

    if (res.status >= 300 && res.status < 400) {
      return { status: "ready", endpoints };
    }

    if (contentType.includes("json")) {
      const body = (await res.json()) as {
        error?: string;
        error_description?: string;
        message?: string;
      };
      if (body.error === "invalid_setup") {
        return {
          status: "broken_setup",
          message:
            body.error_description ||
            body.message ||
            "Stud.IP OAuth2 keys are not configured on this instance.",
          endpoints,
        };
      }
      if (body.error === "invalid_client" || body.error === "unauthorized_client") {
        return {
          status: clientId ? "no_client" : "ready",
          message: body.error_description || body.message,
          endpoints,
        };
      }
    }

    if (res.ok || res.status === 400) {
      return { status: "ready", endpoints };
    }

    return {
      status: "unreachable",
      message: `OAuth authorize returned HTTP ${res.status}`,
      endpoints,
    };
  } catch (err) {
    return {
      status: "unreachable",
      message: err instanceof Error ? err.message : String(err),
      endpoints,
    };
  }
}

export function buildPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildOAuthAuthorizeUrl(options: {
  instanceOrigin: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  challenge: string;
}): string {
  const { authorize } = oauthEndpoints(options.instanceOrigin);
  const url = new URL(authorize);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("scope", options.scope ?? "api");
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeOAuthCode(options: {
  instanceOrigin: string;
  clientId: string;
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}> {
  const { token } = oauthEndpoints(options.instanceOrigin);
  const tokenRes = await fetch(token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: options.redirectUri,
      client_id: options.clientId,
      code_verifier: options.verifier,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new ImstudiumError(
      "OAuth token exchange failed.",
      "OAUTH_TOKEN_FAILED",
      tokenRes.status,
      text.slice(0, 200),
    );
  }

  return (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

/** Stud.IP Refresh Token Grant */
export async function refreshOAuthToken(options: {
  instanceOrigin: string;
  clientId: string;
  refreshToken: string;
}): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}> {
  const { token } = oauthEndpoints(options.instanceOrigin);
  const tokenRes = await fetch(token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: options.refreshToken,
      client_id: options.clientId,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new ImstudiumError(
      "OAuth refresh failed.",
      "OAUTH_REFRESH_FAILED",
      tokenRes.status,
      text.slice(0, 200) || "Run: imstudium login",
    );
  }

  return (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
}
