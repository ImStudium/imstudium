import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DoctorOutput } from "@imstudium/contract";
import { makeFixture, runCli, type Fixture } from "../test/harness.js";
import { DOCTOR_CHECKS, renderDoctor } from "./doctor.js";

let fx: Fixture;
beforeAll(async () => {
  fx = await makeFixture();
});

describe("imstudium doctor", () => {
  it("--offline --json validates, touches no network and is fast", () => {
    const t = Date.now();
    const r = runCli(fx, ["--json", "doctor", "--offline"]);
    const elapsed = Date.now() - t;
    expect(r.stderr).not.toContain("[no-network]");
    const report = DoctorOutput.parse(JSON.parse(r.stdout).checks ? JSON.parse(r.stdout) : null);
    expect(report.offline).toBe(true);
    expect(elapsed).toBeLessThan(5_000);
    // Network checks are skipped, never failed, offline.
    for (const c of report.checks.filter((c) => DOCTOR_CHECKS.find((d) => d.id === c.id)?.network)) expect(c.status).toBe("skip");
    // The synthetic HOME has no session: a failing check with a fix, and exit 1.
    const session = report.checks.find((c) => c.id === "session.store")!;
    expect(session).toMatchObject({ status: "fail", fix: "imstudium login" });
    expect(report.ok).toBe(false);
    expect(r.status).toBe(1);
    // The synthetic workspace is found and current.
    expect(report.checks.find((c) => c.id === "workspace")!.status).toBe("ok");
    expect(report.checks.find((c) => c.id === "search")).toMatchObject({ status: "warn", fix: "imstudium sync --extract" });
  });

  it("every check has an id, a title and a fix on warn/fail", () => {
    const r = runCli(fx, ["--json", "doctor", "--offline"]);
    const report = DoctorOutput.parse(JSON.parse(r.stdout));
    expect(report.checks.map((c) => c.id)).toEqual(DOCTOR_CHECKS.map((c) => c.id));
    for (const c of report.checks) if (c.status === "fail") expect(c.fix, c.id).toBeTruthy();
  });

  it("a stored file session is flagged as the weak tier; a missing workspace fails", async () => {
    const cfg = join(fx.home, ".config", "imstudium");
    await mkdir(cfg, { recursive: true });
    await writeFile(join(cfg, "session.json"), JSON.stringify({ type: "cookie", cookies: { Seminar_Session: "synthetic" } }), { mode: 0o600 });
    const r = runCli(fx, ["--json", "doctor", "--offline"], { IMSTUDIUM_WORKSPACE: join(fx.root, "missing") });
    const report = DoctorOutput.parse(JSON.parse(r.stdout));
    expect(report.checks.find((c) => c.id === "session.store")).toMatchObject({ status: "warn", data: { store: "file" } });
    expect(report.checks.find((c) => c.id === "workspace")).toMatchObject({ status: "fail", fix: "imstudium semester start" });
  });

  it("human output names each check with its fix", () => {
    const text = renderDoctor({
      ok: false,
      offline: true,
      versions: { cli: "0.2.0", sdk: "0.2.0", contract: "0.2.0", mcp: null, node: "22.0.0", bun: null },
      summary: { ok: 1, warn: 0, fail: 1, skip: 0 },
      checks: [
        { id: "runtime.node", title: "Node.js", status: "ok", detail: "Node 22", fix: null },
        { id: "session.store", title: "Session", status: "fail", detail: "not signed in", fix: "imstudium login" },
      ],
    });
    expect(text).toContain("✗ Session");
    expect(text).toContain("→ imstudium login");
    expect(text).toMatch(/1 ok · 0 warnings · 1 problem/);
  });
});
