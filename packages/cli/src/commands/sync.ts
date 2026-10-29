import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Command } from "commander";
import {
  buildAgentVisualPayload,
  buildCourseSearchIndex,
  buildMaterialsManifest,
  buildSlideViewer,
  expandPath,
  extractSlug,
  ImstudiumError,
  rebuildSearchIndexes,
  resolveCourseDir,
  toImstudiumError,
  toolHints,
  type SyncPart,
  type StudiumWorkspace,
} from "@imstudium/sdk";
import type { SyncOutput } from "@imstudium/contract";
import { runSync } from "../pipeline.js";
import { act, getSdk, globalOpts, note, output } from "../runtime.js";
import { workspaceCourse } from "../course-arg.js";
import { courseOption, outputOption, parseDuration, workspaceDir } from "../kit/args.js";
import { nowStamp } from "../kit/format.js";
import { requireWorkspace, semesterSyncOptions } from "./workspace.js";

const SYNC_PARTS: SyncPart[] = ["calendar", "wiki", "news", "forum", "courseware", "tasks"];

function courseDirFor(ws: StudiumWorkspace, workspaceRoot: string, slug: string): string {
  const course = ws.courses.find((c) => c.slug === slug);
  if (course) return resolveCourseDir(workspaceRoot, course, ws);
  return join(workspaceRoot, ws.activeSemester?.slug || "current", slug);
}

