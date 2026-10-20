import { spawn } from "node:child_process";
import { errorPayload } from "@imstudium/contract/errors";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The CLI is the product; MCP is a thin door to it. Every read-only command
 * an agent can run in a terminal is reachable here with the same JSON.
 */
export const READ_ONLY_COMMANDS = new Set([
  "context",
  "today",
  "week",
  "stundenplan",
  "holidays",
  "tasks",
  "klausuren",
  "changes",
  "news",
  "feed",
  "inbox",
  "outbox",
  "message",
  "forum",
  "blubber",
  "courseware",
  "cw",
  "wiki",
  "files",
  "people",
  "sprechstunden",
  "catalog",
  "search",
  "semester",
  "studium",
  "routes",
  "api",
  "status",
  "doctor",
  "courses",
]);

const BLOCKED_FLAGS = /^(--write|--save|-X|--method|--data|-d|--force)(=|$)/;

export function checkArgs(args: string[]): string | null {
  const [command, sub] = args;
  if (!command || !READ_ONLY_COMMANDS.has(command)) {
    return `Not available over MCP: "${command ?? ""}". Read-only commands: ${[...READ_ONLY_COMMANDS].join(", ")}.`;
  }
  if (command === "semester" && sub === "start") return "semester start changes the workspace — run it in a terminal.";
  if (command === "files" && sub === "download") return "files download writes to disk — run it in a terminal.";
  const blocked = args.find((a) => BLOCKED_FLAGS.test(a));
  if (blocked) return `${blocked} is not allowed over MCP (read-only door).`;
  return null;
}

function resolveCli(): { cmd: string; pre: string[] } {
  const explicit = process.env.IMSTUDIUM_CLI;
  if (explicit) return explicit.endsWith(".js") ? { cmd: process.execPath, pre: [explicit] } : { cmd: explicit, pre: [] };
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("@imstudium/cli/package.json");
    const entry = join(dirname(pkg), "dist", "cli.js");
    if (existsSync(entry)) return { cmd: process.execPath, pre: [entry] };
  } catch {
    // not installed next to the MCP server
  }
  const local = join(homedir(), ".local", "bin", "imstudium");
  if (existsSync(local)) return { cmd: local, pre: [] };
  return { cmd: "imstudium", pre: [] };
}

export async function runCli(args: string[], timeoutMs = 120_000): Promise<{ ok: boolean; json: unknown; stderr: string }> {
  const { cmd, pre } = resolveCli();
  return new Promise((resolve) => {
    const child = spawn(cmd, [...pre, "--json", ...args], {
      env: { ...process.env, IMSTUDIUM_NO_SILENT_REFRESH: process.env.IMSTUDIUM_NO_SILENT_REFRESH ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      let json: unknown = null;
      const text = out.trim() || err.trim();
      try {
        json = JSON.parse(text.slice(text.indexOf("{")));
      } catch {
        json = { output: text };
      }
      resolve({ ok: code === 0, json, stderr: err.slice(-2000) });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, json: errorPayload({ code: "CLI_NOT_FOUND", message: e.message }), stderr: "" });
    });
  });
}
