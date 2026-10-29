import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { ImstudiumError, type StudiumExamDate, type StudiumWorkspace } from "@imstudium/sdk";
import type { KlausurenOutput } from "@imstudium/contract";
import { runOnboardFlow } from "../onboard-flow.js";
import { runSync, writeEchoSnapshot } from "../pipeline.js";
import { act, getSdk, globalOpts, note, output, type Sdk } from "../runtime.js";
import { outputOption, workspaceDir } from "../kit/args.js";
import { runLogin } from "./auth.js";

/** The configured semester for a sync: --all-semesters, --semester, config.semesterId, or the calendar-current one. */
export function semesterSyncOptions(sdk: Sdk, opts: { semester?: string; allSemesters?: boolean }) {
  if (opts.allSemesters) return { allSemesters: true as const };
  if (opts.semester) return { semesterLabel: opts.semester };
  if (sdk.config.semesterId) return { semesterId: sdk.config.semesterId };
  return {};
}

/** studium.json of the workspace, or WORKSPACE_MISSING. */
export async function requireWorkspace(sdk: Sdk, dir: string): Promise<StudiumWorkspace> {
  const ws = await sdk.studium.loadWorkspace(dir);
  if (!ws) {
    throw new ImstudiumError(`No Studium workspace at ${dir}`, "WORKSPACE_MISSING", undefined, "Run: imstudium semester start (or imstudium init)");
  }
  return ws;
}

export function registerWorkspace(program: Command): void {
  program
    .command("onboard")
    .description("First-time setup: login, sync workspace, wire agents (idempotent)")
    .addOption(outputOption("Workspace directory").default("~/Studium"))
    .option("-y, --yes", "Non-interactive")
    .option("--agents-only", "Skip login/sync — only configure Cursor, Claude Code, Claude Desktop, Codex, Windsurf, OpenCode")
    .option("--skip-sync", "Login + agent setup, no file sync")
    .option("--force", "Re-install skills/MCP even when unchanged")
    .option("--all-agents", "Configure every harness path, not only detected ones")
    .action(
      act(async (opts: { output?: string; yes?: boolean; agentsOnly?: boolean; skipSync?: boolean; force?: boolean; allAgents?: boolean }) => {
        const result = await runOnboardFlow({
          ...opts,
          json: globalOpts.json,
          quiet: globalOpts.quiet,
          instance: globalOpts.instance,
          runLogin: (sdk, onMessage) => runLogin(sdk, { onMessage }),
        });
        output(
          { workspace: result.workspace, report: result.report, studium: result.studium, setup: result.setup, summary: result.summary },
          `Onboarded → ${result.workspace}\n${result.summary}`,
        );
      }),
    );

  program
    .command("init")
    .description("Login + sync Studium workspace (use onboard for first-time agent setup)")
    .addOption(outputOption())
    .option("-y, --yes", "Non-interactive (skip prompts)")
    .option("--relogin", "Sign in again even if a session is already stored")
    .option("--chrome-profile", "Use your Chrome profile with saved passwords (quit Chrome first)")
    .option("--extract", "Extract new/changed files to markdown and rebuild the search index")
    .action(
      act(async (opts: { output?: string; yes?: boolean; relogin?: boolean; extract?: boolean; chromeProfile?: boolean }) => {
        const sdk = await getSdk();
        const out = workspaceDir(sdk, opts);
        const session = await sdk.auth.loadSession();
        if (!session || opts.relogin) {
          if (opts.yes && !session) throw new ImstudiumError("Not logged in.", "AUTH_REQUIRED", undefined, "Run: imstudium login");
          await runLogin(sdk, { chromeProfile: opts.chromeProfile });
        }
        await sdk.saveConfig({ workspacePath: out });
        const result = await runSync(sdk, { out, ...semesterSyncOptions(sdk, {}), extract: opts.extract, onProgress: note });
        const workspace = result.workspace!;
        const { files: _files, ...report } = result.report;
        output(
          { workspace, report, extracted: opts.extract ? result.extracted : undefined, next: "imstudium onboard --agents-only" },
          `Studium workspace ready at ${out} — ${workspace.activeSemester.title} in ${workspace.workspaceFolder}/${opts.extract ? ` · ${result.extracted} extracted` : ""}\nRun: imstudium onboard --agents-only  (once, idempotent)`,
        );
      }),
    );

  program
    .command("studium")
    .description("Show STUDIUM.md (human) or studium.json (--json)")
    .addOption(outputOption())
    .action(
      act(async (opts: { output?: string }) => {
        const sdk = await getSdk();
        const dir = workspaceDir(sdk, opts);
        if (globalOpts.json) {
          output(await requireWorkspace(sdk, dir));
          return;
        }
        const md = await readFile(join(dir, "STUDIUM.md"), "utf-8").catch(() => null);
        if (md === null) await requireWorkspace(sdk, dir);
        output(md);
      }),
    );

  program
    .command("klausuren")
    .description("Exam timeline (klausuren.md; --json from studium.json)")
    .addOption(outputOption())
    .action(
      act(async (opts: { output?: string }) => {
        const sdk = await getSdk();
        const dir = workspaceDir(sdk, opts);
        if (globalOpts.json) {
          const ws = await requireWorkspace(sdk, dir);
          const exams: StudiumExamDate[] = ws.courses.flatMap((c) => c.examDates);
          const payload: KlausurenOutput = { exams, nextDeadlines: ws.nextDeadlines };
          output(payload);
          return;
        }
        const md = await readFile(join(dir, "klausuren.md"), "utf-8").catch(() => null);
        if (md === null) await requireWorkspace(sdk, dir);
        output(md);
      }),
    );

  program
    .command("module")
    .description("Harness modules for mina — course/exam counts, no student id")
    .addOption(outputOption())
    .action(
      act(async (opts: { output?: string }) => {
        const sdk = await getSdk();
        const dir = workspaceDir(sdk, opts);
        const ws = await requireWorkspace(sdk, dir);
        const snapshot = await writeEchoSnapshot(dir, ws);
        const metrics = JSON.parse(await readFile(snapshot, "utf-8")).metrics as {
          courses: number;
          exams: number;
          nextDate: string | null;
          nextDays: number | null;
        };
        // Echo/mina module format: a fixed document of its own (always JSON, numeric schemaVersion).
        console.log(
          JSON.stringify(
            {
              schemaVersion: 1,
              leaf: "imstudium",
              pack: "studium",
              workspace: dir,
              snapshot,
              modules: [
                {
                  schemaVersion: 1,
                  id: "studium.courses",
                  pack: "studium",
                  title: "Courses",
                  description: "Count only — no student id",
                  kpis: [{ id: "courses", label: "Courses", value: metrics.courses }],
                  actions: [{ id: "klausuren", label: "Klausuren", cli: "imstudium klausuren --json", json: true }],
                  views: [{ id: "kpis", kind: "kpis", title: "Courses", cli: "imstudium klausuren --json" }],
                },
                {
                  schemaVersion: 1,
                  id: "studium.exams",
                  pack: "studium",
                  title: "Exams",
                  description: "Next date only — no titles in snapshot",
                  kpis: [
                    { id: "exams", label: "Exams", value: metrics.exams },
                    { id: "next", label: "Next date", value: metrics.nextDate },
                    { id: "days", label: "Days remaining", value: metrics.nextDays },
                  ],
                  actions: [{ id: "klausuren", label: "Klausuren", cli: "imstudium klausuren --json", json: true }],
                  views: [{ id: "kpis", kind: "kpis", title: "Exams", cli: "imstudium klausuren --json" }],
                },
              ],
            },
            null,
            2,
          ),
        );
      }),
    );
}
