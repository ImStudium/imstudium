import type { Command } from "commander";
import { ImstudiumError, resolveWorkspaceCourse, searchWorkspace, type SearchKind } from "@imstudium/sdk";
import type { SearchOutput } from "@imstudium/contract";
import { act, getSdk, output } from "../runtime.js";
import { courseOption, limitOption, outputOption, parseLimit, workspaceDir } from "../kit/args.js";
import { notFoundAsUndefined } from "../course-arg.js";

const KINDS: SearchKind[] = ["material", "news", "forum", "courseware", "wiki", "note"];

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
          const hit = ws ? notFoundAsUndefined(() => resolveWorkspaceCourse(ws, opts.course!, sdk.config.courseAliases)) : undefined;
          if (hit) course = hit.slug;
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
              `    ${h.path}${h.page ? `  (page ${h.page})` : ""}`,
            ])
          : [`No hits for "${query}". Try fewer words, --archive, or imstudium sync --extract to index new files.`];
        const payload: SearchOutput = { query, count: hits.length, hits: hits.map(({ text: _text, ...h }) => ({ ...h, score: Math.round(h.score * 100) / 100 })) };
        output(payload, lines.join("\n"));
      }),
    );
}
