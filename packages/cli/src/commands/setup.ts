import { Option, type Command } from "commander";
import {
  archiveLegacyConfigDir,
  ensureMigrated,
  ImstudiumError,
  installMathRuntime,
  installOcrRuntime,
  mathRuntimeStatus,
  ocrRuntimeStatus,
  removeMathRuntime,
  removeOcrRuntime,
} from "@imstudium/sdk";
import type { SetupOcrOutput } from "@imstudium/contract";
import { formatSetupSummary, getSetupStatus, runSetup, type AgentId } from "../setup.js";
import { checkForUpdates, runGlobalUpdate } from "../version.js";
import { act, getSdk, note, output } from "../runtime.js";
import { outputOption } from "../kit/args.js";
import { CLI_ENTRY } from "../entry.js";
import { formatBytes, ocrDiskBytes, ocrRuntimeView } from "../ocr.js";

const AGENT_HELP = "cursor | claude-code | claude-desktop | codex | windsurf | opencode | all";

type AgentOpts = { agent?: string; allAgents?: boolean; force?: boolean; yes?: boolean; output?: string; workspace?: string };

const agentOf = (opts: AgentOpts) => (opts.agent || undefined) as AgentId | "all" | undefined;

/** `-o, --output <dir>` is the workspace everywhere; `--workspace` stays as a hidden alias for old scripts. */
function withWorkspace(cmd: Command): Command {
  return cmd
    .addOption(outputOption("Studium workspace path (default: config / IMSTUDIUM_WORKSPACE)"))
    .addOption(new Option("--workspace <dir>").hideHelp());
}

