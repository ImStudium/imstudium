import type { Command } from "commander";
import { ImstudiumError } from "@imstudium/sdk";
import { act, globalOpts, output } from "../runtime.js";

/**
 * `imstudium schema [command]` — the JSON Schema of a command's `--json`
 * output, straight from @imstudium/contract. The contract (and zod) load
 * only here, so every other command starts without them.
 */
export function registerSchema(program: Command): void {
  program
    .command("schema")
    .description("JSON Schema of a command's --json output (from @imstudium/contract)")
    .argument("[command...]", 'Command path, e.g. today, "semester start", error or feed.FeedItem')
    .action(
      act(async (words: string[]) => {
        const contract = await import("@imstudium/contract");
        const name = words.join(" ").trim();
        if (!name) {
          const names = contract.schemaNames();
          output(
            { count: names.length, schemas: names },
            ["Schemas (imstudium schema <name>):", "", ...names.map((n) => `  ${n}`)].join("\n"),
          );
          return;
        }
        const schema = contract.toJsonSchema(name);
        if (!schema) {
          throw new ImstudiumError(
            `No schema for "${name}"`,
            "NOT_FOUND",
            404,
            "imstudium schema lists every command with a --json contract",
          );
        }
        // The schema is the document itself: no envelope, also without --json.
        console.log(JSON.stringify(schema, null, globalOpts.json ? 0 : 2));
      }),
    );
}
