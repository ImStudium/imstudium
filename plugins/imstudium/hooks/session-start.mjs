#!/usr/bin/env node
// ImStudium SessionStart hook (Claude Code).
//
// Only inside the study workspace — a folder that is, or sits under, one holding
// `studium.json` — it adds the offline briefing (`imstudium context --offline`) to the
// session. Everywhere else it prints nothing. It never touches the network or
// Stud.IP, never fails the session, and gives up after a few seconds.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const TIMEOUT_MS = 6000;

function readStdin() {
  return new Promise((done) => {
    if (process.stdin.isTTY) return done("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => done(data));
    process.stdin.on("error", () => done(""));
    setTimeout(() => done(data), 1000).unref();
  });
}

/** The nearest folder at or above `start` that holds studium.json. */
function findWorkspace(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "studium.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function run(cmd, args) {
  return new Promise((done) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: 1 << 20 }, (err, stdout) => {
      done(err ? null : String(stdout).trim());
    });
  });
}

async function main() {
  let input = {};
  try {
    input = JSON.parse((await readStdin()) || "{}");
  } catch {
    input = {};
  }
  const workspace = findWorkspace(input.cwd || process.cwd());
  if (!workspace) return;

  const briefing = await run("imstudium", ["context", "--offline", "-o", workspace]);
  if (!briefing) return;

  const additionalContext = [
    `ImStudium study workspace: ${workspace}`,
    "Offline briefing (local files only — `imstudium context --json` refreshes from Stud.IP):",
    "",
    briefing,
    "",
    "Use the imstudium skills; CLI first (`imstudium <command> --json`). Never run sync, semester start, setup or login unasked.",
  ].join("\n");

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }),
  );
}

main().catch(() => {
  // A study briefing is a nicety; never break the session over it.
});
