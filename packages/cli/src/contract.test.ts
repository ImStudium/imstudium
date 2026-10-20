import { beforeAll, describe, expect, it } from "vitest";
import { envelopeV1, CLI_OUTPUTS, ErrorBody, type CliCommandWithSchema } from "@imstudium/contract";
import { makeFixture, runCli, type Fixture } from "./test/harness.js";

/**
 * The built CLI against the synthetic workspace: every offline `--json`
 * command must validate against its @imstudium/contract schema, and none of
 * them may touch the network.
 */
let fx: Fixture;
beforeAll(async () => {
  fx = await makeFixture();
});

function expectContract(command: CliCommandWithSchema, args: string[]) {
  const r = runCli(fx, ["--json", ...args]);
  expect(r.stderr, args.join(" ")).not.toContain("[no-network]");
  expect(r.status, `${args.join(" ")}\n${r.stderr}`).toBe(0);
  const parsed = envelopeV1(CLI_OUTPUTS[command]).safeParse(r.json());
  expect(parsed.success ? null : parsed.error.issues, args.join(" ")).toBeNull();
  return r.json() as Record<string, unknown>;
}

describe("CLI --json matches @imstudium/contract (offline, synthetic)", () => {
  it("changes", () => {
    const out = expectContract("changes", ["changes", "--since", "7d"]);
    expect(out.count).toBe(2);
  });

  it("search", () => {
    const out = expectContract("search", ["search", "Erwartungswert"]);
    expect(out.count).toBe(1);
  });

  it("changes --course resolves like every other command, -n limits", () => {
    const out = expectContract("changes", ["changes", "--course", "statistik", "-n", "5"]);
    expect(out.count).toBe(1);
    expect(expectContract("changes", ["changes", "-n", "1"]).count).toBe(1);
    const bad = runCli(fx, ["--json", "changes", "--course", "nope"]);
    expect(bad.status).toBe(5);
    expect(JSON.parse(bad.stderr).error.code).toBe("COURSE_NOT_FOUND");
  });

  it("context --offline stays local", () => {
    const out = expectContract("context", ["context", "--offline", "--since", "2w"]);
    expect((out.semester as { workspace: { courses: number } }).workspace.courses).toBe(2);
    expect((out.tasks as unknown[]).length).toBe(1);
    expect((out.newFiles as unknown[]).length).toBe(2);
  });

  it("a bad --limit is a usage error (exit 2), never a silent default", () => {
    const r = runCli(fx, ["--json", "search", "x", "--limit", "abc"]);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stderr).error.code).toBe("BAD_ARGS");
  });

  it("klausuren", () => {
    expectContract("klausuren", ["klausuren"]);
  });

  it("today and week from calendar.ics", () => {
    const today = expectContract("today", ["today", "--offline"]);
    expect((today.entries as unknown[]).length).toBe(1);
    expectContract("week", ["week", "--offline"]);
  });

  it("schema prints JSON Schema without touching the network", () => {
    const r = runCli(fx, ["schema", "today"]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).title).toBe("imstudium today --json");
  });

  it("errors are an ErrorBody on stderr with the table's exit code", () => {
    const r = runCli(fx, ["--json", "schema", "nope"]);
    expect(r.status).toBe(5);
    expect(r.stdout).toBe("");
    const body = ErrorBody.parse(JSON.parse(r.stderr));
    expect(body.error).toMatchObject({ code: "NOT_FOUND", exitCode: 5, retryable: false });
  });
});

describe("usage errors (Commander)", () => {
  it("unknown command exits 2 with BAD_ARGS JSON under --json", () => {
    const r = runCli(fx, ["--json", "nonsense"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(ErrorBody.parse(JSON.parse(r.stderr)).error.code).toBe("BAD_ARGS");
  });

  it("missing argument exits 2; human mode keeps Commander's message", () => {
    const r = runCli(fx, ["search"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/missing required argument/);
  });

  it("help and version still exit 0", () => {
    expect(runCli(fx, ["--help"]).status).toBe(0);
    expect(runCli(fx, ["--version"]).status).toBe(0);
    expect(runCli(fx, ["today", "--help"]).status).toBe(0);
  });

  it("a missing workspace exits 8", () => {
    const r = runCli(fx, ["--json", "klausuren"], { IMSTUDIUM_WORKSPACE: `${fx.root}/nowhere` });
    expect(r.status).toBe(8);
    expect(JSON.parse(r.stderr).error.code).toBe("WORKSPACE_MISSING");
  });
});
