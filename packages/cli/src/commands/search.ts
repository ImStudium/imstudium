import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { ImstudiumError, resolveWorkspaceCourse, searchWorkspace, type SearchKind } from "@imstudium/sdk";
import type { SearchOutput } from "@imstudium/contract";
import { act, getSdk, output } from "../runtime.js";
import { courseOption, limitOption, outputOption, parseLimit, workspaceDir } from "../kit/args.js";

const KINDS: SearchKind[] = ["material", "news", "forum", "courseware", "wiki", "note"];

/** A course folder (`<semester>/<course>` or `archive/<semester>/<course>`) whose path contains `name`, the way search filters. */
async function hasCourseFolder(workspace: string, name: string): Promise<boolean> {
  const dirs = async (dir: string) => (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  const needle = name.toLowerCase();
  for (const sem of await dirs(workspace)) {
    const semesters = sem === "archive" ? (await dirs(join(workspace, sem))).map((s) => `archive/${s}`) : [sem];
    for (const s of semesters) {
      if ((await dirs(join(workspace, s))).some((c) => `${s}/${c}`.toLowerCase().includes(needle))) return true;
    }
  }
  return false;
}

export function registerSearch(program: Command): void {
  program
    .command("search")
    .description("Ranked search across slides, scripts, news, forum, courseware and wiki — offline")
    .argument("<query...>", "Words to find (umlauts optional: Ubung finds Übung)")
    .addOption(courseOption("Only one course (shortcut, title fragment, slug or folder name)"))
    .option("--kind <kinds>", `Comma-separated: ${KINDS.join(",")}`)
    .option("--archive", "Also search past semesters (archive/)")
    .addOption(limitOption(10, "Results"))
    .addOption(outputOption())
    .action(
      act(async (words: string[], opts: { course?: string; kind?: string; archive?: boolean; limit?: string; output?: string }) => {
        const sdk = await getSdk();
        const out = workspaceDir(sdk, opts);
        const query = words.join(" ");
        const limit = parseLimit(opts.limit, 10);
        const kindList = opts.kind?.split(",").map((k) => k.trim()).filter(Boolean);
        const badKinds = kindList?.filter((k) => !KINDS.includes(k as SearchKind)) ?? [];
        if (badKinds.length) throw new ImstudiumError(`Unknown --kind: ${badKinds.join(", ")}`, "BAD_ARGS", undefined, `Choose from: ${KINDS.join(",")}`);
        const kinds = kindList as SearchKind[] | undefined;
        // "nlp", a title fragment or a slug → the course folder name
        let course = opts.course?.replace(/\s+/g, "-");
        if (opts.course) {
          const ws = await sdk.studium.loadWorkspace(out);
          if (ws) {
            try {
              course = resolveWorkspaceCourse(ws, opts.course, sdk.config.courseAliases).slug;
            } catch (e) {
              // a course of an earlier semester has a folder under archive/ but no entry in studium.json
              if (!(e instanceof ImstudiumError && e.code === "COURSE_NOT_FOUND") || !(await hasCourseFolder(out, course!))) throw e;
            }
          }
        }
        const hits = await searchWorkspace(out, query, {
          limit,
          course,
          kinds,
          includeArchive: opts.archive,
        });
        const lines = hits.length
          ? hits.flatMap((h, i) => [
              `${String(i + 1).padStart(2)}. ${h.citation}  [${h.kind}]`,
              `    ${h.snippet}`,
              `    ${h.path}${h.at ? `  (at ${h.at})` : h.page ? `  (page ${h.page})` : ""}`,
            ])
          : [`No hits for "${query}". Try fewer words, --archive, or imstudium sync --extract to index new files.`];
        const payload: SearchOutput = { query, count: hits.length, hits: hits.map(({ text: _text, ...h }) => ({ ...h, score: Math.round(h.score * 100) / 100 })) };
        output(payload, lines.join("\n"));
      }),
    );
}
