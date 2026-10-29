import type { Command } from "commander";
import { computeSemesterProgress, SemestersResource } from "@imstudium/sdk";
import { act, getSdk, output } from "../runtime.js";

/**
 * Older commands kept for scripts that call them. Newer equivalents:
 * `semesters` → `semester`, `discover` → `routes`.
 */
export function registerLegacy(program: Command): void {
  program
    .command("semesters")
    .description("List Stud.IP semesters and show the calendar-current one (see also: semester)")
    .action(
      act(async () => {
        const sdk = await getSdk();
        const semesters = new SemestersResource(sdk.client);
        const all = await semesters.listAll();
        const current = await semesters.getCurrent();
        const progress = current ? computeSemesterProgress(current) : undefined;
        output(
          {
            current: current
              ? { id: current.id, title: current.attributes?.title, start: current.attributes?.start, end: current.attributes?.end, ...progress }
              : null,
            semesters: all.slice(-12).map((s) => ({
              id: s.id,
              title: s.attributes?.title,
              start: s.attributes?.start,
              end: s.attributes?.end,
              current: s.id === current?.id,
            })),
          },
          [
            current
              ? `Current: ${current.attributes?.title} (${current.id})${progress ? ` — week ${progress.weekNumber}, day ${progress.daysElapsed}/${progress.daysTotal} (${progress.progressPercent}%)` : ""}`
              : "No current semester",
            'Default sync/studium/courses commands focus on this semester. Use --semester "<name>" or --all-semesters for others.',
            "",
            ...all.slice(-8).map((s) => `${s.attributes?.title}${s.id === current?.id ? " ← current" : ""}`),
          ].join("\n"),
        );
      }),
    );

  program
    .command("discover")
    .description("List JSON:API routes (see also: routes)")
    .action(
      act(async () => {
        const sdk = await getSdk();
        const routes = await sdk.discovery.listRoutes();
        output({ routes, count: routes.length }, [`${routes.length} routes (imstudium routes filters and groups them)`, ...routes.map((r) => `  ${r.methods.join(",").padEnd(18)} ${r.pattern}`)].join("\n"));
      }),
    );
}
