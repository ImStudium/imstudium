import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import {
  createSdk,
  DigicampusError,
  expandPath,
  type StudiumExamDate,
  type StudiumWorkspace,
} from "@digicampus/sdk";

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
  .command("init")
  .description("Login, full sync, and build Studium workspace")
  .option("-o, --output <dir>", "Workspace directory")
  .action(async (opts: { output?: string }) => {
    try {
      const sdk = await getSdk();
      const session = await sdk.auth.loadSession();
      if (!session) {
        output(null, "Opening browser for login...");
        await sdk.auth.loginWithBrowser({ instanceOrigin: sdk.config.instanceOrigin });
      }
      const out = expandPath(opts.output || sdk.workspacePath);
      await sdk.saveConfig({ workspacePath: out });
      const report = await sdk.sync.sync({
        outputDir: out,
        include: ["wiki", "news", "calendar"],
      });
      const workspace = await sdk.studium.build(out, sdk.config.instanceOrigin);
      output({ workspace, report }, `Studium workspace ready at ${out}`);
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
  .action(async (opts: {
    output?: string;
    course?: string;
    semester?: string;
    layout?: string;
    dryRun?: boolean;
    include?: string;
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
      if (!opts.dryRun) {
        await sdk.studium.build(out, sdk.config.instanceOrigin);
      }
      output(report, `Sync: ${report.downloaded} downloaded, ${report.skipped} skipped, ${report.failed} failed`);
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
