import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudIpClient } from "./client.js";

const A = "https://studip.a.example";
const B = "https://studip.b.example";

/** Records every request; never touches the network. */
function recorder() {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/vnd.api+json" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function clientFor(baseOrigin: string, sessionOrigin: string | undefined, fetchImpl: typeof fetch, kind: "cookie" | "oauth" = "cookie") {
  return new StudIpClient({
    baseUrl: `${baseOrigin}/jsonapi.php/v1`,
    getCookies: (): Record<string, string> => (kind === "cookie" ? { Seminar_Session: "synthetic-cookie" } : {}),
    getAuthHeaders: (): Record<string, string> => (kind === "oauth" ? { Authorization: "Bearer synthetic-token" } : {}),
    getSessionOrigin: () => sessionOrigin,
    fetchImpl,
    retries: 0,
  });
}

describe("session bound to its origin (P-004)", () => {
  it("session for A + baseUrl B throws SESSION_ORIGIN_MISMATCH and sends no Cookie", async () => {
    const { calls, fetchImpl } = recorder();
    const client = clientFor(B, A, fetchImpl);
    await expect(client.get("/users/me")).rejects.toMatchObject({ code: "SESSION_ORIGIN_MISMATCH" });
    expect(calls.filter((c) => "Cookie" in c.headers)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("never attaches a bearer token to another origin either", async () => {
    const { calls, fetchImpl } = recorder();
    const client = clientFor(B, A, fetchImpl, "oauth");
    await expect(client.get("/users/me")).rejects.toMatchObject({ code: "SESSION_ORIGIN_MISMATCH" });
    expect(calls.filter((c) => "Authorization" in c.headers)).toHaveLength(0);
  });

  it("refuses an absolute URL on another origin even when the base matches", async () => {
    const { calls, fetchImpl } = recorder();
    const client = clientFor(A, A, fetchImpl);
    await expect(client.download(`${B}/sendfile.php?x=1`)).rejects.toMatchObject({ code: "SESSION_ORIGIN_MISMATCH" });
    expect(calls).toHaveLength(0);
  });

  it("a session without origin is never sent", async () => {
    const { calls, fetchImpl } = recorder();
    const client = clientFor(A, undefined, fetchImpl);
    await expect(client.get("/users/me")).rejects.toMatchObject({ code: "SESSION_ORIGIN_MISMATCH" });
    expect(calls).toHaveLength(0);
  });

  it("same origin: the cookie goes out (origin compared normalised)", async () => {
    const { calls, fetchImpl } = recorder();
    const client = clientFor(A, `${A.toUpperCase().replace("HTTPS", "https")}:443/`, fetchImpl);
    await client.get("/users/me");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.Cookie).toBe("Seminar_Session=synthetic-cookie");
  });

  it("the error carries the login hint for the requested instance", async () => {
    const { fetchImpl } = recorder();
    const err = await clientFor(B, A, fetchImpl).get("/x").catch((e) => e);
    expect(err.hint).toBe(`Run: imstudium login --instance ${B}`);
    expect(err.exitCode).toBe(4);
  });
});

describe("legacy session migration (P-004)", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "imstudium-origin-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("IMSTUDIUM_SESSION_STORE", "file");
    vi.resetModules();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(home, { recursive: true, force: true });
  });

  async function writeLegacy() {
    const dir = join(home, ".config", "imstudium");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "session.json"), JSON.stringify({ type: "cookie", cookies: { Seminar_Session: "legacy" } }));
    return join(dir, "session.json");
  }

  it("moves a session without origin to the configured origin", async () => {
    const file = await writeLegacy();
    const { AuthManager } = await import("./auth.js");
    const auth = new AuthManager();
    auth.setConfiguredOrigin(A);
    auth.setInstanceOrigin(A);
    const s = await auth.loadSession();
    expect(s?.origin).toBe(A);
    expect(s?.cookies?.Seminar_Session).toBe("legacy");
    expect(JSON.parse(await readFile(file, "utf-8")).origin).toBe(A);
  });

  it("--instance B does not inherit the legacy session of the configured A", async () => {
    await writeLegacy();
    const { AuthManager } = await import("./auth.js");
    const auth = new AuthManager();
    auth.setConfiguredOrigin(A);
    auth.setInstanceOrigin(B);
    expect(await auth.loadSession()).toBeNull();
    expect(auth.getCookies()).toEqual({});

    const again = new AuthManager();
    again.setConfiguredOrigin(A);
    again.setInstanceOrigin(A);
    expect((await again.loadSession())?.origin).toBe(A);
  });

  it("new sessions are stored with the manager's origin", async () => {
    const { AuthManager, sessionAccount } = await import("./auth.js");
    const auth = new AuthManager();
    auth.setInstanceOrigin(`${B}/`);
    await auth.importCookies({ Seminar_Session: "fresh" });
    expect(auth.getSessionOrigin()).toBe(B);
    expect(sessionAccount(`${B}/`)).toBe(`session:${B}`);
  });
});
