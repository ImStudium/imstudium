import { Option, type Command } from "commander";
import { archiveLegacyConfigDir, ensureMigrated, ImstudiumError } from "@imstudium/sdk";
import { formatSetupSummary, getSetupStatus, runSetup, type AgentId } from "../setup.js";
import { checkForUpdates, runGlobalUpdate } from "../version.js";
import { act, getSdk, output } from "../runtime.js";
import { outputOption } from "../kit/args.js";
import { CLI_ENTRY } from "../entry.js";

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
          ...status.detected.map((a) => `  ${a.label} (${a.id}) — skills: ${a.skillsDir}`),
        ];
        if (status.staleSkills.length) lines.push("", `Stale skills: ${status.staleSkills.join(", ")}`, "Run: imstudium setup all -y");
        output(status, lines.join("\n"));
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
