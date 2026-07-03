import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Command } from "commander";
import {
  buildAgentVisualPayload,
  buildSlideViewer,
  createSdk,
  detectTools,
  DigicampusError,
  expandPath,
  extractSlug,
  toolHints,
  type StudiumExamDate,
  type StudiumWorkspace,
} from "digicampus-sdk";
import {
  formatSetupSummary,
  getSetupStatus,
  runSetup,
  type AgentId,
} from "./setup.js";

interface GlobalOpts {
  json?: boolean;
  quiet?: boolean;
  instance?: string;
}

let globalOpts: GlobalOpts = {};

function output(data: unknown, text?: string) {
  if (globalOpts.json) {
    console.log(JSON.stringify({ schemaVersion: "1", ...((typeof data === "object" && data) || { data }) }, null, 2));
  } else if (text) {
    console.log(text);
  } else if (typeof data === "string") {
    console.log(data);
  }
}

function fail(err: unknown): never {
  const error =
    err instanceof DigicampusError
      ? err
      : new DigicampusError(err instanceof Error ? err.message : String(err), "UNKNOWN");
  if (globalOpts.json) {
    console.error(JSON.stringify(error.toJSON(), null, 2));
  } else {
    console.error(`Error: ${error.message}`);
    if (error.hint) console.error(`Hint: ${error.hint}`);
  }
  process.exit(1);
}

async function getSdk() {
  const partial = globalOpts.instance
    ? { baseUrl: `${globalOpts.instance.replace(/\/$/, "")}/jsonapi.php/v1`, instanceOrigin: globalOpts.instance.replace(/\/$/, "") }
    : undefined;
  return createSdk(partial);
}

const program = new Command();

program
  .name("digicampus")
  .description("DigiCampus Studium OS — extract, sync, and plan your studies")
  .version("0.1.0")
  .option("--json", "JSON output for agents")
  .option("--quiet", "Minimal output")
  .option("--instance <url>", "Stud.IP instance origin (default: digicampus.uni-augsburg.de)")
  .hook("preAction", (thisCommand) => {
    globalOpts = thisCommand.opts() as GlobalOpts;
  });

