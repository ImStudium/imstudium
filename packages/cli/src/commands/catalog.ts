import type { Command } from "commander";
import { ImstudiumError, type CatalogCourse } from "@imstudium/sdk";
import { act, getSdk, output } from "../runtime.js";
import { resolveSemester } from "./planning.js";

/** "INF-1001  Datenbanken  · Vorlesung · 120 Teilnehmende" + lecturers / dates / id lines. */
export function formatCatalogCourse(c: CatalogCourse): string[] {
  const meta = [c.typeName, c.memberCount != null ? `${c.memberCount} Teilnehmende` : null].filter(Boolean).join(" · ");
  const lines = [`${c.number ? `${c.number}  ` : ""}${c.title}${meta ? `  · ${meta}` : ""}`];
  if (c.lecturers?.length) lines.push(`    ${c.lecturers.join(", ")}`);
  for (const d of c.dates ?? []) lines.push(`    ${d}`);
  if (c.admission) lines.push(`    ${c.admission}`);
  lines.push(`    id ${c.id}`);
  return lines;
}

export function registerCatalog(program: Command): void {
  const catalog = program.command("catalog").description("Course catalog for semester planning (Vorlesungsverzeichnis)");

  catalog
    .command("search")
    .description("Search a semester's courses by title or number (public, works without login)")
    .argument("<query...>", "At least 3 characters")
    .option("--semester <name>", 'Semester, e.g. "WS 2026/27" or "all" (default: current)')
    .option("--area <id>", "Only inside this study area (see catalog areas)")
    .option("--by <field>", "Search via /courses (login): all, title, lecturer, number, comment")
    .option("--limit <n>", "Max results", "15")
    .option("--no-details", "Skip lecturers and dates (faster)")
    .action(
      act(async (queryParts: string[], opts: { semester?: string; area?: string; by?: string; limit: string; details: boolean }) => {
        const sdk = await getSdk();
        const q = queryParts.join(" ").trim();
        const semester = await resolveSemester(sdk, opts.semester);
        const fields = opts.by as "all" | "title" | "lecturer" | "number" | "comment" | undefined;
        const result = await sdk.catalog.search({
          q,
          semesterId: semester?.id,
          areaId: opts.area,
          limit: Number(opts.limit) || 15,
          source: fields ? "courses" : "tree",
          fields,
        });
        if (opts.details) {
          await Promise.all(
            result.courses.map(async (c) => {
              try {
                const d = await sdk.catalog.details(c.id);
                c.lecturers = d.lecturers.map((l) => l.name);
                c.dates = d.dates;
                c.admission = d.admission;
              } catch {
                // details are a bonus
              }
            }),
          );
        }
        const total = result.total ?? result.courses.length;
        const lines = [
          `Katalog · "${q}" · ${semester?.title ?? "alle Semester"} · ${total} Treffer${total > result.courses.length ? ` (zeige ${result.courses.length})` : ""}`,
          "",
          ...result.courses.flatMap(formatCatalogCourse),
        ];
        if (!result.courses.length) lines.push("Keine Treffer.");
        output({ query: q, semester, source: result.source, total: result.total, courses: result.courses }, lines.join("\n"));
      }),
    );

  catalog
    .command("areas")
    .description("Browse study areas (Studienbereiche); --courses lists a subtree's courses")
    .argument("[id]", "Study area id (default: top level)")
    .option("--courses", "List the area's courses for the semester")
    .option("--semester <name>", "Semester for --courses (default: current)")
    .option("--limit <n>", "Max courses", "40")
    .action(
      act(async (id: string | undefined, opts: { courses?: boolean; semester?: string; limit: string }) => {
        const sdk = await getSdk();
        const node = id ? await sdk.catalog.studyArea(id) : null;
        if (opts.courses) {
          if (!id) throw new ImstudiumError("--courses needs a study area id", "BAD_ARGS", undefined, "imstudium catalog areas shows ids");
          const semester = await resolveSemester(sdk, opts.semester);
          const res = await sdk.catalog.studyAreaCourses(id, { semesterId: semester?.id, limit: Number(opts.limit) || 40 });
          const lines = [
            `${node?.path.join(" › ") ?? id} · ${semester?.title ?? "alle Semester"} · ${res.total ?? res.courses.length} Veranstaltungen`,
            "",
            ...res.courses.map((c) => `${c.number ? `${c.number}  ` : ""}${c.title}${c.typeName ? ` · ${c.typeName}` : ""}  [${c.id}]`),
          ];
          output({ area: node, semester, total: res.total, courses: res.courses }, lines.join("\n"));
          return;
        }
        const children = await sdk.catalog.studyAreaChildren(id);
        const lines = [node ? node.path.join(" › ") : "Studienbereiche", ""];
        for (const c of children) lines.push(`${c.hasChildren ? "›" : " "} ${c.name}  [${c.id}]`);
        if (!children.length) lines.push("(keine Unterbereiche — --courses listet die Veranstaltungen)");
        output({ area: node, children }, lines.join("\n"));
      }),
    );

  catalog
    .command("modules")
    .description("Modules (MVV) by name or code — needs login")
    .argument("[query...]", "Name or module code, at least 3 characters")
    .option("--semester <name>", 'Only modules valid in this semester (default: current; "all" for any)')
    .option("--limit <n>", "Max results", "30")
    .action(
      act(async (queryParts: string[], opts: { semester?: string; limit: string }) => {
        const sdk = await getSdk();
        const q = queryParts.join(" ").trim() || undefined;
        const semester = await resolveSemester(sdk, opts.semester);
        const res = await sdk.catalog.modules({ q, semesterId: semester?.id, limit: Number(opts.limit) || 30 });
        const lines = [`Module${q ? ` · "${q}"` : ""} · ${semester?.title ?? "alle Semester"} · ${res.total ?? res.modules.length} Treffer`, ""];
        for (const m of res.modules) {
          const meta = [m.cp != null ? `${m.cp} LP` : null, m.cycle, m.responsible].filter(Boolean).join(" · ");
          lines.push(`${m.code ? `${m.code}  ` : ""}${m.name}${meta ? `  · ${meta}` : ""}`);
        }
        output({ query: q ?? null, semester, total: res.total, modules: res.modules }, lines.join("\n"));
      }),
    );

  catalog
    .command("studies")
    .description("Courses of study (Studiengänge) — needs login")
    .argument("[query...]", "Name, at least 3 characters")
    .option("--limit <n>", "Max results", "30")
    .action(
      act(async (queryParts: string[], opts: { limit: string }) => {
        const sdk = await getSdk();
        const q = queryParts.join(" ").trim() || undefined;
        const res = await sdk.catalog.coursesOfStudy({ q, limit: Number(opts.limit) || 30 });
        const lines = [`Studiengänge${q ? ` · "${q}"` : ""} · ${res.total ?? res.courses.length} Treffer`, ""];
        for (const c of res.courses) lines.push(`${c.displayName ?? c.name}${c.status ? ` · ${c.status}` : ""}  [${c.id}]`);
        output({ query: q ?? null, total: res.total, courses: res.courses }, lines.join("\n"));
      }),
    );
}
