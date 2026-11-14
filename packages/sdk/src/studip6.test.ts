/**
 * Stud.IP 6 compatibility (synthetic responses only). Stud.IP 6.1 renamed the
 * session cookie, stopped paginating some routes and dropped `status` from
 * error objects; these pin the behaviour ImStudium needs on both 5.x and 6.x.
 */
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isPagingRejected, StudIpClient } from "./client.js";
import { envConfigOverrides } from "./config.js";
import { ImstudiumError, parseApiErrors, readResponseError } from "./errors.js";
import { friendlyDownloadError, samePath } from "./sync.js";

const ORIGIN = "https://studip.a.example";
const JSONAPI = { "content-type": "application/vnd.api+json" };

function client(fetchImpl: typeof fetch) {
  return new StudIpClient({
    baseUrl: `${ORIGIN}/jsonapi.php/v1`,
    getCookies: () => ({ Studip_Session: "synthetic" }),
    getSessionOrigin: () => ORIGIN,
    fetchImpl,
    retries: 0,
  });
}

describe("routes that take no page parameters", () => {
  it("paginate retries once without page[…] and returns the unpaged data", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("page%5B") || url.includes("page[")) {
        return new Response(JSON.stringify({ errors: [{ title: "Page parameter limit is not allowed." }] }), { status: 400, headers: JSONAPI });
      }
      return new Response(JSON.stringify({ data: [{ type: "courseware-tasks", id: "t1" }] }), { status: 200, headers: JSONAPI });
    }) as typeof fetch;

    const page = await client(fetchImpl).paginate("/courseware-tasks", { filter: { cid: "c1" } });
    expect(page.data.map((d) => d.id)).toEqual(["t1"]);
    expect(urls).toHaveLength(2);
    expect(decodeURIComponent(urls[1]!)).toContain("filter[cid]=c1");
    expect(decodeURIComponent(urls[1]!)).not.toContain("page[");
  });

  it("other 400s still throw", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ errors: [{ title: "Filter cid is required." }] }), { status: 400, headers: JSONAPI })) as typeof fetch;
    await expect(client(fetchImpl).paginate("/courseware-tasks")).rejects.toMatchObject({ status: 400 });
  });

  it("recognises the paging error with or without a status", () => {
    expect(isPagingRejected(new ImstudiumError("Page parameter offset is not allowed.", "UPSTREAM_ERROR", 400))).toBe(true);
    expect(isPagingRejected(new ImstudiumError("Page parameter limit is not allowed.", "UPSTREAM_ERROR"))).toBe(true);
    expect(isPagingRejected(new ImstudiumError("Something else", "UPSTREAM_ERROR", 400))).toBe(false);
  });
});

describe("error objects without status", () => {
  it("fall back to the HTTP status", async () => {
    const res = new Response(JSON.stringify({ errors: [{ title: "Bad include" }] }), { status: 400, headers: JSONAPI });
    expect((await readResponseError(res)).status).toBe(400);
  });

  it("keep the object's own status when it has one", () => {
    expect(parseApiErrors({ errors: [{ status: "404", title: "Gone" }] }, 400).status).toBe(404);
  });
});

describe("environment beats config.json", () => {
  it("IMSTUDIUM_WORKSPACE, _ORIGIN and _BASE_URL override; unset ones don't", () => {
    expect(envConfigOverrides({ IMSTUDIUM_WORKSPACE: "/w", IMSTUDIUM_ORIGIN: "https://o.example" })).toEqual({
      workspacePath: "/w",
      instanceOrigin: "https://o.example",
    });
    expect(envConfigOverrides({})).toEqual({});
  });
});

describe("file sync", () => {
  const dirs: string[] = [];
  afterEach(() => void dirs.splice(0));

  it("treats a symlinked workspace path as the same file", async () => {
    const root = await mkdtemp(join(tmpdir(), "imstudium-same-"));
    dirs.push(root);
    await mkdir(join(root, "real", "files"), { recursive: true });
    await writeFile(join(root, "real", "files", "a.pdf"), "x");
    await symlink(join(root, "real"), join(root, "link"));
    expect(await samePath(join(root, "real", "files", "a.pdf"), join(root, "link", "files", "a.pdf"))).toBe(true);
    expect(await samePath(join(root, "real", "files", "a.pdf"), join(root, "real", "files", "b.pdf"))).toBe(false);
  });

  it("never shows Stud.IP's server paths as a download error", () => {
    const leaked = "/var/local/studip/lib/classes/JsonApi/Routes/Files/FileRefsContentShow.php(83)";
    expect(friendlyDownloadError(leaked, "0")).toMatch(/external link or a broken upload/);
    expect(friendlyDownloadError(leaked, "application/pdf")).toMatch(/server-side error/);
    expect(friendlyDownloadError("HTTP 403: Forbidden")).toBe("HTTP 403: Forbidden");
  });
});
