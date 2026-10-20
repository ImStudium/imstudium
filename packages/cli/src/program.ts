import { Command } from "commander";
import { registerCommands } from "./commands/index.js";
import { commanderExit, commanderOutput, globalOpts, type GlobalOpts } from "./runtime.js";
import { getCliVersion } from "./version.js";

/**
 * Help lists commands in the order of a student's day, not in registration
 * order: start → today → what's new → material → workspace → API → setup.
 * Anything not listed (a new command) goes last until it is placed here.
 */
export const HELP_ORDER = [
  // start
  "onboard", "init", "login", "logout", "status", "context",
  // today and deadlines
  "today", "week", "stundenplan", "holidays", "tasks", "klausuren",
  // what's new
  "changes", "news", "inbox", "outbox", "message", "forum", "blubber", "feed",
  // material and courses
  "search", "courseware", "wiki", "files", "courses", "studium", "people", "sprechstunden", "catalog",
  // workspace and sync
  "semester", "sync", "extract", "index", "view", "watch", "export",
  // Stud.IP API and contracts
  "routes", "api", "schema",
  // setup and health
  "setup", "config", "session", "doctor", "update",
  // legacy
  "module", "semesters", "discover",
] as const;

/**
 * The whole command tree, with no side effects at import: nothing parses
 * argv, touches the network or reads config until `parseAsync` runs an
 * action. Tests and the docs generator build it the same way.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("imstudium")
    .description("ImStudium — extract, sync, and plan your studies")
    .version(getCliVersion())
    .option("--json", "JSON output for agents (one document on stdout; errors as JSON on stderr)")
    .option("--quiet", "Minimal output")
    .option("--instance <url>", "Stud.IP instance origin (default: digicampus.uni-augsburg.de)")
    .exitOverride(commanderExit)
    .configureOutput(commanderOutput)
    .hook("preAction", (thisCommand) => {
      Object.assign(globalOpts, thisCommand.opts() as GlobalOpts);
    });

  registerCommands(program);

  const rank = new Map<string, number>(HELP_ORDER.map((n, i) => [n, i]));
  (program.commands as Command[]).sort((a, b) => (rank.get(a.name()) ?? 999) - (rank.get(b.name()) ?? 999));
  return program;
}
