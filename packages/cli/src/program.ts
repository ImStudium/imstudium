import { Command } from "commander";
import { registerCommands } from "./commands/index.js";
import { commanderExit, commanderOutput, globalOpts, type GlobalOpts } from "./runtime.js";
import { getCliVersion } from "./version.js";

/**
 * Help lists commands in the order of a student's day, not in registration
 * order. The groups also structure docs/COMMANDS.md. A new top-level command
 * must be placed here (structure.test.ts fails otherwise).
 */
export const HELP_GROUPS: ReadonlyArray<{ title: string; commands: readonly string[] }> = [
  { title: "Start", commands: ["onboard", "init", "login", "logout", "status", "context"] },
  { title: "Today and deadlines", commands: ["today", "week", "stundenplan", "holidays", "tasks", "klausuren"] },
  { title: "What's new", commands: ["changes", "news", "inbox", "outbox", "message", "forum", "blubber", "feed"] },
  { title: "Material and courses", commands: ["search", "courseware", "wiki", "files", "courses", "studium", "people", "sprechstunden", "catalog"] },
  { title: "Writing and citing", commands: ["arbeit", "quellen", "zitieren", "literatur", "stile"] },
  { title: "Workspace and sync", commands: ["semester", "sync", "extract", "formulas", "index", "view", "watch", "export"] },
  { title: "Stud.IP API and contracts", commands: ["routes", "api", "schema"] },
  { title: "Setup and health", commands: ["setup", "config", "session", "doctor", "update"] },
  { title: "Legacy", commands: ["module", "semesters", "discover"] },
];

export const HELP_ORDER: readonly string[] = HELP_GROUPS.flatMap((g) => g.commands);

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
  leafOptionsWin(program);

  const rank = new Map<string, number>(HELP_ORDER.map((n, i) => [n, i]));
  (program.commands as Command[]).sort((a, b) => (rank.get(a.name()) ?? 999) - (rank.get(b.name()) ?? 999));
  return program;
}

/**
 * A subcommand reads its own options. Commander lets a parent parse its
 * options anywhere on the line, so `quellen add --arbeit zweite` handed
 * --arbeit to `quellen` and `add` never saw it (likewise -o, --tag,
 * --status). Every command with subcommands stops reading options at the
 * subcommand's name. The root keeps parsing --json, --quiet and --instance
 * anywhere, but passes everything after such a command's name on unparsed:
 * Commander would otherwise hand the parent the words before the first
 * unknown option as operands, and the parent would never see the
 * subcommand's name first. A parent option written before the subcommand's
 * name still reaches the subcommand through act() (runtime.ts).
 */
function leafOptionsWin(program: Command): void {
  const positional = (cmd: Command) => {
    for (const sub of cmd.commands as Command[]) {
      if (!sub.commands.length) continue;
      sub.enablePositionalOptions();
      positional(sub);
    }
  };
  positional(program);

  const parseOptions = program.parseOptions.bind(program);
  program.parseOptions = (argv: string[]) => {
    const parsed = parseOptions(argv);
    const [name, ...rest] = parsed.operands;
    if (!name || !rest.length || argv.includes("--")) return parsed;
    const cmd = (program.commands as Command[]).find((c) => c.name() === name || c.aliases().includes(name));
    if (!cmd?.commands.length) return parsed;
    return { operands: [name], unknown: [...rest, ...parsed.unknown] };
  };
}
