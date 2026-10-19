import type { Command } from "commander";
import { registerApi } from "./api.js";
import { registerSemester } from "./semester.js";
import { registerSearch } from "./search.js";
import { registerCommunication } from "./communication.js";
import { registerContent } from "./content.js";
import { registerPlanning } from "./planning.js";

/**
 * Command modules. Each file owns one area of Stud.IP and registers its
 * commands on the root program; cli.ts keeps the original core commands.
 */
export function registerCommands(program: Command): void {
  registerApi(program);
  registerSemester(program);
  registerSearch(program);
  registerCommunication(program);
  registerContent(program);
  registerPlanning(program);
}
