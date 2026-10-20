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

  it("errors are an ErrorBody on stderr", () => {
    const r = runCli(fx, ["--json", "schema", "nope"]);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(ErrorBody.safeParse(JSON.parse(r.stderr)).success).toBe(true);
  });
});
