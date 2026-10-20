import { z } from "zod";

/**
 * CLI JSON envelope v1 (the default until 1.0): the payload's keys sit at the
 * top level next to `schemaVersion: "1"`. Arrays and scalars go under `data`.
 * Errors are a separate document: `{ error: {...} }` on stderr.
 */
export const SCHEMA_VERSION = "1" as const;

export function envelopeV1<T extends z.ZodTypeAny>(payload: T): z.ZodType {
  if (payload instanceof z.ZodObject) {
    return payload.extend({ schemaVersion: z.literal(SCHEMA_VERSION) });
  }
  if (payload instanceof z.ZodUnion) {
    return z.union(
      (payload.options as z.ZodTypeAny[]).map((o) => envelopeV1(o)) as unknown as [z.ZodTypeAny, z.ZodTypeAny],
    );
  }
  return z.object({ schemaVersion: z.literal(SCHEMA_VERSION), data: payload });
}

/** The error document every CLI command writes (stderr) and MCP returns with `isError`. */
export const ErrorBody = z
  .object({
    error: z.object({
      code: z.string().describe("Stable code from the error table (docs/ERRORS.md)"),
      message: z.string(),
      status: z.number().int().optional().describe("HTTP status when Stud.IP answered"),
      hint: z.string().optional().describe("What to run or check next"),
      retryable: z.boolean().optional(),
      exitCode: z.number().int().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .describe("Error document (CLI stderr, MCP isError content)");
export type ErrorBody = z.infer<typeof ErrorBody>;
