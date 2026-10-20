import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, EXIT_CODES } from "@imstudium/contract/errors";
import { ImstudiumError, parseApiErrors, readResponseError, toImstudiumError } from "./errors.js";
import { isAuthError, isOfflineError } from "./resources/attrs.js";

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "dist" && e.name !== "test") out.push(...(await sources(p)));
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("error table", () => {
  it("every code thrown in source is in the table (or an alias of one)", async () => {
    const known = new Set<string>(Object.keys(ERROR_CODES));
    for (const spec of Object.values(ERROR_CODES)) for (const a of ("aliases" in spec ? spec.aliases : []) ?? []) known.add(a);
    const thrown = new Map<string, string>();
    for (const pkg of ["sdk", "cli", "mcp", "contract"]) {
      for (const file of await sources(join(PACKAGES, pkg, "src"))) {
        const text = await readFile(file, "utf-8");
        for (const m of text.matchAll(/new ImstudiumError\(/g)) {
          const code = /"([A-Z][A-Z0-9_]+)"/.exec(text.slice(m.index, m.index + 400))?.[1];
          if (code) thrown.set(code, file.slice(PACKAGES.length + 1));
        }
        for (const m of text.matchAll(/errorPayload\(\{\s*code:\s*"([A-Z_]+)"/g)) thrown.set(m[1]!, file);
      }
    }
    expect(thrown.size).toBeGreaterThan(20);
    const unknown = [...thrown].filter(([code]) => !known.has(code));
    expect(unknown).toEqual([]);
  });

  it("maps every category to a distinct exit code; 0 means success", () => {
    const exits = Object.values(EXIT_CODES);
    expect(new Set(exits).size).toBe(exits.length);
    expect(EXIT_CODES.ok).toBe(0);
  });

  it("canonicalises legacy codes and keeps the old one", () => {
    const e = new ImstudiumError("gone", "SESSION_EXPIRED");
    expect(e.code).toBe("AUTH_REQUIRED");
    expect(e.legacyCode).toBe("SESSION_EXPIRED");
    expect(e.exitCode).toBe(4);
    expect(e.hint).toBe(ERROR_CODES.AUTH_REQUIRED.hint);
    expect(e.toJSON().error).toMatchObject({ code: "AUTH_REQUIRED", legacyCode: "SESSION_EXPIRED", exitCode: 4, retryable: false });
    expect(isAuthError(e)).toBe(true);
    expect(isAuthError(new ImstudiumError("x", "NO_SESSION"))).toBe(true);
  });

  it("keeps an explicit hint and computes retryable from the status", () => {
    const e = new ImstudiumError("busy", "UPSTREAM_ERROR", 503, "later");
    expect(e.hint).toBe("later");
    expect(e.retryable).toBe(true);
    expect(e.exitCode).toBe(7);
    expect(new ImstudiumError("bad", "UPSTREAM_ERROR", 400).retryable).toBe(false);
  });

  it("unknown codes count as internal", () => {
    expect(new ImstudiumError("?", "SOMETHING_NEW").exitCode).toBe(1);
  });
});

describe("Stud.IP errors", () => {
  it("never leak Stud.IP's own code into ours", () => {
    const e = parseApiErrors({ errors: [{ status: "403", code: "forbidden", title: "Forbidden", detail: "No access" }] } as never);
    expect(e.code).toBe("UPSTREAM_ERROR");
    expect(e.status).toBe(403);
    expect(e.details).toEqual({ upstream: { code: "forbidden", title: "Forbidden" } });
  });

  it("maps 401 to AUTH_REQUIRED and 404 to NOT_FOUND", async () => {
    expect((await readResponseError(new Response("x", { status: 401 }))).code).toBe("AUTH_REQUIRED");
    expect((await readResponseError(new Response("x", { status: 404 }))).exitCode).toBe(5);
    expect(parseApiErrors({ errors: [{ status: "401", title: "Unauthorized" }] } as never).code).toBe("AUTH_REQUIRED");
  });

  it("turns fetch failures into NETWORK (offline fallback applies)", () => {
    const e = toImstudiumError(new TypeError("fetch failed"));
    expect(e.code).toBe("NETWORK");
    expect(e.exitCode).toBe(6);
    expect(isOfflineError(e)).toBe(true);
    expect(toImstudiumError(new Error("boom")).code).toBe("UNKNOWN");
  });
});
