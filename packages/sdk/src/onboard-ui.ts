import { createServer, type Server, type ServerResponse } from "node:http";
import { brandHeader, checkIcon, escapeHtml, pageShell } from "./ui.js";
import { openInSystemBrowser } from "./login-url.js";

export type OnboardStepId = "config" | "login" | "sync" | "studium" | "agents";
export type OnboardStepStatus = "pending" | "active" | "done" | "error" | "skipped";

export interface OnboardStep {
  id: OnboardStepId;
  title: string;
  description: string;
  status: OnboardStepStatus;
  detail?: string;
}

export interface OnboardUIState {
  schemaVersion: "1";
  phase: "running" | "complete" | "error";
  workspace: string;
  liveMessage?: string;
  error?: string;
  steps: OnboardStep[];
  summary?: {
    courses?: number;
    downloaded?: number;
    agents?: string[];
    workspacePath?: string;
  };
}

export const DEFAULT_ONBOARD_STEPS: OnboardStep[] = [
  {
    id: "config",
    title: "Workspace",
    description: "Save your Studium folder location",
    status: "pending",
  },
  {
    id: "login",
    title: "Sign in",
    description: "Authenticate with Stud.IP — MFA is supported",
    status: "pending",
  },
  {
    id: "sync",
    title: "Sync materials",
    description: "Download course files, wiki, news, and calendar",
    status: "pending",
  },
  {
    id: "studium",
    title: "Build workspace",
    description: "Generate studium.json and your study overview",
    status: "pending",
  },
  {
    id: "agents",
    title: "Wire AI tools",
    description: "Install skills and MCP for Cursor, Claude, Codex, and more",
    status: "pending",
  },
];

function renderStep(step: OnboardStep): string {
  const icon =
    step.status === "done" || step.status === "error"
      ? `<div class="is-ring"></div>`
      : step.status === "active"
        ? `<div class="is-ring"></div>`
        : `<div class="is-ring"></div>`;
  const detail = step.detail
    ? `<div class="is-step-detail">${escapeHtml(step.detail)}</div>`
    : "";
  return `<li class="is-step ${step.status}">
    <div class="is-step-icon">${icon}</div>
    <div class="is-step-body">
      <h3>${escapeHtml(step.title)}</h3>
      <p>${escapeHtml(step.description)}</p>
      ${detail}
    </div>
  </li>`;
}

export function buildOnboardHtml(state: OnboardUIState): string {
  const lead =
    state.phase === "complete"
      ? "You're all set. Your Studium workspace is ready for CLI and AI agents."
      : state.phase === "error"
        ? "Something went wrong. Check the message below and your terminal."
        : "Setting up your Studium workspace — this page updates live as each step completes.";

  const live = state.liveMessage
    ? `<p class="is-live">${escapeHtml(state.liveMessage)}</p>`
    : `<p class="is-live"></p>`;

  const statusBanner =
    state.phase === "complete"
      ? `<div class="is-status success">${checkIcon()}<p>Setup complete</p></div>`
      : state.phase === "error"
        ? `<div class="is-status error"><p>${escapeHtml(state.error || "Setup failed")}</p></div>`
        : "";

  const summary =
    state.phase === "complete" && state.summary
      ? `<div class="is-summary">
          <strong>Ready to study</strong>
          ${state.summary.workspacePath ? `Workspace: <code>${escapeHtml(state.summary.workspacePath)}</code><br/>` : ""}
          ${state.summary.courses != null ? `${state.summary.courses} courses · ` : ""}
          ${state.summary.downloaded != null ? `${state.summary.downloaded} files synced · ` : ""}
          ${state.summary.agents?.length ? `Agents: ${escapeHtml(state.summary.agents.join(", "))}` : ""}
        </div>`
      : "";

  const body = `<main class="is-card">
    ${brandHeader("Studium OS setup")}
    <p class="is-lead">${lead}</p>
    ${statusBanner}
    ${live}
    <ol class="is-steps">${state.steps.map(renderStep).join("")}</ol>
    ${summary}
    <p class="is-footer">Runs only on your machine — materials stay local.</p>
  </main>
  <script>
    (function () {
      if (${JSON.stringify(state.phase)} !== "running") return;
      const es = new EventSource("/events");
      es.onmessage = function () { location.reload(); };
      es.onerror = function () { setTimeout(function () { location.reload(); }, 1500); };
    })();
  </script>`;

  return pageShell("ImStudium — Setup", body);
}

export class OnboardUI {
  private state: OnboardUIState;
  private server: Server | null = null;
  private sseClients = new Set<ServerResponse>();
  private url = "";

  constructor(workspace: string, steps: OnboardStep[] = DEFAULT_ONBOARD_STEPS) {
    this.state = {
      schemaVersion: "1",
      phase: "running",
      workspace,
      steps: steps.map((s) => ({ ...s })),
    };
  }

  getState(): OnboardUIState {
    return structuredClone(this.state);
  }

  configureForAgentsOnly(): void {
    for (const id of ["login", "sync", "studium"] as OnboardStepId[]) {
      this.updateStep(id, { status: "skipped", detail: "Skipped" });
    }
  }

  setLiveMessage(message: string): void {
    this.state.liveMessage = message;
    this.broadcast();
  }

  updateStep(id: OnboardStepId, patch: Partial<OnboardStep>): void {
    const step = this.state.steps.find((s) => s.id === id);
    if (!step) return;
    Object.assign(step, patch);
    this.broadcast();
  }

  complete(summary: OnboardUIState["summary"]): void {
    this.state.phase = "complete";
    this.state.summary = summary;
    this.state.liveMessage = undefined;
    this.broadcast();
  }

  fail(error: string): void {
    this.state.phase = "error";
    this.state.error = error;
    this.broadcast();
  }

  private broadcast(): void {
    const payload = `data: ${JSON.stringify(this.state)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(payload);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  async start(openBrowser = true): Promise<string> {
    if (this.server) return this.url;

    this.server = createServer((req, res) => {
      const path = (req.url || "/").split("?")[0];

      if (path === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify(this.state)}\n\n`);
        this.sseClients.add(res);
        req.on("close", () => this.sseClients.delete(res));
        return;
      }

      if (path === "/" || path === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildOnboardHtml(this.state));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = this.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    this.url = `http://127.0.0.1:${port}/`;

    if (openBrowser) {
      await openInSystemBrowser(this.url);
    }

    return this.url;
  }

  async close(): Promise<void> {
    for (const res of this.sseClients) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    this.sseClients.clear();

    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
    this.server = null;
    this.url = "";
  }

  async closeAfter(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
    await this.close();
  }
}
