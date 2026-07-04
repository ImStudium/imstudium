import {
  createSdk,
  ImstudiumError,
  expandPath,
  OnboardUI,
  type StudiumWorkspace,
} from "@imstudium/sdk";
import { formatSetupSummary, runSetup, type SetupResult } from "./setup.js";

export interface OnboardFlowOpts {
  output?: string;
  yes?: boolean;
  agentsOnly?: boolean;
  skipSync?: boolean;
  force?: boolean;
  allAgents?: boolean;
  json?: boolean;
  quiet?: boolean;
  instance?: string;
  runLogin: (
    sdk: Awaited<ReturnType<typeof createSdk>>,
    onMessage?: (text: string) => void,
  ) => Promise<void>;
}

export interface OnboardFlowResult {
  workspace: string;
  report?: Awaited<ReturnType<Awaited<ReturnType<typeof createSdk>>["sync"]["sync"]>>;
  studium?: StudiumWorkspace;
  setup: SetupResult;
  summary: string;
}

function shouldShowOnboardUI(opts: OnboardFlowOpts): boolean {
  return !opts.json && !opts.quiet && !opts.yes;
}

export async function runOnboardFlow(opts: OnboardFlowOpts): Promise<OnboardFlowResult> {
  const partial = opts.instance
    ? {
        baseUrl: `${opts.instance.replace(/\/$/, "")}/jsonapi.php/v1`,
        instanceOrigin: opts.instance.replace(/\/$/, ""),
      }
    : undefined;
  const sdk = await createSdk(partial);
  const out = expandPath(opts.output || sdk.workspacePath);
  await sdk.saveConfig({ workspacePath: out });

  const ui = shouldShowOnboardUI(opts) ? new OnboardUI(out) : null;
  if (ui && opts.agentsOnly) ui.configureForAgentsOnly();

  try {
    if (ui) await ui.start(true);

    ui?.updateStep("config", { status: "active" });
    ui?.updateStep("config", { status: "done", detail: out });

    let report: OnboardFlowResult["report"];
    let studium: StudiumWorkspace | undefined;

    if (!opts.agentsOnly) {
      const session = await sdk.auth.loadSession();
      if (!session) {
        if (opts.yes) {
          throw new ImstudiumError(
            "Not logged in.",
            "NO_SESSION",
            undefined,
            "Run: imstudium login",
          );
        }
        ui?.updateStep("login", { status: "active" });
        ui?.setLiveMessage("Opening sign-in browser — complete MFA if prompted…");
        await opts.runLogin(sdk, (text) => ui?.setLiveMessage(text));
        ui?.updateStep("login", { status: "done", detail: "Signed in" });
      } else {
        ui?.updateStep("login", { status: "skipped", detail: "Already signed in" });
      }

      if (!opts.skipSync) {
        ui?.updateStep("sync", { status: "active" });
        ui?.setLiveMessage("Downloading course files from Stud.IP…");
        const semOpts = {
          semesterId: sdk.config.semesterId,
        };
        report = await sdk.sync.sync({
          outputDir: out,
          include: ["wiki", "news", "calendar"],
          ...semOpts,
        });
        ui?.updateStep("sync", {
          status: "done",
          detail: `${report.downloaded} downloaded · ${report.skipped} unchanged`,
        });

        ui?.updateStep("studium", { status: "active" });
        ui?.setLiveMessage("Building studium.json and study overview…");
        studium = await sdk.studium.build(out, sdk.config.instanceOrigin, semOpts);
        ui?.updateStep("studium", {
          status: "done",
          detail: `${studium.courses.length} courses`,
        });
      } else {
        ui?.updateStep("sync", { status: "skipped", detail: "--skip-sync" });
        ui?.updateStep("studium", { status: "skipped", detail: "--skip-sync" });
      }
    }

    ui?.updateStep("agents", { status: "active" });
    ui?.setLiveMessage("Installing skills and MCP for detected AI tools…");
    const setup = await runSetup("all", {
      yes: opts.yes,
      workspace: out,
      force: opts.force,
      allAgents: opts.allAgents,
    });
    const summary = formatSetupSummary(setup);
    ui?.updateStep("agents", { status: "done", detail: setup.agents.join(", ") || "none" });
    ui?.complete({
      workspacePath: out,
      courses: studium?.courses.length,
      downloaded: report?.downloaded,
      agents: setup.agents,
    });

    if (ui) {
      await ui.closeAfter(12_000);
    }

    return { workspace: out, report, studium, setup, summary };
  } catch (err) {
    const message =
      err instanceof ImstudiumError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    ui?.fail(message);
    if (ui) await ui.closeAfter(8_000);
    throw err;
  }
}