export function registerSetup(program: Command): void {
  program
    .command("update")
    .description("Upgrade CLI (if needed) and refresh agent skills/MCP")
    .action(
      act(async () => {
        const sdk = await getSdk();
        const before = await checkForUpdates(CLI_ENTRY);
        let upgraded = false;
        let upgradeNote = "";
        if (before.installMode === "global" && before.updateAvailable) {
          const result = await runGlobalUpdate();
          if (!result.ok) throw new ImstudiumError("npm global upgrade failed", "UPDATE_FAILED", undefined, result.output.slice(0, 500));
          upgraded = true;
          upgradeNote = `CLI ${before.current} → ${before.latest}\n`;
        }
        const setup = await runSetup("all", { yes: true, workspace: sdk.workspacePath, force: upgraded });
        const after = await checkForUpdates(CLI_ENTRY);
        const summary = formatSetupSummary(setup);
        const text =
          before.installMode === "npx" && before.updateAvailable
            ? `${summary}\nTip: npx -y @imstudium/cli@latest for newest CLI`
            : `${upgradeNote}${summary}`.trim();
        output({ ...after, upgraded, setup, summary }, text);
      }),
    );

  const setup = program.command("setup").description("Idempotent agent wiring (skills, MCP) — only updates what changed");

  setup
    .command("status")
    .description("Show detected agents and setup manifest")
    .action(
      act(async () => {
        const sdk = await getSdk();
        const status = await getSetupStatus(sdk.workspacePath);
        const lines = [
          `Workspace: ${status.workspace}`,
          `Manifest: ${status.manifest ? status.manifest.updatedAt : "none"}`,
          `Up to date: ${status.upToDate ? "yes" : "no"}`,
          `Stale: ${status.stale ? "yes" : "no"}`,
          "",
          `Configured agents: ${status.configured.length ? status.configured.join(", ") : "none"}`,
          "",
          "Detected agents:",
          ...status.detected.map((a) => `  ${a.label} (${a.id}): ${a.plugin ? `skills from the ${a.plugin} plugin` : `skills in ${a.skillsDir}`}`),
        ];
        for (const g of status.staleByAgent) {
          const parts = [g.missing.length ? `not installed: ${g.missing.join(", ")}` : "", g.outdated.length ? `out of date: ${g.outdated.join(", ")}` : ""].filter(Boolean);
          lines.push("", `${g.labels.join(" / ")} skills, ${parts.join("; ")}`, `Run: imstudium setup all --agent ${g.agents[0]} -y`);
        }
        const ocr = ocrRuntimeView();
        lines.push("", `On-device OCR: ${ocr.ready ? `ready (${ocr.model})` : ocr.reason ?? "not ready"}${!ocr.ready && ocr.supported && !ocr.disabled ? " · imstudium setup ocr" : ""}`);
        output({ ...status, ocr }, lines.join("\n"));
      }),
    );

  setup
    .command("skills")
    .description("Install or refresh the bundled agent skills")
    .option("--agent <agent>", AGENT_HELP)
    .option("--all-agents", "Configure every harness, not only detected")
    .option("--force", "Overwrite unchanged skills")
    .option("-y, --yes", "Non-interactive")
    .action(
      act(async (opts: AgentOpts) => {
        const sdk = await getSdk();
        const result = await runSetup("skills", { yes: opts.yes, agent: agentOf(opts), workspace: sdk.workspacePath, allAgents: opts.allAgents, force: opts.force });
        output(result, formatSetupSummary(result));
      }),
    );

  setup
    .command("workflows")
    .description("Install or refresh agent workflows / slash commands")
    .option("--agent <agent>", AGENT_HELP)
    .option("--all-agents", "Configure every harness, not only detected")
    .option("--force", "Overwrite unchanged workflows")
    .action(
      act(async (opts: AgentOpts) => {
        const sdk = await getSdk();
        const result = await runSetup("workflows", { agent: agentOf(opts), workspace: sdk.workspacePath, allAgents: opts.allAgents, force: opts.force });
        output(result, formatSetupSummary(result));
      }),
    );

  withWorkspace(
    setup
      .command("mcp")
      .description("Register the imstudium MCP server with your agents (opt-in)")
      .option("--agent <agent>", AGENT_HELP)
      .option("--all-agents", "Configure every harness, not only detected")
      .option("--force", "Rewrite MCP config even if identical"),
  ).action(
    act(async (opts: AgentOpts) => {
      const sdk = await getSdk();
      const result = await runSetup("mcp", {
        agent: agentOf(opts),
        workspace: opts.output || opts.workspace || sdk.workspacePath,
        allAgents: opts.allAgents,
        force: opts.force,
      });
      output(result, formatSetupSummary(result));
    }),
  );

  setup
    .command("ocr")
    .description("Install on-device OCR for scanned pages and photos: pinned, SHA-256-verified PDFium + ONNX Runtime + PP-OCRv6 (~60 MB, once)")
    .option("--math", "Opt in to reading display formulas as LaTeX (PP-DocLayoutV2 + PP-FormulaNet+ L, ~1.1 GB once). Model readings: about four in five exact on lecture slides, each checked against the PDF and marked when it needs a look")
    .option("--force", "Download and verify everything again, models included")
    .option("--remove", "Delete the runtime and models (with --math: only the math part)")
    .action(
      act(async (opts: { math?: boolean; force?: boolean; remove?: boolean }) => {
        if (opts.force && opts.remove) throw new ImstudiumError("--force and --remove exclude each other", "BAD_ARGS");
        const started = Date.now();
        if (opts.remove) {
          const removed = opts.math ? { ...(await removeMathRuntime()), dir: mathRuntimeStatus().dir } : await removeOcrRuntime();
          const payload: SetupOcrOutput = {
            action: removed.removed ? "removed" : "absent",
            runtime: ocrRuntimeView(),
            installed: [],
            skipped: [],
            downloadedBytes: 0,
            diskBytes: removed.freedBytes,
            durationMs: Date.now() - started,
          };
          const what = opts.math ? "on-device math recognition" : "on-device OCR";
          output(payload, removed.removed ? `Removed ${what} (${formatBytes(removed.freedBytes)} freed) from ${removed.dir}` : `Nothing to remove in ${removed.dir}`);
          return;
        }
        const before = ocrRuntimeStatus();
        if (!before.supported) {
          throw new ImstudiumError(`No local OCR runtime for ${before.platform}`, "OCR_UNSUPPORTED", undefined, undefined, { platform: before.platform });
        }
        const result = await installOcrRuntime({ force: opts.force, onProgress: note });
        const installed = [...result.installed];
        const skipped = [...result.skipped];
        let downloadedBytes = result.downloadedBytes;
        if (opts.math) {
          if (!mathRuntimeStatus().ready) note(`math: up to ${formatBytes(mathRuntimeStatus().downloadBytes)} to download, once`);
          const math = await installMathRuntime({ force: opts.force, onProgress: note });
          installed.push(...math.installed);
          skipped.push(...math.skipped);
          downloadedBytes += math.downloadedBytes;
        }
        const runtime = ocrRuntimeView();
        const payload: SetupOcrOutput = {
          action: installed.length ? "installed" : "unchanged",
          runtime,
          installed,
          skipped,
          downloadedBytes,
          diskBytes: await ocrDiskBytes(runtime.dir),
          durationMs: Date.now() - started,
        };
        const lines = [
          installed.length
            ? `On-device OCR ready: ${installed.join(", ")} installed${downloadedBytes ? ` (${formatBytes(downloadedBytes)} downloaded, SHA-256 verified)` : ""}`
            : "On-device OCR already installed and verified",
          `  ${runtime.model} · PDFium ${runtime.pins.pdfium} · ONNX Runtime ${runtime.pins.onnxruntime} · ${formatBytes(payload.diskBytes)} in ${runtime.dir}`,
          runtime.math.ready
            ? `  Math: display formulas become $$…$$ LaTeX in content.md (${runtime.math.model}, ${runtime.math.layoutModel}). They are model readings: about four in five exact on lecture slides; the ones that need a look are marked (imstudium formulas list <file> --needs-look)`
            : "  Math: not installed (opt-in, ~1.1 GB): imstudium setup ocr --math. Formulas become LaTeX model readings, about four in five exact on lecture slides",
          runtime.disabled
            ? "  Switched off by IMSTUDIUM_OCR=off: unset it to use OCR"
            : "  Pages without a text layer and JPEG/PNG photos are read on this machine at the next extract (imstudium extract, or sync --extract)",
        ];
        output(payload, lines.join("\n"));
      }),
    );

  withWorkspace(
    setup
      .command("migrate")
      .description("Migrate DigiCampus config/skills/MCP to ImStudium (idempotent)")
      .option("--all-agents", "Configure every harness, not only detected")
      .option("-y, --yes", "Non-interactive"),
  ).action(
    act(async (opts: AgentOpts) => {
      const sdk = await getSdk();
      const migration = await ensureMigrated();
      const result = await runSetup("migrate", {
        yes: opts.yes,
        workspace: opts.output || opts.workspace || sdk.workspacePath,
        allAgents: opts.allAgents,
        force: true,
      });
      const archived = await archiveLegacyConfigDir();
      output(
        { migration, setup: result, archivedLegacyConfig: archived },
        [
          `Migration: ${migration.migrated.length ? migration.migrated.join(", ") : "already up to date"}`,
          formatSetupSummary(result),
          archived ? "Archived ~/.config/digicampus → digicampus.archived" : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }),
  );

  withWorkspace(
    setup
      .command("all")
      .description("Skills + workflows (idempotent — skips unchanged). MCP is opt-in: setup mcp")
      .option("--agent <agent>", AGENT_HELP)
      .option("--all-agents", "Configure every harness, not only detected")
      .option("--force", "Overwrite even when unchanged")
      .option("-y, --yes", "Non-interactive"),
  ).action(
    act(async (opts: AgentOpts) => {
      const sdk = await getSdk();
      const result = await runSetup("all", {
        yes: opts.yes,
        agent: agentOf(opts),
        workspace: opts.output || opts.workspace || sdk.workspacePath,
        allAgents: opts.allAgents,
        force: opts.force,
      });
      output(result, formatSetupSummary(result));
    }),
  );
}
