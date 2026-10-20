import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createSdk, expandPath, extractSlug, ImstudiumError, normalizeStudiumWorkspace, pageRef, pickCourse, resolveCourseDir, agentSearchGuidance, toImstudiumError, type StudiumWorkspace } from "@imstudium/sdk";
import type { ErrorBody, KlausurenOutput } from "@imstudium/contract";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { MCP_TOOLS } from "./tools.js";
import { materialVisualPayload } from "./visual.js";
import { checkArgs, runCli } from "./cli-bridge.js";

const server = new Server(
  { name: "imstudium", version: (createRequire(import.meta.url)("../package.json") as { version: string }).version },
  { capabilities: { tools: {} } },
);

let workspacePath =
  process.env.IMSTUDIUM_WORKSPACE || process.env.DIGICAMPUS_WORKSPACE || "";
let sdkPromise: ReturnType<typeof createSdk> | null = null;

async function getSdk() {
  if (!sdkPromise) sdkPromise = createSdk();
  const sdk = await sdkPromise;
  if (!workspacePath) workspacePath = expandPath(sdk.workspacePath);
  return sdk;
}

function jsonText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** Every failure: the contract error body (docs/ERRORS.md) with isError set. */
function errorResult(e: unknown) {
  const body: ErrorBody = toImstudiumError(e).toJSON();
  return { ...jsonText(body), isError: true };
}

