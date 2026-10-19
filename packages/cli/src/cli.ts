import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Command } from "commander";
import {
  buildAgentVisualPayload,
  buildSlideViewer,
  createSdk,
  detectTools,
  ImstudiumError,
  expandPath,
  extractSlug,
  isChromeRunning,
  probeOAuthServer,
  pickCourse,
  rebuildSearchIndexes,
  resolveCourseDir,
  toolHints,
  ensureMigrated,
  archiveLegacyConfigDir,
  type StudiumExamDate,
  type StudiumWorkspace,
} from "@imstudium/sdk";
import {
  formatSetupSummary,
  getSetupStatus,
  runSetup,
  type AgentId,
} from "./setup.js";
import { runOnboardFlow } from "./onboard-flow.js";
import {
  checkForUpdates,
  getCliVersion,
  runGlobalUpdate,
} from "./version.js";
import { fileURLToPath } from "node:url";

import { act, fail, getSdk, globalOpts, note, output, type GlobalOpts } from "./runtime.js";
import { runSync, writeEchoSnapshot } from "./pipeline.js";
import { registerCommands } from "./commands/index.js";

function semesterSyncOptions(
  sdk: Awaited<ReturnType<typeof createSdk>>,
  opts: { semester?: string; allSemesters?: boolean },
) {
  if (opts.allSemesters) return { allSemesters: true as const };
  if (opts.semester) return { semesterLabel: opts.semester };
  if (sdk.config.semesterId) return { semesterId: sdk.config.semesterId };
  return {};
}

function courseDirFor(ws: StudiumWorkspace, workspaceRoot: string, slug: string): string {
  const course = ws.courses.find((c) => c.slug === slug);
  if (course) return resolveCourseDir(workspaceRoot, course, ws);
  return join(workspaceRoot, ws.activeSemester?.slug || "current", slug);
}

async function runLogin(
  sdk: Awaited<ReturnType<typeof createSdk>>,
  opts: {
    oauth?: boolean;
    manual?: boolean;
    chromeProfile?: boolean;
    profileDirectory?: string;
    relogin?: boolean;
    /** Always open the sign-in browser — do not assume an existing session. */
    force?: boolean;
    onMessage?: (text: string) => void;
  },
) {
  const loginOpts = {
    instanceOrigin: sdk.config.instanceOrigin,
    onMessage: (text: string) => {
      opts.onMessage?.(text);
      if (!opts.onMessage && !globalOpts.quiet) output(null, text);
    },
  };

  const forceBrowser = opts.force ?? opts.relogin ?? false;

  if (!forceBrowser && !opts.manual) {
    const valid = await sdk.auth.ensureValidSession({
      instanceOrigin: sdk.config.instanceOrigin,
      clientId: sdk.config.oauth?.clientId,
    });
    if (valid) {
      if (!globalOpts.quiet) output(null, "Already signed in — session is valid.");
      return;
    }
  }

  const clientId = sdk.config.oauth?.clientId;
  const useOAuth = opts.oauth || Boolean(clientId);

  if (useOAuth && !opts.manual) {
    if (!clientId) {
      fail(new ImstudiumError("Set IMSTUDIUM_OAUTH_CLIENT_ID or config oauth.clientId", "NO_CLIENT_ID"));
    }

    const probe = await probeOAuthServer(sdk.config.instanceOrigin, clientId);

    if (probe.status === "ready") {
      await sdk.auth.loginWithOAuth({
        instanceOrigin: sdk.config.instanceOrigin,
        clientId,
        onMessage: loginOpts.onMessage,
      });
      return;
    }

    if (probe.status === "broken_setup") {
      if (!globalOpts.quiet) {
        output(
          null,
          "Stud.IP OAuth is not set up on this instance yet — using browser sign-in instead.",
        );
        output(null, `University admin: ${probe.endpoints.admin}`);
      }
    } else if (probe.status === "no_client") {
      fail(
        new ImstudiumError(
          "OAuth client_id was rejected by Stud.IP.",
          "OAUTH_CLIENT_INVALID",
          undefined,
          "Check oauth.clientId in ~/.config/imstudium/config.json",
        ),
      );
    } else if (opts.oauth) {
      fail(
        new ImstudiumError(
          probe.message || "OAuth is unavailable on this Stud.IP instance.",
          "OAUTH_UNAVAILABLE",
        ),
      );
    } else if (!globalOpts.quiet) {
      output(null, `${probe.message || "OAuth unavailable"} — using browser sign-in.`);
    }
  }

  if (opts.manual) {
    if (globalOpts.json) {
      output(null, "Starting manual login helper…");
      const result = await sdk.auth.loginInteractive(loginOpts);
      output({ ok: true, sessionType: result.type }, "Session saved");
      return;
    }
    output(null, "Opening manual login helper…");
    await sdk.auth.loginInteractive(loginOpts);
    return;
  }

  const browserBase = {
    instanceOrigin: sdk.config.instanceOrigin,
    profileDirectory: opts.profileDirectory,
    force: forceBrowser,
    onMessage: loginOpts.onMessage,
  };

  if (!globalOpts.quiet) {
    output(null, "Opening sign-in browser…");
  }

  if (opts.chromeProfile) {
    if (await isChromeRunning()) {
      fail(
        new ImstudiumError(
          "Google Chrome is still running.",
          "CHROME_PROFILE_LOCKED",
          undefined,
          "Quit Chrome completely, then run: imstudium login --chrome-profile",
        ),
      );
    }
    await sdk.auth.loginWithBrowser({ ...browserBase, profile: "system" });
    return;
  }

  // One dedicated Playwright window — never probe the user's open Chrome profile.
  await sdk.auth.loginWithBrowser({ ...browserBase, profile: "isolated" });
}

