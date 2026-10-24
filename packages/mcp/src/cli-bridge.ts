import { spawn } from "node:child_process";
import { errorPayload } from "@imstudium/contract/errors";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { buildProgram } from "@imstudium/cli/program";

/**
 * The CLI is the product; MCP is a thin door to it. Every read-only command
 * an agent can run in a terminal is reachable here with the same JSON.
 *
 * The door is an allow-list of *leaf command paths* (what Commander would
 * actually run), not of first words: `semester` is allowed, `semester start`
 * is not, however the arguments are ordered.
 */
export const READ_ONLY_PATHS: ReadonlySet<string> = new Set([
  "status",
  "context",
  "today",
  "week",
  "stundenplan",
  "holidays",
  "tasks",
  "klausuren",
  "changes",
  "news",
  "inbox",
  "outbox",
  "message",
  "forum",
  "blubber",
  "feed",
  "search",
  "courseware",
  "wiki",
  "files tree",
  "courses list",
  "courses show",
  "studium",
  "people",
  "sprechstunden",
  "catalog search",
  "catalog areas",
  "catalog modules",
  "catalog studies",
  "semester",
  "routes",
  "api",
  "schema",
  "doctor",
  "arbeit",
  "arbeit list",
  "arbeit show",
  "arbeit check",
  "arbeit formvorgaben",
  "arbeit leitfaden",
  "arbeit hilfsmittel",
  "quellen",
  "quellen list",
  "quellen show",
  "quellen check",
  "quellen find",
  "quellen kurs",
  "quellen export",
  "zitieren",
  "literatur",
  "stile",
  "stile list",
  "stile show",
  "stile find",
]);

/**
 * Options that are refused on every command: they change which Stud.IP
 * origin receives the session (--instance), write files (-o/--output,
 * --workspace, --dir, --ics, --save, --force) or write upstream
 * (--write, -X/--method, -d/--data).
 */
export const BLOCKED_LONG = new Set(["--instance", "--output", "--workspace", "--dir", "--ics", "--write", "--save", "--force", "--data", "--method"]);
export const BLOCKED_SHORT = new Set(["-o", "-d", "-X"]);

const WHY: Record<string, string> = {
  "semester start": "semester start changes the workspace — run it in a terminal.",
  "files download": "files download writes to disk — run it in a terminal.",
};

type Cmd = ReturnType<typeof buildProgram>;

class Resolved {
  constructor(readonly leaf: Cmd) {}
}

function chain(cmd: Cmd): Cmd[] {
  const out: Cmd[] = [];
  for (let c: Cmd | null = cmd; c; c = c.parent as Cmd | null) out.unshift(c);
  return out;
}

/**
 * Parse `args` with the real CLI command tree (same arities, aliases,
 * attached values, `--x=y`, combined short flags) without running anything:
 * every action is replaced by one that only records which command Commander
 * picked. Returns the leaf command, "help" for help/version output, or the
 * Commander error message.
 */
function resolve(args: string[]): Resolved | "help" | { error: string } {
  const program = buildProgram();
  const silent = { writeOut: () => {}, writeErr: () => {}, outputError: () => {} };
  const all: Cmd[] = [];
  const visit = (c: Cmd) => {
    all.push(c);
    (c.commands as Cmd[]).forEach(visit);
  };
  visit(program);
  let picked: Cmd | null = null;
  for (const c of all) {
    c.exitOverride();
    c.configureOutput(silent);
    c.action(function (this: Cmd) {
      picked = this;
    });
  }
  try {
    program.parse(args, { from: "user" });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "commander.helpDisplayed" || code === "commander.help" || code === "commander.version") return "help";
    return { error: (e as Error).message.replace(/^error:\s*/i, "") };
  }
  return picked ? new Resolved(picked) : { error: "no command" };
}

export function checkArgs(args: string[]): string | null {
  const notAvailable = (what: string) =>
    `Not available over MCP: "${what}". Read-only commands: ${[...READ_ONLY_PATHS].join(", ")}.`;
  if (args.length === 0) return notAvailable("");

  // Defence in depth: a blocked long option is refused wherever it appears,
  // also as the value of another option (the root parses --instance anywhere).
  for (const a of args) {
    const long = a.startsWith("--") ? a.split("=")[0]! : "";
    if (BLOCKED_LONG.has(long)) return `${long} is not allowed over MCP (read-only door).`;
  }

  // The runner prepends --json; parse exactly what will run.
  const r = resolve(["--json", ...args]);
  if (r === "help") return null;
  if (!(r instanceof Resolved)) {
    const first = args.find((a) => !a.startsWith("-")) ?? args[0]!;
    return /unknown command|too many arguments|no command/i.test(r.error)
      ? notAvailable(first)
      : `Refused over MCP: ${r.error}`;
  }

  const cmds = chain(r.leaf);
  const path = cmds.slice(1).map((c) => c.name()).join(" ");
  if (WHY[path]) return WHY[path];
  if (!READ_ONLY_PATHS.has(path)) return notAvailable(path);

  // Every option the user set, on the leaf and its ancestors, by its real flags.
  for (const c of cmds) {
    for (const opt of c.options) {
      if (c.getOptionValueSource(opt.attributeName()) !== "cli") continue;
      if ((opt.long && BLOCKED_LONG.has(opt.long)) || (opt.short && BLOCKED_SHORT.has(opt.short))) {
        return `${opt.long ?? opt.short} is not allowed over MCP (read-only door).`;
      }
    }
  }
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
