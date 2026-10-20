import { describe, expect, it } from "vitest";
import { StudIpClient } from "./client.js";

const ORIGIN = "https://studip.a.example";

function counting() {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/vnd.api+json" } });
  }) as typeof fetch;
  return { fetchImpl, count: () => calls };
}

/** A client wired like createSdk's, with no stored session. */
function signedOut(fetchImpl: typeof fetch) {
  return new StudIpClient({
    baseUrl: `${ORIGIN}/jsonapi.php/v1`,
    getCookies: () => ({}),
    getAuthHeaders: () => ({}),
    getSessionOrigin: () => undefined,
    fetchImpl,
    retries: 0,
  });
}

describe("client without a session (P-005)", () => {
  it("no session → throws AUTH_REQUIRED and makes no network call", async () => {
    const { fetchImpl, count } = counting();
    const client = signedOut(fetchImpl);
    await expect(client.get("/users/me")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(client.paginate("/users/x/courses")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(client.download("/file-refs/x/content")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(client.head("/file-refs/x/content")).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(count()).toBe(0);
  });

  it("public routes (discovery) still go out without a session", async () => {
    const { fetchImpl, count } = counting();
    const client = signedOut(fetchImpl);
    await client.get("discovery", undefined, { public: true });
    expect(count()).toBe(1);
  });

  it("a signed-in client sends", async () => {
    const { fetchImpl, count } = counting();
    const client = new StudIpClient({
      baseUrl: `${ORIGIN}/jsonapi.php/v1`,
      getCookies: () => ({ Seminar_Session: "synthetic" }),
      getSessionOrigin: () => ORIGIN,
      fetchImpl,
      retries: 0,
    });
    await client.get("/users/me");
    expect(count()).toBe(1);
  });
});
