#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createSdk, expandPath, type StudiumWorkspace } from "@digicampus/sdk";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const server = new Server(
  { name: "digicampus-studium", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

let workspacePath = process.env.DIGICAMPUS_WORKSPACE || "";
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
  tools: [
    {
      name: "studium_overview",
      description:
        "Full course map and semester context from local studium.json. Call this first for study planning.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "studium_klausuren",
      description: "Exam timeline with days-remaining from klausuren.md / studium.json",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "studium_course_brief",
      description: "One course: schedule, materials count, exams, COURSE.md content",
      inputSchema: {
        type: "object",
        properties: {
          course: { type: "string", description: "Course title substring or id" },
        },
        required: ["course"],
      },
    },
    {
      name: "studium_find_materials",
      description: "Search synced files by course and optional filename query",
      inputSchema: {
        type: "object",
        properties: {
          course: { type: "string", description: "Course title substring" },
          query: { type: "string", description: "Filename search" },
        },
        required: ["course"],
      },
    },
    {
      name: "digicampus_sync",
      description: "Refresh workspace from live DigiCampus (requires login). Full sync + rebuild.",
      inputSchema: {
        type: "object",
        properties: {
          course: { type: "string", description: "Optional single course filter" },
        },
      },
    },
    {
      name: "digicampus_sync_dry_run",
      description: "Preview pending file downloads without downloading",
      inputSchema: {
        type: "object",
        properties: {
          course: { type: "string" },
        },
      },
    },
    {
      name: "digicampus_list_courses",
      description: "Live course list from DigiCampus API (when workspace is stale)",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "digicampus_whoami",
      description: "Check authentication status and current user",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const sdk = await getSdk();

    switch (name) {
      case "studium_overview": {
        const ws = await loadWorkspace(sdk);
        return jsonText(ws);
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
        const course = ws.courses.find(
          (c) =>
            c.id === courseArg ||
            c.title.toLowerCase().includes(courseArg.toLowerCase()) ||
            c.slug.toLowerCase().includes(courseArg.toLowerCase()),
        );
        if (!course) {
          return jsonText({ error: "Course not found", available: ws.courses.map((c) => c.title) });
        }
        let courseMd = "";
        try {
          const { readFile } = await import("node:fs/promises");
          courseMd = await readFile(
            join(workspacePath, "current", course.slug, "COURSE.md"),
            "utf-8",
          );
        } catch {
          // optional
        }
        return jsonText({ course, courseMd });
      }

      case "studium_find_materials": {
        const ws = await loadWorkspace(sdk);
        const courseArg = String((args as { course?: string })?.course || "");
        const query = String((args as { query?: string })?.query || "").toLowerCase();
        const course = ws.courses.find((c) =>
          c.title.toLowerCase().includes(courseArg.toLowerCase()),
        );
        if (!course) return jsonText({ error: "Course not found" });

        const filesDir = join(workspacePath, "current", course.slug, "files");
        const matches = await findFilesRecursive(filesDir, query);
        return jsonText({ course: course.title, matches });
      }

      case "digicampus_sync": {
        const course = (args as { course?: string })?.course;
        const report = await sdk.sync.sync({
          outputDir: workspacePath,
          include: ["wiki", "news", "calendar"],
          courseFilter: course
            ? (c) => c.title.toLowerCase().includes(course.toLowerCase())
            : undefined,
        });
        const workspace = await sdk.studium.build(workspacePath, sdk.config.instanceOrigin);
        return jsonText({ report, workspaceSummary: { courses: workspace.courses.length } });
      }

      case "digicampus_sync_dry_run": {
        const course = (args as { course?: string })?.course;
        const report = await sdk.sync.sync({
          outputDir: workspacePath,
          dryRun: true,
          courseFilter: course
            ? (c) => c.title.toLowerCase().includes(course.toLowerCase())
            : undefined,
        });
        return jsonText(report);
      }

      case "digicampus_list_courses": {
        const me = await sdk.courses.getMe();
        const courses = await sdk.courses.listMine(me.id);
        return jsonText({
          courses: courses.map((c) => ({
            id: c.id,
            title: c.attributes?.title,
            type: c.attributes?.["course-type"],
          })),
        });
      }

      case "digicampus_whoami": {
        const session = await sdk.auth.loadSession();
        if (!session) return jsonText({ authenticated: false, hint: "Run digicampus login" });
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
      hint: "Run digicampus login if not authenticated",
    });
  }
});

async function loadWorkspace(sdk: Awaited<ReturnType<typeof createSdk>>): Promise<StudiumWorkspace> {
  const ws = await sdk.studium.loadWorkspace(workspacePath);
  if (!ws) {
    throw new Error(
      `No Studium workspace at ${workspacePath}. Run: digicampus init`,
    );
  }
  return ws;
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
