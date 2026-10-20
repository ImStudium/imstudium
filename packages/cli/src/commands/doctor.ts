import type { Command } from "commander";
import { detectTools, probeOAuthServer, toolHints } from "@imstudium/sdk";
import { checkForUpdates, getCliVersion } from "../version.js";
import { act, getSdk, output } from "../runtime.js";
import { CLI_ENTRY } from "../entry.js";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Check local ingest pipeline (AnyDoc + pdf-inspector)")
    .action(
      act(async () => {
        const sdk = await getSdk();
        const oauth = await probeOAuthServer(sdk.config.instanceOrigin, sdk.config.oauth?.clientId);
        const tools = await detectTools();
        const hints = toolHints(tools);
        const update = await checkForUpdates(CLI_ENTRY);
        const lines = [
          `imstudium:  ${getCliVersion()} (${update.installMode})`,
          update.updateAvailable ? `update:      ${update.current} → ${update.latest} — run: imstudium update` : `update:      up to date`,
          "",
          `oauth:       ${oauth.status}${oauth.message ? ` — ${oauth.message}` : ""}`,
          oauth.status === "broken_setup"
            ? `oauth fix:   university admin → ${oauth.endpoints.admin}`
            : oauth.status === "ready" && !sdk.config.oauth?.clientId
              ? `oauth tip:   register client → docs/OAUTH.md`
              : "",
          "",
          `anydoc:        ${tools.anydoc ? "ok" : "MISSING"}`,
          `pdf-inspector: ${tools.pdfInspector ? "ok" : "MISSING"}`,
        ];
        if (hints.length) lines.push("", ...hints);
        output({ cliVersion: getCliVersion(), update, oauth, tools, hints }, lines.filter(Boolean).join("\n"));
      }),
    );
}
