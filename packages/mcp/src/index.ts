import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createSdk, expandPath, extractSlug, normalizeStudiumWorkspace, pageRef, pickCourse, resolveCourseDir, agentSearchGuidance, type StudiumWorkspace } from "@imstudium/sdk";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { MCP_TOOLS } from "./tools.js";
import { materialVisualPayload } from "./visual.js";

const server = new Server(
  { name: "imstudium-studium", version: "0.1.0" },
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

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...MCP_TOOLS],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

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
        return jsonText({ nextDeadlines: ws.nextDeadlines, exams });
      }

      case "studium_course_brief": {
        const ws = await loadWorkspace(sdk);
        const courseArg = String((args as { course?: string })?.course || "");
        const course = pickCourse(ws, courseArg);
        if (!course) {
          return jsonText({ error: "Course not found", available: ws.courses.map((c) => c.title) });
        }
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
        const course = pickCourse(ws, courseArg);
        if (!course) return jsonText({ error: "Course not found" });

        const filesDir = join(resolveCourseDir(workspacePath, course, ws), "files");
        const matches = await findFilesRecursive(filesDir, query);
        return jsonText({ course: course.title, path: course.path, matches });
      }

      case "studium_read_material": {
        const ws = await loadWorkspace(sdk);
        const courseArg = String((args as { course?: string })?.course || "");
        const fileArg = String((args as { file?: string })?.file || "").toLowerCase();
        const page = (args as { page?: number })?.page;

        const course = pickCourse(ws, courseArg);
        if (!course) {
          return jsonText({ error: "Course not found", available: ws.courses.map((c) => c.title) });
        }

        const courseDir = resolveCourseDir(workspacePath, course, ws);
        const filesDir = join(courseDir, "files");
        const candidates = await findFilesRecursive(filesDir, fileArg);
        if (candidates.length === 0) {
          return jsonText({
            error: `No file matching "${fileArg}" in ${course.title}`,
            path: course.path,
            hint: "Use studium_find_materials to list files, or imstudium_sync to refresh",
          });
        }
        const src = candidates[0];

        const outDir = join(courseDir, "extracted", extractSlug(basename(src)));
        const result = await sdk.extractor.extractFile(src, outDir);
        if (result.error) {
          return jsonText({ error: result.error, hint: result.hint, source: src });
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
        return jsonText({ error: `Unknown tool: ${name}` });
    }
  } catch (e) {
    return jsonText({
      error: e instanceof Error ? e.message : String(e),
      hint: "Run imstudium login if not authenticated",
    });
  }
});

async function loadWorkspace(sdk: Awaited<ReturnType<typeof createSdk>>): Promise<StudiumWorkspace> {
  const ws = await sdk.studium.loadWorkspace(workspacePath);
  if (!ws) {
    throw new Error(
      `No Studium workspace at ${workspacePath}. Run: imstudium init`,
    );
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
