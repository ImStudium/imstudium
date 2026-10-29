import type { Command } from "commander";
import { formatFileTree, ImstudiumError } from "@imstudium/sdk";
import { act, getSdk, output } from "../runtime.js";
import { resolveCourse } from "../course-arg.js";
import { parseLimit } from "../kit/args.js";
import { table } from "../kit/format.js";
import { semesterSyncOptions } from "./workspace.js";

export function registerCourses(program: Command): void {
  const courses = program.command("courses").description("Your enrolled courses (live from Stud.IP)");

  courses
    .command("list")
    .description("List my courses (current semester by default)")
    .option("--semester <name>", "Semester title or slug (default: calendar current)")
    .option("--all-semesters", "List every enrollment")
    .action(
      act(async (opts: { semester?: string; allSemesters?: boolean }) => {
        const sdk = await getSdk();
        const me = await sdk.courses.getMe();
        const semOpts = semesterSyncOptions(sdk, opts);
        const ctx = await sdk.courses.resolveSemesterContext(semOpts);
        const list = await sdk.courses.listMine(me.id, {
          semesterId: "semesterId" in semOpts ? semOpts.semesterId : ctx?.semester.id,
          allSemesters: opts.allSemesters,
        });
        const rows = list.map((c) => ({
          id: c.id,
          title: c.attributes?.title,
          type: c.attributes?.["course-type"],
          number: c.attributes?.["course-number"],
        }));
        output(
          { courses: rows, semester: ctx ? { id: ctx.semester.id, title: ctx.title, slug: ctx.slug } : undefined, count: list.length },
          [
            ctx ? `${list.length} courses in ${ctx.title}` : `${list.length} courses (all semesters)`,
            "",
            ...table(rows.map((r) => [String(r.number ?? ""), String(r.title ?? ""), r.id]), { indent: "  ", maxWidths: [12, 60] }),
          ].join("\n"),
        );
      }),
    );

  courses
    .command("show <course>")
    .description("One course in detail (title fragment, shortcut, slug or id)")
    .action(
      act(async (query: string) => {
        const sdk = await getSdk();
        const ref = await resolveCourse(sdk, query);
        const full = await sdk.courses.get(ref.id);
        const fileCount = (await sdk.files.listAllFileRefs(ref.id)).length;
        const a = (full.attributes ?? {}) as Record<string, unknown>;
        output(
          { course: full, fileCount },
          [
            String(a.title ?? ref.title),
            ...table(
              [
                ["Number", String(a["course-number"] ?? "—")],
                ["Type", String(a["course-type"] ?? "—")],
                ["Files", String(fileCount)],
                ["Folder", ref.dir ?? "not in the workspace (imstudium sync)"],
                ["Id", ref.id],
              ],
              { indent: "  " },
            ),
          ].join("\n"),
        );
      }),
    );

  const files = program.command("files").description("Course files: folder tree and single downloads");

  files
    .command("tree <course>")
    .description("Folder/file tree of a course with sizes and change dates")
    .option("--depth <n>", "Only show folders down to this depth")
    .action(
      act(async (courseName: string, opts: { depth?: string }) => {
        const sdk = await getSdk();
        const course = await resolveCourse(sdk, courseName);
        const tree = await sdk.files.buildFolderTree(course.id);
        const count = tree.reduce((n, r) => n + (r.fileCount ?? 0), 0);
        const bytes = tree.reduce((n, r) => n + r.size, 0);
        const lines = formatFileTree(tree, { rootLabel: course.title, maxDepth: opts.depth === undefined ? undefined : parseLimit(opts.depth, 0, "depth", 0) });
        output(
          { courseId: course.id, courseTitle: course.title, files: count, bytes, tree },
          count
            ? [...lines, "", `Download one: imstudium files download <id> · all: imstudium sync --course "${courseName}" --layout tree`].join("\n")
            : `${course.title}: no files`,
        );
      }),
    );

  files
    .command("download <fileRefId>")
    .description("Download a single file (writes to -o or the file's own name)")
    .option("-o, --output <path>", "Output file path (a write destination, not the workspace)")
    .action(
      act(async (fileRefId: string, opts: { output?: string }) => {
        const sdk = await getSdk();
        const meta = await sdk.files.getFileRef(fileRefId);
        const name = meta.attributes?.name || fileRefId;
        const dest = opts.output || name;
        if (!dest) throw new ImstudiumError("No output path", "BAD_ARGS");
        const bytes = await sdk.files.downloadFileRef(fileRefId, dest);
        output({ path: dest, bytes }, `Downloaded ${dest} (${bytes} bytes)`);
      }),
    );
}
