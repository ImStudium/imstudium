import type { Command } from "commander";
import { registerApi } from "./api.js";
import { registerAuth } from "./auth.js";
import { registerCatalog } from "./catalog.js";
import { registerCommunication } from "./communication.js";
import { registerConfig } from "./config.js";
import { registerContent } from "./content.js";
import { registerContext } from "./context.js";
import { registerCourses } from "./courses.js";
import { registerDoctor } from "./doctor.js";
import { registerLegacy } from "./legacy.js";
import { registerPeople } from "./people.js";
import { registerPlanning } from "./planning.js";
import { registerSchema } from "./schema.js";
import { registerSearch } from "./search.js";
import { registerSemester } from "./semester.js";
import { registerSetup } from "./setup.js";
import { registerSprechstunden } from "./sprechstunden.js";
import { registerSync } from "./sync.js";
import { registerWorkspace } from "./workspace.js";

/**
 * Every command module. Each file owns one area and registers its commands
 * on the root program; help order is set in program.ts (HELP_ORDER), so the
 * order here does not matter.
 */
export const COMMAND_MODULES: Array<(program: Command) => void> = [
  registerAuth,
  registerWorkspace,
  registerContext,
  registerPlanning,
  registerContent,
  registerCommunication,
  registerSearch,
  registerCourses,
  registerPeople,
  registerSprechstunden,
  registerCatalog,
  registerSemester,
  registerSync,
  registerApi,
  registerSchema,
  registerSetup,
  registerConfig,
  registerDoctor,
  registerLegacy,
];

export function registerCommands(program: Command): void {
  for (const register of COMMAND_MODULES) register(program);
}
