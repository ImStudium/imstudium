import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { keytarApi } from "./keytar.js";

/** An in-memory keychain behind the same module shape keytar has under ESM: the API on default, getPassword alone as a named export. */
const keychain = new Map<string, string>();
const api = {
  getPassword: vi.fn(async (s: string, a: string) => keychain.get(`${s}/${a}`) ?? null),
  setPassword: vi.fn(async (s: string, a: string, p: string) => void keychain.set(`${s}/${a}`, p)),
  deletePassword: vi.fn(async (s: string, a: string) => keychain.delete(`${s}/${a}`)),
};
vi.mock("keytar", () => ({ default: api, getPassword: api.getPassword }));

const home = await mkdtemp(join(tmpdir(), "imstudium-keytar-"));
const oldHome = process.env.HOME;
process.env.HOME = home;
delete process.env.IMSTUDIUM_SESSION_STORE;
process.env.IMSTUDIUM_PLAIN_SESSION = "1";
afterAll(() => {
  process.env.HOME = oldHome;
});

describe("keytar under ESM", () => {
  it("Node's ESM loader exposes only getPassword as a named export of a keytar-shaped CommonJS module", async () => {
    // Same shape as keytar/lib/keytar.js, minus the native binding.
    const dir = await mkdtemp(join(tmpdir(), "imstudium-keytar-shape-"));
    const file = join(dir, "keytar.cjs");
    await writeFile(
      file,
      "module.exports = {\n  getPassword: function (s, a) { return Promise.resolve(null) },\n  setPassword: function (s, a, p) { return Promise.resolve() },\n  deletePassword: function (s, a) { return Promise.resolve(false) },\n}\n",
    );
    const url = pathToFileURL(file).href;
    const names = JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify(Object.keys(m).sort()))`], {
        encoding: "utf-8",
      }),
    ) as string[];
    // Node ≥ 23 also adds a "module.exports" key; setPassword and deletePassword are missing either way.
    expect(names.filter((n) => n !== "module.exports")).toEqual(["default", "getPassword"]);

    const mod = await import(url);
    expect(keytarApi(mod)).not.toBeNull();
    expect(typeof keytarApi(mod)!.setPassword).toBe("function");
  });

  it("keytarApi takes the default export, a CommonJS-style object, or nothing incomplete", () => {
    expect(keytarApi({ default: api, getPassword: api.getPassword })).toBe(api);
    expect(keytarApi(api)).toBe(api);
    expect(keytarApi({ getPassword: api.getPassword })).toBeNull();
    expect(keytarApi(null)).toBeNull();
  });
});

describe("session store with keytar", () => {
  it("saves to the keychain, and moves a session 0.2.0 left in the plain file there", async () => {
    const { AuthManager } = await import("./auth.js");
    const { paths } = await import("./config.js");
    expect(paths.configDir.startsWith(home)).toBe(true);
    const origin = "https://studip.example.test";
    const file = join(paths.configDir, "session.json");

    // 0.2.0: setPassword was undefined, so the session went to the file.
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(file, JSON.stringify({ type: "cookie", origin, cookies: { Seminar_Session: "synthetic" } }), { mode: 0o600 });

    const auth = new AuthManager();
    auth.setInstanceOrigin(origin);
    const session = await auth.loadSession();
    expect(session?.cookies).toEqual({ Seminar_Session: "synthetic" });
    expect(existsSync(file)).toBe(false);
    expect(await auth.sessionStore()).toBe("keychain");
    expect(JSON.parse(keychain.get(`imstudium/session:${origin}`)!)).toMatchObject({ origin, type: "cookie" });

    await auth.saveSession({ type: "cookie", cookies: { Seminar_Session: "next" } } as never);
    expect(existsSync(file)).toBe(false);
    expect(JSON.parse(keychain.get(`imstudium/session:${origin}`)!).cookies).toEqual({ Seminar_Session: "next" });
    expect(await auth.keychainAvailable()).toBe(true);

    await auth.clearSession();
    expect(keychain.has(`imstudium/session:${origin}`)).toBe(false);
    await expect(readFile(file)).rejects.toThrow();
  });
});
