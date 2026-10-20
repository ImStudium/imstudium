import type { Command } from "commander";
import { ImstudiumError } from "@imstudium/sdk";
import { act, getSdk, output } from "../runtime.js";
import { table } from "../kit/format.js";

const KEYS = ["base-url", "workspace"] as const;

export function registerConfig(program: Command): void {
  const config = program.command("config").description("Show or change ~/.config/imstudium/config.json");

  config
    .command("show")
    .description("Effective configuration (file + environment + flags)")
    .action(
      act(async () => {
        const sdk = await getSdk();
        const c = sdk.config;
        const aliases = Object.entries(c.courseAliases ?? {});
        output(c, [
          ...table(
            [
              ["instance", c.instanceOrigin],
              ["base-url", c.baseUrl],
              ["workspace", sdk.workspacePath],
              ["semester", c.semesterId ?? "calendar-current"],
              ["oauth client", c.oauth?.clientId ?? "—"],
              ["shortcuts", aliases.length ? aliases.map(([k, v]) => `${k} → ${v}`).join(", ") : "—"],
            ],
          ),
        ].join("\n"));
      }),
    );

  config
    .command("set <key> <value>")
    .description(`Set a key: ${KEYS.join(" | ")}`)
    .action(
      act(async (key: string, value: string) => {
        const sdk = await getSdk();
        if (key === "base-url") {
          await sdk.saveConfig({ baseUrl: value, instanceOrigin: value.replace(/\/jsonapi\.php\/v1$/, "") });
        } else if (key === "workspace") {
          await sdk.saveConfig({ workspacePath: value });
        } else {
          throw new ImstudiumError(`Unknown key: ${key}`, "BAD_ARGS", undefined, `Valid keys: ${KEYS.join(", ")}`);
        }
        output({ ok: true, key, value }, `Set ${key} = ${value}`);
      }),
    );
}