const CLI_ENTRY = fileURLToPath(import.meta.url);

const program = new Command();

program
  .name("imstudium")
  .description("ImStudium — extract, sync, and plan your studies")
  .version(getCliVersion())
  .option("--json", "JSON output for agents")
  .option("--quiet", "Minimal output")
  .option("--instance <url>", "Stud.IP instance origin (default: digicampus.uni-augsburg.de)")
  .hook("preAction", (thisCommand) => {
    Object.assign(globalOpts, thisCommand.opts() as GlobalOpts);
  });

registerCommands(program);

program
  .command("onboard")
  .description("First-time setup: login, sync workspace, wire agents (idempotent)")
  .option("-o, --output <dir>", "Workspace directory", "~/Studium")
  .option("-y, --yes", "Non-interactive")
  .option(
    "--agents-only",
    "Skip login/sync — only configure Cursor, Claude Code, Claude Desktop, Codex, Windsurf, OpenCode",
  )
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
      const result = await runOnboardFlow({
        ...opts,
        json: globalOpts.json,
        quiet: globalOpts.quiet,
        instance: globalOpts.instance,
        runLogin: async (sdk, onMessage) => {
          await runLogin(sdk, {
            onMessage: (text) => {
              onMessage?.(text);
              if (!globalOpts.quiet && !onMessage) output(null, text);
            },
          });
        },
      });
      output(
        {
          workspace: result.workspace,
          report: result.report,
          studium: result.studium,
          setup: result.setup,
          summary: result.summary,
        },
        `Onboarded → ${result.workspace}\n${result.summary}`,
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
  .option("--relogin", "Sign in again even if a session is already stored")
  .option("--chrome-profile", "Use your Chrome profile with saved passwords (quit Chrome first)")
  .option("--extract", "Extract text + slide images after sync")
  .action(async (opts: {
    output?: string;
    yes?: boolean;
    relogin?: boolean;
    extract?: boolean;
    chromeProfile?: boolean;
  }) => {
    try {
      const sdk = await getSdk();
      const out = expandPath(opts.output || sdk.workspacePath);
      const session = await sdk.auth.loadSession();
      if (!session || opts.relogin) {
        if (opts.yes && !session) {
          fail(
            new ImstudiumError("Not logged in.", "NO_SESSION", undefined, "Run: imstudium login"),
          );
        }
        await runLogin(sdk, { chromeProfile: opts.chromeProfile });
      }

      await sdk.saveConfig({ workspacePath: out });
      const semOpts = semesterSyncOptions(sdk, {});
      const result = await runSync(sdk, {
        out,
        ...semOpts,
        include: ["wiki", "news", "calendar"],
        extract: opts.extract,
        onProgress: (m) => note(m),
      });
      const workspace = result.workspace!;
      const report = { ...result.report, files: undefined };
      const extracted = result.extracted;

      output(
        { workspace, report, extracted: opts.extract ? extracted : undefined, next: "imstudium onboard --agents-only" },
        `Studium workspace ready at ${out} — ${workspace.activeSemester.title} in ${workspace.workspaceFolder}/${opts.extract ? ` · ${extracted} extracted` : ""}\nRun: imstudium onboard --agents-only  (once, idempotent)`,
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command("login")
  .description("Sign in via browser — opens Stud.IP login every time")
  .option("--oauth", "Use OAuth2 PKCE (requires registered client_id)")
  .option("--chrome-profile", "Use your Chrome profile with saved passwords (quit Chrome first)")
  .option("--profile-directory <name>", "Chrome profile folder with --chrome-profile", "Default")
  .option("--manual", "Expert fallback: local helper page with manual session paste")
  .option("--relogin", "Alias for login (browser sign-in always runs)")
  .action(async (opts: {
    oauth?: boolean;
    manual?: boolean;
    chromeProfile?: boolean;
    profileDirectory?: string;
    relogin?: boolean;
  }) => {
    try {
      const sdk = await getSdk();
      await runLogin(sdk, { ...opts, force: true });
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
      const oauth = await probeOAuthServer(sdk.config.instanceOrigin, sdk.config.oauth?.clientId);
      const session = await sdk.auth.loadSession();
      if (!session) {
        output(
          {
            authenticated: false,
            cliVersion: getCliVersion(),
            oauth: {
              status: oauth.status,
              message: oauth.message,
              recommended: oauth.status === "ready" ? "imstudium login --oauth" : "imstudium login",
              adminUrl: oauth.endpoints.admin,
            },
          },
          [
            "Not logged in. Run: imstudium login",
            oauth.status === "broken_setup"
              ? "Note: Stud.IP OAuth is not configured on this instance — browser sign-in is used."
              : oauth.status === "ready" && sdk.config.oauth?.clientId
                ? "OAuth is ready — imstudium login will use it automatically."
                : oauth.status === "ready"
                  ? "OAuth is available — register a client (see docs/OAUTH.md) for one-click login."
                  : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        return;
      }
      const me = await sdk.courses.getMe();
      const props = await sdk.discovery.getProperties();
      output({
        authenticated: true,
        cliVersion: getCliVersion(),
        user: { id: me.id, name: me.attributes?.["formatted-name"] },
        studipVersion: props["studip-version"],
        workspace: sdk.workspacePath,
        sessionType: session.type,
        oauth: {
          status: oauth.status,
          adminUrl: oauth.endpoints.admin,
        },
        next: "imstudium update",
      });
    } catch (e) {
      fail(e);
    }
  });

program
  .command("update")
  .description("Upgrade CLI (if needed) and refresh agent skills/MCP")
  .action(async () => {
    try {
      const sdk = await getSdk();
      const before = await checkForUpdates(CLI_ENTRY);

      let upgraded = false;
      let upgradeNote = "";

      if (before.installMode === "global" && before.updateAvailable) {
        const result = await runGlobalUpdate();
        if (!result.ok) {
          fail(
            new ImstudiumError(
              "npm global upgrade failed",
              "UPDATE_FAILED",
              undefined,
              result.output.slice(0, 500),
            ),
          );
        }
        upgraded = true;
        upgradeNote = `CLI ${before.current} → ${before.latest}\n`;
      }

      const setup = await runSetup("all", {
        yes: true,
        workspace: sdk.workspacePath,
        force: upgraded,
      });

      const after = await checkForUpdates(CLI_ENTRY);
      const summary = formatSetupSummary(setup);
      const text =
        before.installMode === "npx" && before.updateAvailable
          ? `${summary}\nTip: npx -y @imstudium/cli@latest for newest CLI`
          : `${upgradeNote}${summary}`.trim();

      output({ ...after, upgraded, setup, summary }, text);
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
        if (!ws) fail(new ImstudiumError("No workspace. Run imstudium init", "NO_WORKSPACE"));
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
        if (!ws) fail(new ImstudiumError("No workspace", "NO_WORKSPACE"));
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

program
  .command("module")
  .description("Harness modules for mina — course/exam counts, no student id")
  .option("-o, --output <dir>", "Workspace directory")
  .action(async (opts: { output?: string }) => {
    try {
      const sdk = await getSdk();
      const dir = expandPath(opts.output || sdk.workspacePath);
      const ws = await sdk.studium.loadWorkspace(dir);
      if (!ws) fail(new ImstudiumError("No workspace", "NO_WORKSPACE"));
      const snapshot = await writeEchoSnapshot(dir, ws);
      const metrics = JSON.parse(await readFile(snapshot, "utf-8")).metrics as {
        courses: number;
        exams: number;
        nextDate: string | null;
        nextDays: number | null;
      };
      console.log(
        JSON.stringify(
          {
            schemaVersion: 1,
            leaf: "imstudium",
            pack: "studium",
            workspace: dir,
            snapshot,
            modules: [
              {
                schemaVersion: 1,
                id: "studium.courses",
                pack: "studium",
                title: "Courses",
                description: "Count only — no student id",
                kpis: [{ id: "courses", label: "Courses", value: metrics.courses }],
                actions: [{ id: "klausuren", label: "Klausuren", cli: "imstudium klausuren --json", json: true }],
                views: [{ id: "kpis", kind: "kpis", title: "Courses", cli: "imstudium klausuren --json" }],
              },
              {
                schemaVersion: 1,
                id: "studium.exams",
                pack: "studium",
                title: "Exams",
                description: "Next date only — no titles in snapshot",
                kpis: [
                  { id: "exams", label: "Exams", value: metrics.exams },
                  { id: "next", label: "Next date", value: metrics.nextDate },
                  { id: "days", label: "Days remaining", value: metrics.nextDays },
                ],
                actions: [{ id: "klausuren", label: "Klausuren", cli: "imstudium klausuren --json", json: true }],
                views: [{ id: "kpis", kind: "kpis", title: "Exams", cli: "imstudium klausuren --json" }],
              },
            ],
          },
          null,
          2,
        ),
      );
    } catch (e) {
      fail(e);
    }
  });

const courses = program.command("courses").description("Course commands");

courses
  .command("list")
  .description("List my courses")
  .option("--semester <name>", "Semester title or slug (default: calendar current)")
  .option("--all-semesters", "List every enrollment")
  .action(async (opts: { semester?: string; allSemesters?: boolean }) => {
    try {
      const sdk = await getSdk();
      const me = await sdk.courses.getMe();
      const semOpts = semesterSyncOptions(sdk, opts);
      const ctx = await sdk.courses.resolveSemesterContext(semOpts);
      let list = await sdk.courses.listMine(me.id, {
        semesterId: semOpts.semesterId ?? ctx?.semester.id,
        allSemesters: opts.allSemesters,
      });
      output(
        {
          courses: list.map((c) => ({
            id: c.id,
            title: c.attributes?.title,
            type: c.attributes?.["course-type"],
            number: c.attributes?.["course-number"],
          })),
          semester: ctx ? { id: ctx.semester.id, title: ctx.title, slug: ctx.slug } : undefined,
          count: list.length,
        },
        ctx
          ? `${list.length} courses in ${ctx.title}`
          : `${list.length} courses (all semesters)`,
      );
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
      if (!course) fail(new ImstudiumError("Course not found", "NOT_FOUND"));
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
      if (!course) fail(new ImstudiumError("Course not found", "NOT_FOUND"));
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
  .description("Sync files and rebuild the Studium workspace (current semester by default)")
  .option("-o, --output <dir>", "Output directory")
  .option("--course <name>", "Sync single course")
  .option("--semester <label>", "Semester title or slug (e.g. SS2026, WS2025-26)")
  .option("--all-semesters", "Every enrolled semester: current at the root, the rest under archive/")
  .option("--layout <mode>", "tree (mirror Stud.IP folders) or flat", "tree")
  .option("--dry-run", "List changes without downloading")
  .option("--include <items>", "Comma-separated: calendar,wiki,news (default: calendar)")
  .option("--extract", "Extract new/changed files to markdown and rebuild the search index")
  .action(async (opts: {
    output?: string;
    course?: string;
    semester?: string;
    layout?: string;
    dryRun?: boolean;
    include?: string;
    extract?: boolean;
    allSemesters?: boolean;
  }) => {
    try {
      const sdk = await getSdk();
      const out = expandPath(opts.output || sdk.workspacePath);
      const include = opts.include?.split(",").map((s) => s.trim()) as Array<"wiki" | "news" | "calendar"> | undefined;
      const semOpts = semesterSyncOptions(sdk, opts);
      const result = await runSync(sdk, {
        out,
        ...semOpts,
        course: opts.course,
        layout: (opts.layout as "flat" | "tree") || "tree",
        dryRun: opts.dryRun,
        include,
        extract: opts.extract,
        onProgress: (m) => note(m),
      });
      const { report } = result;
      const fresh = result.changes.filter((c) => c.change === "new").length;
      const updated = result.changes.length - fresh;
      const where = result.semesters.map((s) => `${s.title} → ${s.folder}/`).join(", ");
      const lines = [
        `Sync: ${report.downloaded} downloaded (${fresh} new, ${updated} updated), ${report.skipped} unchanged, ${report.failed} failed${opts.extract ? `, ${result.extracted} extracted` : ""}`,
        where ? `      ${where}` : "",
        ...(report.courseErrors ?? []).map((e) => `      ⚠ ${e.courseTitle}: ${e.message}`),
        result.changes.length ? "      What's new: imstudium changes · NEW.md" : "",
      ];
      output(
        { ...report, files: undefined, semesters: result.semesters, changes: result.changes, extracted: opts.extract ? result.extracted : undefined },
        lines.filter(Boolean).join("\n"),
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command("extract")
  .alias("ingest")
  .description("Smart local ingest: AnyDoc + pdf-inspector → content.md + page images")
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
      if (!workspace) fail(new ImstudiumError("No workspace. Run imstudium init", "NO_WORKSPACE"));

      const courses = opts.course
        ? [pickCourse(workspace, opts.course)].filter(Boolean)
        : workspace.courses.filter((c) => c.semesterId === workspace.activeSemester?.id || !workspace.activeSemester?.id);
      if (courses.length === 0) fail(new ImstudiumError("Course not found", "NOT_FOUND"));

      const tools = await sdk.extractor.getTools();
      const results = [];
      for (const course of courses) {
        if (!course) continue;
        const courseDir = courseDirFor(workspace, ws, course.slug);
        const courseResults = await sdk.extractor.extractDir(
          join(courseDir, "files"),
          join(courseDir, "extracted"),
          {
            ...extractOpts,
            course: { title: course.title, path: course.path! },
            workspaceRoot: ws,
          },
        );
        results.push(...courseResults);
      }

      const searchIndex = await rebuildSearchIndexes(ws, workspace);
      if (searchIndex) await sdk.studium.refreshSearchArtifacts(ws, workspace);

      const done = results.filter((r) => !r.error && !r.skipped).length;
      const skipped = results.filter((r) => r.skipped).length;
      const failed = results.filter((r) => r.error).length;
      const hints = toolHints(tools);
      output(
        { extracted: done, skipped, failed, hints, results, searchIndex },
        `Extracted ${done}, skipped ${skipped} (unchanged), failed ${failed}${searchIndex ? ` · ${searchIndex.chunkCount} search chunks` : ""}${hints.length ? `\n${hints.join("\n")}` : ""}`,
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command("index")
  .description("Build/rebuild page index (corpus.jsonl) — for agent grep / semantic search, not a custom search engine")
  .option("--course <name>", "Only one course")
  .option("-o, --output <dir>", "Workspace directory")
  .action(async (opts: { course?: string; output?: string }) => {
    try {
      const sdk = await getSdk();
      const ws = expandPath(opts.output || sdk.workspacePath);
      const workspace = await sdk.studium.loadWorkspace(ws);
      if (!workspace) fail(new ImstudiumError("No workspace. Run imstudium init", "NO_WORKSPACE"));

      if (opts.course) {
        const course = pickCourse(workspace, opts.course);
        if (!course?.path) fail(new ImstudiumError("Course not found", "NOT_FOUND"));
        const { buildCourseSearchIndex, buildMaterialsManifest } = await import("@imstudium/sdk");
        const idx = await buildCourseSearchIndex(join(ws, course.path), course, ws);
        if (!idx) fail(new ImstudiumError("No extractions for this course. Run: imstudium extract --course ...", "NO_CORPUS"));
        await buildMaterialsManifest(join(ws, course.path), course);
        await sdk.studium.refreshSearchArtifacts(ws, workspace);
        output(idx, `Indexed ${idx.chunkCount} chunks from ${idx.materialCount} files → ${course.path}/search/corpus.jsonl`);
        return;
      }

      const idx = await rebuildSearchIndexes(ws, workspace);
      if (!idx) fail(new ImstudiumError("No extractions yet. Run: imstudium extract", "NO_CORPUS"));
      await sdk.studium.refreshSearchArtifacts(ws, workspace);
      output(idx, `Indexed ${idx.chunkCount} chunks across ${idx.courseCount} courses → per-course search/corpus.jsonl + materials.json`);
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
          fail(new ImstudiumError("Provide --dir OR both --course and --file", "MISSING_ARG"));
        }
        const sdk = await getSdk();
        const ws = expandPath(opts.output || sdk.workspacePath);
        const workspace = await sdk.studium.loadWorkspace(ws);
        if (!workspace) fail(new ImstudiumError("No workspace. Run imstudium init", "NO_WORKSPACE"));
        const course = pickCourse(workspace, opts.course!);
        if (!course) fail(new ImstudiumError("Course not found", "NOT_FOUND"));
        const courseDir = resolveCourseDir(ws, course, workspace);
        const filesDir = join(courseDir, "files");
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
        if (!matches.length) fail(new ImstudiumError("File not found", "NOT_FOUND"));
        const src = matches[0];
        title = basename(src);
        outDir = join(courseDir, "extracted", extractSlug(title));
        await sdk.extractor.extractFile(src, outDir);
      }

      const { viewerHtml, pageImages } = await buildSlideViewer(outDir, title);
      const visual = buildAgentVisualPayload(pageImages, viewerHtml);
      output(
        { ...visual, viewerHtml, viewerFileUrl: `file://${viewerHtml}` },
        pageImages.length
          ? `Viewer: file://${viewerHtml}\n${pageImages.length} slide(s) — agents must read pageImages or open viewer in Playwright`
          : `No page images in ${outDir}. Run: imstudium extract --file <path>`,
      );
    } catch (e) {
      fail(e);
    }
  });

program
  .command("doctor")
  .description("Check local ingest pipeline (AnyDoc + pdf-inspector)")
  .action(async () => {
    try {
      const sdk = await getSdk();
      const oauth = await probeOAuthServer(sdk.config.instanceOrigin, sdk.config.oauth?.clientId);
      const tools = await detectTools();
      const hints = toolHints(tools);
      const update = await checkForUpdates(CLI_ENTRY);
      const lines = [
        `imstudium:  ${getCliVersion()} (${update.installMode})`,
        update.updateAvailable
          ? `update:      ${update.current} → ${update.latest} — run: imstudium update`
          : `update:      up to date`,
        "",
        `oauth:       ${oauth.status}${oauth.message ? ` — ${oauth.message}` : ""}`,
        oauth.status === "broken_setup"
          ? `oauth fix:   university admin → ${oauth.endpoints.admin}`
          : oauth.status === "ready" && !sdk.config.oauth?.clientId
            ? `oauth tip:   register client → docs/OAUTH.md`
            : "",
        "",
        `anydoc:        ${tools.anydoc ? "ok" : "MISSING"}`,
        `pdf-inspector: ${tools.pdfInspector ? "ok" : "MISSING"}`,
      ];
      if (hints.length) lines.push("", ...hints);
      output({ cliVersion: getCliVersion(), update, oauth, tools, hints }, lines.filter(Boolean).join("\n"));
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
    const semOpts = semesterSyncOptions(sdk, {});
    for (;;) {
      try {
        const report = await sdk.sync.sync({ outputDir: out, include: ["wiki", "news", "calendar"], ...semOpts });
        await sdk.studium.build(out, sdk.config.instanceOrigin, semOpts);
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
  .command("semesters")
  .description("List Stud.IP semesters and show the calendar-current one")
  .action(async () => {
    try {
      const sdk = await getSdk();
      const { SemestersResource, computeSemesterProgress } = await import("@imstudium/sdk");
      const semesters = new SemestersResource(sdk.client);
      const all = await semesters.listAll();
      const current = await semesters.getCurrent();
      const progress = current ? computeSemesterProgress(current) : undefined;
      output(
        {
          current: current
            ? {
                id: current.id,
                title: current.attributes?.title,
                start: current.attributes?.start,
                end: current.attributes?.end,
                ...progress,
              }
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
          "Default sync/studium/courses commands focus on this semester. Use --semester \"<name>\" or --all-semesters for others.",
          "",
          ...all.slice(-8).map((s) => {
            const mark = s.id === current?.id ? " ← current" : "";
            return `${s.attributes?.title}${mark}`;
          }),
        ].join("\n"),
      );
    } catch (e) {
      fail(e);
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
        fail(new ImstudiumError("Provide --cookie or --file", "MISSING_ARG"));
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
        fail(new ImstudiumError(`Unknown key: ${key}`, "INVALID_KEY"));
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
        `Stale: ${status.stale ? "yes" : "no"}`,
        "",
        `Configured agents: ${status.configured.length ? status.configured.join(", ") : "none"}`,
        "",
        "Detected agents:",
        ...status.detected.map(
          (a) => `  ${a.label} (${a.id}) — skills: ${a.skillsDir}`,
        ),
      ];
      if (status.staleSkills.length) {
        lines.push("", `Stale skills: ${status.staleSkills.join(", ")}`);
        lines.push("Run: imstudium setup all -y");
      }
      output(status, lines.join("\n"));
    } catch (e) {
      fail(e);
    }
  });

setupCmd
  .command("skills")
  .option("--agent <agent>", AGENT_HELP)
  .option("--all-agents", "Configure every harness, not only detected")
  .option("--force", "Overwrite unchanged skills")
  .option("-y, --yes", "Non-interactive")
  .action(async (opts: { agent?: string; yes?: boolean; force?: boolean; allAgents?: boolean }) => {
    try {
      const sdk = await getSdk();
      const result = await runSetup("skills", {
        yes: opts.yes,
        agent: (opts.agent || undefined) as AgentId | "all" | undefined,
        workspace: sdk.workspacePath,
        allAgents: opts.allAgents,
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
  .option("--all-agents", "Configure every harness, not only detected")
  .option("--force", "Overwrite unchanged workflows")
  .action(async (opts: { agent?: string; force?: boolean; allAgents?: boolean }) => {
    try {
      const sdk = await getSdk();
      const result = await runSetup("workflows", {
        agent: (opts.agent || undefined) as AgentId | "all" | undefined,
        workspace: sdk.workspacePath,
        allAgents: opts.allAgents,
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
  .option("--all-agents", "Configure every harness, not only detected")
  .option("-o, --workspace <dir>", "Studium workspace path")
  .option("--force", "Rewrite MCP config even if identical")
  .action(async (opts: { agent?: string; workspace?: string; force?: boolean; allAgents?: boolean }) => {
    try {
      const sdk = await getSdk();
      const result = await runSetup("mcp", {
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

setupCmd
  .command("migrate")
  .description("Migrate DigiCampus config/skills/MCP to ImStudium (idempotent)")
  .option("-o, --workspace <dir>", "Studium workspace path")
  .option("--all-agents", "Configure every harness, not only detected")
  .option("-y, --yes", "Non-interactive")
  .action(async (opts: { workspace?: string; yes?: boolean; allAgents?: boolean }) => {
    try {
      const sdk = await getSdk();
      const migration = await ensureMigrated();
      const result = await runSetup("migrate", {
        yes: opts.yes,
        workspace: opts.workspace || sdk.workspacePath,
        allAgents: opts.allAgents,
        force: true,
      });
      const archived = await archiveLegacyConfigDir();
      output(
        { migration, setup: result, archivedLegacyConfig: archived },
        [
          `Migration: ${migration.migrated.length ? migration.migrated.join(", ") : "already up to date"}`,
          formatSetupSummary(result),
          archived ? "Archived ~/.config/digicampus → digicampus.archived" : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
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

await program.parseAsync();
