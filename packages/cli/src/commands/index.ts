import type { Command } from "commander";
import { registerApi } from "./api.js";

/**
 * Command modules. Each file owns one area of Stud.IP and registers its
 * commands on the root program; cli.ts keeps the original core commands.
 */
export function registerCommands(program: Command): void {
  registerApi(program);
}