function courseNotFound(query: string, ws: StudiumWorkspace): ImstudiumError {
  return new ImstudiumError(`No course matches "${query}"`, "COURSE_NOT_FOUND", 404, "Pass a title fragment, shortcut or id from details.available", {
    available: ws.courses.map((c) => c.title),
  });
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...MCP_TOOLS],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "imstudium") {
    const cliArgs = ((args as { args?: unknown })?.args ?? []) as unknown[];
    const list = cliArgs.map(String);
    const refused = checkArgs(list);
    if (refused) return errorResult(new ImstudiumError(refused, "WRITE_NOT_ALLOWED", undefined, "Run it in a terminal"));
    const res = await runCli(list);
    return { ...jsonText(res.json), ...(res.ok ? {} : { isError: true }) };
  }

  try {
    const sdk = await getSdk();

    switch (name) {
      case "studium_overview": {
        const ws = await loadWorkspace(sdk);
        const focusId = ws.activeSemester?.id;
        return jsonText({
          activeSemester: ws.activeSemester,
          otherSemesters: ws.otherSemesters,
          search: ws.search,
          searchGuidance: agentSearchGuidance(workspacePath, ws),
          focusCourses: ws.courses.filter((c) => !focusId || c.semesterId === focusId),
          allCourses: ws.courses,
          nextDeadlines: ws.nextDeadlines,
          hint: "Default to focusCourses. Find content: grep/semantic-search corpus.jsonl (see searchGuidance). Paths: course.path + search/materials.json. Text extraction has no LaTeX — see searchGuidance.extractionLimits.",
        });
      }

      case "studium_klausuren": {
        const ws = await loadWorkspace(sdk);
        const exams = ws.courses.flatMap((c) =>
          c.examDates.map((e) => ({ ...e, courseTitle: c.title })),
        );
        const payload: KlausurenOutput = { nextDeadlines: ws.nextDeadlines, exams };
        return jsonText(payload);
      }

      case "studium_modules": {
        const ws = await loadWorkspace(sdk);
        const next = ws.nextDeadlines[0];
        return jsonText({
          schemaVersion: 1,
          leaf: "imstudium",
          pack: "studium",
          workspace: workspacePath,
          modules: [
            {
              schemaVersion: 1,
              id: "studium.courses",
              pack: "studium",
              title: "Courses",
              kpis: [{ id: "courses", label: "Courses", value: ws.courses.length }],
            },
            {
              schemaVersion: 1,
              id: "studium.exams",
              pack: "studium",
              title: "Exams",
              kpis: [
                { id: "exams", label: "Exams", value: ws.courses.reduce((n, c) => n + (c.examDates?.length ?? 0), 0) },
                { id: "next", label: "Next date", value: next?.date ?? null },
                { id: "days", label: "Days remaining", value: next?.daysRemaining ?? null },
              ],
            },
          ],
        });
      }

      case "studium_course_brief": {
        const ws = await loadWorkspace(sdk);
        const courseArg = String((args as { course?: string })?.course || "");
        const course = pickCourse(ws, courseArg, sdk.config.courseAliases);
        if (!course) throw courseNotFound(courseArg, ws);
        const courseDir = resolveCourseDir(workspacePath, course, ws);
        let courseMd = "";
        try {
          courseMd = await readFile(join(courseDir, "COURSE.md"), "utf-8");
        } catch {
          // optional
        }
        let materials: unknown;
        try {
          materials = JSON.parse(await readFile(join(courseDir, "search", "materials.json"), "utf-8"));
        } catch {
          // not indexed yet
        }
        return jsonText({ course, courseMd, materials, activeSemester: ws.activeSemester });
      }

      case "studium_find_materials": {
        const ws = await loadWorkspace(sdk);
        const courseArg = String((args as { course?: string })?.course || "");
        const query = String((args as { query?: string })?.query || "").toLowerCase();
        const course = pickCourse(ws, courseArg, sdk.config.courseAliases);
        if (!course) throw courseNotFound(courseArg, ws);

        const filesDir = join(resolveCourseDir(workspacePath, course, ws), "files");
        const matches = await findFilesRecursive(filesDir, query);
        return jsonText({ course: course.title, path: course.path, matches });
      }

      case "studium_read_material": {
        const ws = await loadWorkspace(sdk);
        const courseArg = String((args as { course?: string })?.course || "");
        const fileArg = String((args as { file?: string })?.file || "").toLowerCase();
        const page = (args as { page?: number })?.page;

        const course = pickCourse(ws, courseArg, sdk.config.courseAliases);
        if (!course) throw courseNotFound(courseArg, ws);

        const courseDir = resolveCourseDir(workspacePath, course, ws);
        const filesDir = join(courseDir, "files");
        const candidates = await findFilesRecursive(filesDir, fileArg);
        if (candidates.length === 0) {
          throw new ImstudiumError(
            `No file matching "${fileArg}" in ${course.title}`,
            "NOT_FOUND",
            404,
            "Use studium_find_materials to list files; run imstudium sync in a terminal to refresh",
            { path: course.path },
          );
        }
        const src = candidates[0];

        const outDir = join(courseDir, "extracted", extractSlug(basename(src)));
        const result = await sdk.extractor.extractFile(src, outDir);
        if (result.error) {
          throw new ImstudiumError(result.error, "UNKNOWN", undefined, result.hint, { source: src });
        }

        let content = "";
        try {
          content = await readFile(join(outDir, "content.md"), "utf-8");
        } catch {
          // extraction may be image-only
        }
        if (page && content) {
          const sections = content.split(/^## (?:Page|Slide) /m);
          const match = sections.find((s) => s.startsWith(`${page}\n`) || s.startsWith(`${page}\r`));
          if (match) content = `## Page ${match}`;
        }

        const visual = await materialVisualPayload(outDir, basename(src));
        let { pageImages, viewerHtml } = visual;
        if (page) {
          pageImages = pageImages.filter((p) => new RegExp(`-0*${page}\\.`).test(p));
        }

        return jsonText({
          course: course.title,
          source: src,
          kind: result.kind,
          pages: result.pages,
          ref: page ? pageRef(course.path || course.slug, basename(src), page) : undefined,
          citation: page ? `${course.title} · ${basename(src)} · p.${page}` : undefined,
          content,
          pageImages,
          viewerHtml,
          requiredAction: visual.requiredAction,
          viewerFileUrl: visual.viewerFileUrl,
          methods: visual.methods,
          hint: pageImages.length ? undefined : result.hint || "Markdown-only extract — open the original file for diagrams",
          otherMatches: candidates.slice(1),
        });
      }

      case "imstudium_sync": {
        const course = (args as { course?: string })?.course;
        const semOpts = { semesterId: sdk.config.semesterId };
        const report = await sdk.sync.sync({
          outputDir: workspacePath,
          include: ["wiki", "news", "calendar"],
          ...semOpts,
          courseFilter: course
            ? (c) => c.title.toLowerCase().includes(course.toLowerCase())
            : undefined,
        });
        const workspace = await sdk.studium.build(workspacePath, sdk.config.instanceOrigin, semOpts);
        return jsonText({
          report,
          workspaceSummary: {
            courses: workspace.courses.length,
            activeSemester: workspace.activeSemester,
            workspaceFolder: workspace.workspaceFolder,
            otherSemesters: workspace.otherSemesters,
          },
        });
      }

      case "imstudium_sync_dry_run": {
        const course = (args as { course?: string })?.course;
        const semOpts = { semesterId: sdk.config.semesterId };
        const report = await sdk.sync.sync({
          outputDir: workspacePath,
          dryRun: true,
          ...semOpts,
          courseFilter: course
            ? (c) => c.title.toLowerCase().includes(course.toLowerCase())
            : undefined,
        });
        return jsonText(report);
      }

      case "imstudium_list_courses": {
        const me = await sdk.courses.getMe();
        const ctx = await sdk.courses.resolveSemesterContext({ semesterId: sdk.config.semesterId });
        const courses = await sdk.courses.listMine(me.id, { semesterId: ctx?.semester.id });
        return jsonText({
          semester: ctx
            ? { id: ctx.semester.id, title: ctx.title, slug: ctx.slug, isCurrent: ctx.isCurrent }
            : undefined,
          hint: "This defaults to the current semester. Pass allSemesters or sync --semester for older terms.",
          courses: courses.map((c) => ({
            id: c.id,
            title: c.attributes?.title,
            type: c.attributes?.["course-type"],
          })),
        });
      }

      case "imstudium_whoami": {
        const session = await sdk.auth.loadSession();
        if (!session) return jsonText({ authenticated: false, hint: "Run imstudium login" });
        const me = await sdk.courses.getMe();
        return jsonText({
          authenticated: true,
          user: { id: me.id, name: me.attributes?.["formatted-name"] },
          workspace: workspacePath,
        });
      }

      default:
        throw new ImstudiumError(`Unknown tool: ${name}`, "BAD_ARGS", undefined, "tools/list shows the available tools");
    }
  } catch (e) {
    return errorResult(e);
  }
});

async function loadWorkspace(sdk: Awaited<ReturnType<typeof createSdk>>): Promise<StudiumWorkspace> {
  const ws = await sdk.studium.loadWorkspace(workspacePath);
  if (!ws) {
    throw new ImstudiumError(`No Studium workspace at ${workspacePath}`, "WORKSPACE_MISSING", undefined, "Run in a terminal: imstudium semester start");
  }
  return normalizeStudiumWorkspace(ws);
}

async function findFilesRecursive(
  dir: string,
  query: string,
  results: string[] = [],
): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await findFilesRecursive(p, query, results);
      } else if (!query || e.name.toLowerCase().includes(query)) {
        results.push(p);
      }
    }
  } catch {
    // dir may not exist
  }
  return results;
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