program
  .command("onboard")
  .description("First-time setup: login, sync workspace, wire agents (idempotent)")
  .option("-o, --output <dir>", "Workspace directory", "~/Studium")
  .option("-y, --yes", "Non-interactive")
  .option("--agents-only", "Skip login/sync — only configure Cursor, Claude, Codex, etc.")
  .option("--skip-sync", "Login + agent setup, no file sync")
  .option("--force", "Re-install skills/MCP even when unchanged")
  .option("--all-agents", "Configure every harness path, not only detected ones")
  .action(async (opts: {
    output?: string;
    yes?: boolean;
    agentsOnly?: boolean;
    skipSync?: boolean;
    force?: boolean;
    allAgents?: boolean;
  }) => {
    try {
      const sdk = await getSdk();
      const out = expandPath(opts.output || sdk.workspacePath);
      await sdk.saveConfig({ workspacePath: out });

      if (!opts.agentsOnly) {
        const session = await sdk.auth.loadSession();
        if (!session) {
          if (!opts.yes) output(null, "Opening browser for login...");
          await sdk.auth.loginWithBrowser({ instanceOrigin: sdk.config.instanceOrigin });
        }
        if (!opts.skipSync) {
          const report = await sdk.sync.sync({
            outputDir: out,
            include: ["wiki", "news", "calendar"],
          });
          const workspace = await sdk.studium.build(out, sdk.config.instanceOrigin);
          const setup = await runSetup("all", {
            yes: opts.yes,
            workspace: out,
            force: opts.force,
            allAgents: opts.allAgents,
          });
          output(
            { workspace, report, setup, summary: formatSetupSummary(setup) },
            `Onboarded → ${out}\n${formatSetupSummary(setup)}`,
          );
          return;
        }
      }

      const setup = await runSetup("all", {
        yes: opts.yes,
        workspace: out,
        force: opts.force,
        allAgents: opts.allAgents,
      });
      output(
        { setup, summary: formatSetupSummary(setup) },
        `Agents configured\n${formatSetupSummary(setup)}`,
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command("init")
  .description("Login + sync Studium workspace (use onboard for first-time agent setup)")
  .option("-o, --output <dir>", "Workspace directory")
  .option("-y, --yes", "Non-interactive (skip prompts)")
  .option("--browser", "Force browser login")
  .option("--extract", "Extract text + slide images after sync")
  .action(async (opts: {
    output?: string;
    yes?: boolean;
    browser?: boolean;
    extract?: boolean;
  }) => {
    try {
      const sdk = await getSdk();
      const out = expandPath(opts.output || sdk.workspacePath);
      const session = await sdk.auth.loadSession();
      if (!session || opts.browser) {
        if (!opts.yes && !opts.browser) output(null, "Opening browser for login...");
        await sdk.auth.loginWithBrowser({ instanceOrigin: sdk.config.instanceOrigin });
      }

      await sdk.saveConfig({ workspacePath: out });
      const report = await sdk.sync.sync({
        outputDir: out,
        include: ["wiki", "news", "calendar"],
      });
      const workspace = await sdk.studium.build(out, sdk.config.instanceOrigin);

      let extracted = 0;
      if (opts.extract) {
        for (const course of workspace.courses) {
          const courseDir = join(out, "current", course.slug);
          const results = await sdk.extractor.extractDir(
            join(courseDir, "files"),
            join(courseDir, "extracted"),
          );
          extracted += results.filter((r) => !r.error && !r.skipped).length;
        }
      }

      output(
        { workspace, report, extracted: opts.extract ? extracted : undefined, next: "digicampus onboard --agents-only" },
        `Studium workspace ready at ${out}${opts.extract ? ` · ${extracted} extracted` : ""}\nRun: digicampus onboard --agents-only  (once, idempotent)`,
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command("login")
  .description("Browser login (Shibboleth + MFA)")
  .option("--oauth", "Use OAuth2 PKCE (requires registered client_id)")
  .action(async (opts: { oauth?: boolean }) => {
    try {
      const sdk = await getSdk();
      if (opts.oauth) {
        const clientId = sdk.config.oauth?.clientId;
        if (!clientId) fail(new DigicampusError("Set DIGICAMPUS_OAUTH_CLIENT_ID or config oauth.clientId", "NO_CLIENT_ID"));
        await sdk.auth.loginWithOAuth({ instanceOrigin: sdk.config.instanceOrigin, clientId });
      } else {
        output(null, "Complete login in the browser window...");
        await sdk.auth.loginWithBrowser({ instanceOrigin: sdk.config.instanceOrigin });
      }
      const me = await sdk.courses.getMe();
      const name = (me.attributes?.["formatted-name"] as string) || me.id;
      output({ user: { id: me.id, name } }, `Logged in as ${name}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("logout")
  .description("Clear stored session")
  .action(async () => {
    try {
      const sdk = await getSdk();
      await sdk.auth.clearSession();
      output({ ok: true }, "Logged out");
    } catch (e) {
      fail(e);
    }
  });

program
  .command("status")
  .description("Auth and instance status")
  .action(async () => {
    try {
      const sdk = await getSdk();
      const session = await sdk.auth.loadSession();
      if (!session) {
        output({ authenticated: false }, "Not logged in. Run: digicampus login");
        return;
      }
      const me = await sdk.courses.getMe();
      const props = await sdk.discovery.getProperties();
      output({
        authenticated: true,
        user: { id: me.id, name: me.attributes?.["formatted-name"] },
        studipVersion: props["studip-version"],
        workspace: sdk.workspacePath,
        sessionType: session.type,
      });
    } catch (e) {
      fail(e);
    }
  });

program
  .command("studium")
  .description("Show STUDIUM.md or studium.json")
  .option("-o, --output <dir>", "Workspace directory")
  .action(async (opts: { output?: string }) => {
    try {
      const sdk = await getSdk();
      const dir = expandPath(opts.output || sdk.workspacePath);
      if (globalOpts.json) {
        const ws = await sdk.studium.loadWorkspace(dir);
        if (!ws) fail(new DigicampusError("No workspace. Run digicampus init", "NO_WORKSPACE"));
        output(ws);
      } else {
        const md = await readFile(join(dir, "STUDIUM.md"), "utf-8");
        output(md);
      }
    } catch (e) {
      fail(e);
    }
  });

program
  .command("klausuren")
  .description("Exam timeline")
  .option("-o, --output <dir>", "Workspace directory")
  .action(async (opts: { output?: string }) => {
    try {
      const sdk = await getSdk();
      const dir = expandPath(opts.output || sdk.workspacePath);
      if (globalOpts.json) {
        const ws = await sdk.studium.loadWorkspace(dir);
        if (!ws) fail(new DigicampusError("No workspace", "NO_WORKSPACE"));
        const exams: StudiumExamDate[] = ws.courses.flatMap((c) => c.examDates);
        output({ exams, nextDeadlines: ws.nextDeadlines });
      } else {
        const md = await readFile(join(dir, "klausuren.md"), "utf-8");
        output(md);
      }
    } catch (e) {
      fail(e);
    }
  });

const courses = program.command("courses").description("Course commands");

courses
  .command("list")
  .description("List my courses")
  .option("--semester <name>", "Filter by semester")
  .action(async (opts: { semester?: string }) => {
    try {
      const sdk = await getSdk();
      const me = await sdk.courses.getMe();
      let list = await sdk.courses.listMine(me.id);
      if (opts.semester) {
        list = list.filter((c) =>
          JSON.stringify(c).toLowerCase().includes(opts.semester!.toLowerCase()),
        );
      }
      output({
        courses: list.map((c) => ({
          id: c.id,
          title: c.attributes?.title,
          type: c.attributes?.["course-type"],
          number: c.attributes?.["course-number"],
        })),
      });
    } catch (e) {
      fail(e);
    }
  });

courses
  .command("show <idOrName>")
  .description("Show course details")
  .action(async (idOrName: string) => {
    try {
      const sdk = await getSdk();
      const me = await sdk.courses.getMe();
      const list = await sdk.courses.listMine(me.id);
      const course =
        list.find((c) => c.id === idOrName) ||
        list.find((c) =>
          (c.attributes?.title || "").toLowerCase().includes(idOrName.toLowerCase()),
        );
      if (!course) fail(new DigicampusError("Course not found", "NOT_FOUND"));
      const full = await sdk.courses.get(course.id);
      const fileCount = (await sdk.files.listAllFileRefs(course.id)).length;
      output({ course: full, fileCount });
    } catch (e) {
      fail(e);
    }
  });

const files = program.command("files").description("File commands");

files
  .command("tree <course>")
  .description("Folder/file tree for a course")
  .action(async (courseName: string) => {
    try {
      const sdk = await getSdk();
      const me = await sdk.courses.getMe();
      const list = await sdk.courses.listMine(me.id);
      const course = list.find(
        (c) =>
          c.id === courseName ||
          (c.attributes?.title || "").toLowerCase().includes(courseName.toLowerCase()),
      );
      if (!course) fail(new DigicampusError("Course not found", "NOT_FOUND"));
      const tree = await sdk.files.buildFolderTree(course.id);
      output({ courseId: course.id, tree });
    } catch (e) {
      fail(e);
    }
  });

files
  .command("download <fileRefId>")
  .description("Download a single file")
  .option("-o, --output <path>", "Output path")
  .action(async (fileRefId: string, opts: { output?: string }) => {
    try {
      const sdk = await getSdk();
      const meta = await sdk.files.getFileRef(fileRefId);
      const name = meta.attributes?.name || fileRefId;
      const dest = opts.output || name;
      const bytes = await sdk.files.downloadFileRef(fileRefId, dest);
      output({ path: dest, bytes }, `Downloaded ${dest} (${bytes} bytes)`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("sync")
  .description("Sync files and rebuild Studium workspace")
  .option("-o, --output <dir>", "Output directory")
  .option("--course <name>", "Sync single course")
  .option("--semester <label>", "Semester folder label", "current")
  .option("--layout <mode>", "flat or tree", "flat")
  .option("--dry-run", "List changes without downloading")
  .option("--include <items>", "Comma-separated: wiki,news,calendar")
  .option("--extract", "Extract text + page images from new/changed files after sync")
  .action(async (opts: {
    output?: string;
    course?: string;
    semester?: string;
    layout?: string;
    dryRun?: boolean;
    include?: string;
    extract?: boolean;
  }) => {
    try {
      const sdk = await getSdk();
      const out = expandPath(opts.output || sdk.workspacePath);
      const include = opts.include?.split(",").map((s) => s.trim()) as Array<"wiki" | "news" | "calendar"> | undefined;
      const report = await sdk.sync.sync({
        outputDir: out,
        layout: (opts.layout as "flat" | "tree") || "flat",
        dryRun: opts.dryRun,
        semesterLabel: opts.semester,
        include,
        courseFilter: opts.course
          ? (c) => c.title.toLowerCase().includes(opts.course!.toLowerCase()) || c.id === opts.course
          : undefined,
      });
      let extracted = 0;
      if (!opts.dryRun) {
        const workspace = await sdk.studium.build(out, sdk.config.instanceOrigin);
        if (opts.extract) {
          for (const course of workspace.courses) {
            const courseDir = join(out, "current", course.slug);
            const results = await sdk.extractor.extractDir(
              join(courseDir, "files"),
              join(courseDir, "extracted"),
            );
            extracted += results.filter((r) => !r.error && !r.skipped).length;
          }
        }
      }
      output(
        { ...report, extracted: opts.extract ? extracted : undefined },
        `Sync: ${report.downloaded} downloaded, ${report.skipped} skipped, ${report.failed} failed${opts.extract ? `, ${extracted} extracted` : ""}`,
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command("extract")
  .description("Extract text + page images from synced materials (PDF, PPTX, DOCX, images, ...)")
  .option("--course <name>", "Only one course (title substring or slug)")
  .option("--file <path>", "Extract a single file to <file>-extracted/")
  .option("--no-images", "Text only, skip page image rendering")
  .option("--dpi <n>", "Image resolution", "144")
  .option("--force", "Re-extract even if unchanged")
  .option("-o, --output <dir>", "Workspace directory")
  .action(async (opts: {
    course?: string;
    file?: string;
    images?: boolean;
    dpi?: string;
    force?: boolean;
    output?: string;
  }) => {
    try {
      const sdk = await getSdk();
      const extractOpts = {
        images: opts.images,
        dpi: parseInt(opts.dpi || "144", 10),
        force: opts.force,
      };

      if (opts.file) {
        const src = expandPath(opts.file);
        const outDir = src.replace(/\.[^.]+$/, "") + "-extracted";
        const result = await sdk.extractor.extractFile(src, outDir, extractOpts);
        output(result, `Extracted ${result.pages} page(s) → ${result.outDir}${result.hint ? `\nHint: ${result.hint}` : ""}`);
        return;
      }

      const ws = expandPath(opts.output || sdk.workspacePath);
      const workspace = await sdk.studium.loadWorkspace(ws);
      if (!workspace) fail(new DigicampusError("No workspace. Run digicampus init", "NO_WORKSPACE"));

      const courses = workspace.courses.filter((c) =>
        !opts.course ||
        c.title.toLowerCase().includes(opts.course.toLowerCase()) ||
        c.slug.toLowerCase() === opts.course.toLowerCase(),
      );
      if (courses.length === 0) fail(new DigicampusError("Course not found", "NOT_FOUND"));

      const tools = await sdk.extractor.getTools();
      const results = [];
      for (const course of courses) {
        const courseDir = join(ws, "current", course.slug);
        const courseResults = await sdk.extractor.extractDir(
          join(courseDir, "files"),
          join(courseDir, "extracted"),
          extractOpts,
        );
        results.push(...courseResults);
      }

      const done = results.filter((r) => !r.error && !r.skipped).length;
      const skipped = results.filter((r) => r.skipped).length;
      const failed = results.filter((r) => r.error).length;
      const hints = toolHints(tools);
      output(
        { extracted: done, skipped, failed, hints, results },
        `Extracted ${done}, skipped ${skipped} (unchanged), failed ${failed}${hints.length ? `\n${hints.join("\n")}` : ""}`,
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command("view")
  .description("Build viewer.html for slide PNGs — fast path for Playwright / browser agents")
  .option("--dir <path>", "Already-extracted directory (contains pages/)")
  .option("--course <name>", "Course title substring")
  .option("--file <name>", "Material filename substring")
  .option("-o, --output <dir>", "Workspace directory")
  .action(async (opts: { dir?: string; course?: string; file?: string; output?: string }) => {
    try {
      let outDir = opts.dir ? expandPath(opts.dir) : undefined;
      let title = outDir ? basename(outDir) : "slides";

      if (!outDir) {
        if (!opts.course || !opts.file) {
          fail(new DigicampusError("Provide --dir OR both --course and --file", "MISSING_ARG"));
        }
        const sdk = await getSdk();
        const ws = expandPath(opts.output || sdk.workspacePath);
        const workspace = await sdk.studium.loadWorkspace(ws);
        if (!workspace) fail(new DigicampusError("No workspace. Run digicampus init", "NO_WORKSPACE"));
        const course = workspace.courses.find((c) =>
          c.title.toLowerCase().includes(opts.course!.toLowerCase()),
        );
        if (!course) fail(new DigicampusError("Course not found", "NOT_FOUND"));
        const filesDir = join(ws, "current", course.slug, "files");
        const { readdir: rd } = await import("node:fs/promises");
        const matches: string[] = [];
        async function walk(d: string) {
          const entries = await rd(d, { withFileTypes: true }).catch(() => []);
          for (const e of entries) {
            const p = join(d, e.name);
            if (e.isDirectory()) await walk(p);
            else if (e.name.toLowerCase().includes(opts.file!.toLowerCase())) matches.push(p);
          }
        }
        await walk(filesDir);
        if (!matches.length) fail(new DigicampusError("File not found", "NOT_FOUND"));
        const src = matches[0];
        title = basename(src);
        outDir = join(ws, "current", course.slug, "extracted", extractSlug(title));
        await sdk.extractor.extractFile(src, outDir);
      }

      const { viewerHtml, pageImages } = await buildSlideViewer(outDir, title);
      const visual = buildAgentVisualPayload(pageImages, viewerHtml);
      output(
        { ...visual, viewerHtml, viewerFileUrl: `file://${viewerHtml}` },
        pageImages.length
          ? `Viewer: file://${viewerHtml}\n${pageImages.length} slide(s) — agents must read pageImages or open viewer in Playwright`
          : `No page images in ${outDir}. Run: digicampus extract --file <path>`,
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command("doctor")
  .description("Check extraction tool availability")
  .action(async () => {
    try {
      const tools = await detectTools();
      const hints = toolHints(tools);
      const lines = [
        `pdftotext:   ${tools.pdftotext || "MISSING"}`,
        `pdftoppm:    ${tools.pdftoppm || "MISSING"}`,
        `libreoffice: ${tools.soffice || "MISSING (native PPTX/DOCX text fallback active)"}`,
        `tesseract:   ${tools.tesseract || "MISSING (no OCR for scanned PDFs/photos — agents can still read page images)"}`,
        `unzip:       ${tools.unzip || "MISSING"}`,
      ];
      if (hints.length) lines.push("", ...hints);
      output({ tools, hints }, lines.join("\n"));
    } catch (e) {
      fail(e);
    }
  });

const exportCmd = program.command("export").description("Export rich content");

exportCmd
  .command("calendar")
  .option("-o, --output <dir>")
  .action(async (opts: { output?: string }) => {
    try {
      const sdk = await getSdk();
      const me = await sdk.courses.getMe();
      const ics = await sdk.schedule.exportCalendarIcs(me.id);
      const dir = expandPath(opts.output || sdk.workspacePath);
      const { writeFile, mkdir } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      const path = join(dir, "calendar.ics");
      await writeFile(path, ics);
      output({ path }, `Wrote ${path}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("watch")
  .description("Continuous sync loop")
  .option("--interval <duration>", "Interval e.g. 1h, 30m", "1h")
  .option("-o, --output <dir>")
  .action(async (opts: { interval?: string; output?: string }) => {
    const ms = parseInterval(opts.interval || "1h");
    const sdk = await getSdk();
    const out = expandPath(opts.output || sdk.workspacePath);
    output(null, `Watching every ${opts.interval} → ${out} (Ctrl+C to stop)`);
    for (;;) {
      try {
        const report = await sdk.sync.sync({ outputDir: out, include: ["wiki", "news", "calendar"] });
        await sdk.studium.build(out, sdk.config.instanceOrigin);
        if (!globalOpts.quiet) {
          output(report, `[${new Date().toISOString()}] ${report.downloaded} new files`);
        }
      } catch (e) {
        console.error(e);
      }
      await sleep(ms);
    }
  });

program
  .command("discover")
  .description("List JSON:API routes")
  .action(async () => {
    try {
      const sdk = await getSdk();
      const routes = await sdk.discovery.listRoutes();
      output({ routes, count: routes.length });
    } catch (e) {
      fail(e);
    }
  });

const sessionCmd = program.command("session").description("Session management");

sessionCmd
  .command("import")
  .option("--cookie <value>", "Seminar_Session cookie value")
  .option("--file <path>", "Netscape cookie file")
  .action(async (opts: { cookie?: string; file?: string }) => {
    try {
      const sdk = await getSdk();
      if (opts.cookie) {
        await sdk.auth.importCookies({ Seminar_Session: opts.cookie });
      } else if (opts.file) {
        const content = await readFile(opts.file, "utf-8");
        await sdk.auth.importFromNetscapeCookieFile(content);
      } else {
        fail(new DigicampusError("Provide --cookie or --file", "MISSING_ARG"));
      }
      output({ ok: true }, "Session imported");
    } catch (e) {
      fail(e);
    }
  });

const configCmd = program.command("config").description("Configuration");

configCmd
  .command("show")
  .action(async () => {
    try {
      const sdk = await getSdk();
      output(sdk.config);
    } catch (e) {
      fail(e);
    }
  });

configCmd
  .command("set <key> <value>")
  .action(async (key: string, value: string) => {
    try {
      const sdk = await getSdk();
      if (key === "base-url") {
        await sdk.saveConfig({ baseUrl: value, instanceOrigin: value.replace(/\/jsonapi\.php\/v1$/, "") });
      } else if (key === "workspace") {
        await sdk.saveConfig({ workspacePath: value });
      } else {
        fail(new DigicampusError(`Unknown key: ${key}`, "INVALID_KEY"));
      }
      output({ ok: true }, `Set ${key}`);
    } catch (e) {
      fail(e);
    }
  });

const AGENT_HELP =
  "cursor | claude-code | claude-desktop | codex | windsurf | opencode | all";

const setupCmd = program
  .command("setup")
  .description("Idempotent agent wiring (skills, MCP) — only updates what changed");

setupCmd
  .command("status")
  .description("Show detected agents and setup manifest")
  .action(async () => {
    try {
      const sdk = await getSdk();
      const status = await getSetupStatus(sdk.workspacePath);
      const lines = [
        `Workspace: ${status.workspace}`,
        `Manifest: ${status.manifest ? status.manifest.updatedAt : "none"}`,
        `Up to date: ${status.upToDate ? "yes" : "no"}`,
        "",
        "Detected agents:",
        ...status.detected.map(
          (a) => `  ${a.label} (${a.id}) — skills: ${a.skillsDir}`,
        ),
      ];
      output(status, lines.join("\n"));
    } catch (e) {
      fail(e);
    }
  });

setupCmd
  .command("skills")
  .option("--agent <agent>", AGENT_HELP)
  .option("--force", "Overwrite unchanged skills")
  .option("-y, --yes", "Non-interactive")
  .action(async (opts: { agent?: string; yes?: boolean; force?: boolean }) => {
    try {
      const sdk = await getSdk();
      const result = await runSetup("skills", {
        yes: opts.yes,
        agent: (opts.agent || undefined) as AgentId | "all" | undefined,
        workspace: sdk.workspacePath,
        force: opts.force,
      });
      output(result, formatSetupSummary(result));
    } catch (e) {
      fail(e);
    }
  });

setupCmd
  .command("workflows")
  .option("--agent <agent>", AGENT_HELP)
  .option("--force", "Overwrite unchanged workflows")
  .action(async (opts: { agent?: string; force?: boolean }) => {
    try {
      const sdk = await getSdk();
      const result = await runSetup("workflows", {
        agent: (opts.agent || undefined) as AgentId | "all" | undefined,
        workspace: sdk.workspacePath,
        force: opts.force,
      });
      output(result, formatSetupSummary(result));
    } catch (e) {
      fail(e);
    }
  });

setupCmd
  .command("mcp")
  .option("--agent <agent>", AGENT_HELP)
  .option("-o, --workspace <dir>", "Studium workspace path")
  .option("--force", "Rewrite MCP config even if identical")
  .action(async (opts: { agent?: string; workspace?: string; force?: boolean }) => {
    try {
      const sdk = await getSdk();
      const result = await runSetup("mcp", {
        agent: (opts.agent || undefined) as AgentId | "all" | undefined,
        workspace: opts.workspace || sdk.workspacePath,
        force: opts.force,
      });
      output(result, formatSetupSummary(result));
    } catch (e) {
      fail(e);
    }
  });

setupCmd
  .command("all")
  .description("Skills + workflows + MCP (idempotent — skips unchanged)")
  .option("--agent <agent>", AGENT_HELP)
  .option("-o, --workspace <dir>", "Studium workspace path")
  .option("--all-agents", "Configure every harness, not only detected")
  .option("--force", "Overwrite even when unchanged")
  .option("-y, --yes", "Non-interactive")
  .action(async (opts: {
    agent?: string;
    workspace?: string;
    yes?: boolean;
    allAgents?: boolean;
    force?: boolean;
  }) => {
    try {
      const sdk = await getSdk();
      const result = await runSetup("all", {
        yes: opts.yes,
        agent: (opts.agent || undefined) as AgentId | "all" | undefined,
        workspace: opts.workspace || sdk.workspacePath,
        allAgents: opts.allAgents,
        force: opts.force,
      });
      output(result, formatSetupSummary(result));
    } catch (e) {
      fail(e);
    }
  });

function parseInterval(s: string): number {
  const m = s.match(/^(\d+)([hms])$/);
  if (!m) return 3_600_000;
  const n = parseInt(m[1], 10);
  if (m[2] === "h") return n * 3_600_000;
  if (m[2] === "m") return n * 60_000;
  return n * 1000;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

program.parse();
