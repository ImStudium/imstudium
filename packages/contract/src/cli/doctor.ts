import { z } from "zod";

export const DoctorStatus = z.enum(["ok", "warn", "fail", "skip"]);
export type DoctorStatus = z.infer<typeof DoctorStatus>;

export const DoctorCheck = z.object({
  id: z.string().describe("Stable check id, e.g. session.store"),
  title: z.string(),
  status: DoctorStatus.describe("ok · warn (works, could be better) · fail (broken) · skip (not checked, e.g. --offline)"),
  detail: z.string(),
  fix: z.string().nullable().describe("The command or step that fixes a warn/fail"),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type DoctorCheck = z.infer<typeof DoctorCheck>;

/** `imstudium doctor --json` */
export const DoctorOutput = z
  .object({
    ok: z.boolean().describe("No check failed"),
    offline: z.boolean(),
    versions: z.object({
      cli: z.string(),
      sdk: z.string(),
      contract: z.string(),
      mcp: z.string().nullable(),
      node: z.string(),
      bun: z.string().nullable(),
    }),
    summary: z.object({ ok: z.number().int(), warn: z.number().int(), fail: z.number().int(), skip: z.number().int() }),
    checks: z.array(DoctorCheck),
  })
  .describe("Health of the install, session, workspace, ingest engines, agent setup and MCP door");
export type DoctorOutput = z.infer<typeof DoctorOutput>;