function parseInclude(value: string | undefined): SyncPart[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = parts.filter((p) => !SYNC_PARTS.includes(p as SyncPart));
  if (bad.length) {
    throw new ImstudiumError(`Unknown --include part: ${bad.join(", ")}`, "BAD_ARGS", undefined, `Choose from: ${SYNC_PARTS.join(",")}`);
  }
  return parts as SyncPart[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function registerSync(program: Command): void {
  program
    .command("sync")
    .description("Sync files and rebuild the Studium workspace (current semester by default)")
    .addOption(outputOption())
    .addOption(courseOption("Sync a single course"))
    .option("--semester <label>", "Semester title or slug (e.g. SS2026, WS2025-26)")
    .option("--all-semesters", "Every enrolled semester: current at the root, the rest under archive/")
    .option("--layout <mode>", "tree (mirror Stud.IP folders) or flat", "tree")
    .option("--dry-run", "List changes without downloading")
    .option("--include <items>", `Comma-separated: ${SYNC_PARTS.join(",")} (default: all)`)
    .option("--extract", "Extract new/changed files to markdown and rebuild the search index")
    .action(
      act(async (opts: { output?: string; course?: string; semester?: string; layout?: string; dryRun?: boolean; include?: string; extract?: boolean; allSemesters?: boolean }) => {
        const sdk = await getSdk();
        const out = workspaceDir(sdk, opts);
        if (opts.layout && opts.layout !== "tree" && opts.layout !== "flat") {
          throw new ImstudiumError(`--layout must be tree or flat, got "${opts.layout}"`, "BAD_ARGS");
        }
        const result = await runSync(sdk, {
          out,
          ...semesterSyncOptions(sdk, opts),
          course: opts.course,
          layout: (opts.layout as "flat" | "tree") || "tree",
          dryRun: opts.dryRun,
          include: parseInclude(opts.include),
          extract: opts.extract,
          onProgress: note,
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
        const { files: _files, ...counts } = report;
        const payload: SyncOutput = { ...counts, semesters: result.semesters, changes: result.changes, extracted: opts.extract ? result.extracted : undefined };
        output(payload, lines.filter(Boolean).join("\n"));
      }),
    );

  program
    .command("extract")
    .alias("ingest")
    .description("Local ingest: pdf-inspector (PDF) + AnyDoc (Office) → content.md; photos copied to pages/")
    .addOption(courseOption("Only one course (title fragment, shortcut, slug or id)"))
    .option("--file <path>", "Extract a single file to <file>-extracted/")
    .option("--no-images", "Don't copy photos into pages/")
    .option("--force", "Re-extract even if unchanged")
    .addOption(outputOption())
    .action(
      act(async (opts: { course?: string; file?: string; images?: boolean; force?: boolean; output?: string }) => {
        const sdk = await getSdk();
        const extractOpts = { images: opts.images, force: opts.force };

        if (opts.file) {
          const src = expandPath(opts.file);
          const outDir = src.replace(/\.[^.]+$/, "") + "-extracted";
          const result = await sdk.extractor.extractFile(src, outDir, extractOpts);
          output(result, `Extracted ${result.pages} page(s) → ${result.outDir}${result.hint ? `\nHint: ${result.hint}` : ""}`);
          return;
        }

        const ws = workspaceDir(sdk, opts);
        const workspace = await requireWorkspace(sdk, ws);
        const courses = opts.course
          ? [workspaceCourse(sdk, workspace, opts.course)]
          : workspace.courses.filter((c) => c.semesterId === workspace.activeSemester?.id || !workspace.activeSemester?.id);

        const tools = await sdk.extractor.getTools();
        const results = [];
        for (const course of courses) {
          const courseDir = courseDirFor(workspace, ws, course.slug);
          results.push(
            ...(await sdk.extractor.extractDir(join(courseDir, "files"), join(courseDir, "extracted"), {
              ...extractOpts,
              course: { title: course.title, path: course.path! },
              workspaceRoot: ws,
            })),
          );
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
      }),
    );

  program
    .command("index")
    .description("Build/rebuild page index (corpus.jsonl) — for agent grep / semantic search, not a custom search engine")
    .addOption(courseOption("Only one course"))
    .addOption(outputOption())
    .action(
      act(async (opts: { course?: string; output?: string }) => {
        const sdk = await getSdk();
        const ws = workspaceDir(sdk, opts);
        const workspace = await requireWorkspace(sdk, ws);

        if (opts.course) {
          const course = workspaceCourse(sdk, workspace, opts.course);
          if (!course.path) throw new ImstudiumError(`${course.title} has no folder yet`, "WORKSPACE_MISSING", undefined, "Run: imstudium sync");
          const idx = await buildCourseSearchIndex(join(ws, course.path), course, ws);
          if (!idx) throw new ImstudiumError("No extractions for this course.", "NO_CORPUS", undefined, `Run: imstudium extract --course "${opts.course}"`);
          await buildMaterialsManifest(join(ws, course.path), course);
          await sdk.studium.refreshSearchArtifacts(ws, workspace);
          output(idx, `Indexed ${idx.chunkCount} chunks from ${idx.materialCount} files → ${course.path}/search/corpus.jsonl`);
          return;
        }

        const idx = await rebuildSearchIndexes(ws, workspace);
        if (!idx) throw new ImstudiumError("No extractions yet.", "NO_CORPUS", undefined, "Run: imstudium extract");
        await sdk.studium.refreshSearchArtifacts(ws, workspace);
        output(idx, `Indexed ${idx.chunkCount} chunks across ${idx.courseCount} courses → per-course search/corpus.jsonl + materials.json`);
      }),
    );

  program
    .command("view")
    .description("Build viewer.html for slide PNGs — fast path for Playwright / browser agents")
    .option("--dir <path>", "Already-extracted directory (contains pages/)")
    .addOption(courseOption("Course (title fragment, shortcut, slug or id)"))
    .option("--file <name>", "Material filename substring")
    .addOption(outputOption())
    .action(
      act(async (opts: { dir?: string; course?: string; file?: string; output?: string }) => {
        let outDir = opts.dir ? expandPath(opts.dir) : undefined;
        let title = outDir ? basename(outDir) : "slides";

        if (!outDir) {
          if (!opts.course || !opts.file) {
            throw new ImstudiumError("Provide --dir OR both --course and --file", "BAD_ARGS", undefined, 'imstudium view --course stat --file "Blatt 1"');
          }
          const sdk = await getSdk();
          const ws = workspaceDir(sdk, opts);
          const workspace = await requireWorkspace(sdk, ws);
          const course = workspaceCourse(sdk, workspace, opts.course);
          const courseDir = resolveCourseDir(ws, course, workspace);
          const matches: string[] = [];
          const needle = opts.file.toLowerCase();
          async function walk(d: string) {
            for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
              const p = join(d, e.name);
              if (e.isDirectory()) await walk(p);
              else if (e.name.toLowerCase().includes(needle)) matches.push(p);
            }
          }
          await walk(join(courseDir, "files"));
          if (!matches.length) throw new ImstudiumError(`No file matching "${opts.file}" in ${course.title}`, "NOT_FOUND", 404);
          const src = matches[0]!;
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
      }),
    );

  const exportCmd = program.command("export").description("Export Stud.IP data as files (calendar.ics)");
  exportCmd
    .command("calendar")
    .description("Write your Stud.IP calendar as calendar.ics into the workspace")
    .addOption(outputOption("Directory for calendar.ics (default: the workspace)"))
    .action(
      act(async (opts: { output?: string }) => {
        const sdk = await getSdk();
        const me = await sdk.courses.getMe();
        const ics = await sdk.schedule.exportCalendarIcs(me.id);
        const dir = workspaceDir(sdk, opts);
        await mkdir(dir, { recursive: true });
        const path = join(dir, "calendar.ics");
        await writeFile(path, ics);
        output({ path }, `Wrote ${path}`);
      }),
    );

  program
    .command("watch")
    .description("Continuous sync loop (--json: one JSON line per round)")
    .option("--interval <duration>", "Pause between rounds: 30m, 1h, 6h (at least 5m)", "1h")
    .addOption(outputOption())
    .action(
      act(async (opts: { interval: string; output?: string }) => {
        const ms = parseDuration(opts.interval, "interval", { min: 5 * 60_000 });
        const sdk = await getSdk();
        const out = workspaceDir(sdk, opts);
        note(`Watching every ${opts.interval} → ${out} (Ctrl+C to stop)`);
        const semOpts = semesterSyncOptions(sdk, {});
        for (;;) {
          try {
            // Same pipeline as sync: files, news, forum, courseware, wiki, Abgaben, change log, NEW.md.
            const result = await runSync(sdk, { out, ...semOpts, extract: true });
            const round = { at: new Date().toISOString(), changes: result.changes, downloaded: result.report.downloaded, failed: result.report.failed };
            if (globalOpts.json) console.log(JSON.stringify({ schemaVersion: "1", ...round }));
            else if (!globalOpts.quiet) {
              const fresh = result.changes.length;
              console.log(`[${nowStamp()}] ${fresh ? `${fresh} new/updated file(s)` : "nothing new"}`);
            }
          } catch (e) {
            const err = toImstudiumError(e);
            if (globalOpts.json) console.error(JSON.stringify(err.toJSON()));
            else console.error(`[watch] ${err.code}: ${err.message}${err.code === "AUTH_REQUIRED" ? "\n[watch] sign in again with: imstudium login" : ""}`);
          }
          await sleep(ms);
        }
      }),
    );
}
