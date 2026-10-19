import type { Command } from "commander";
import { expandPath, searchWorkspace, type SearchKind } from "@imstudium/sdk";
import { act, getSdk, output } from "../runtime.js";

const KINDS: SearchKind[] = ["material", "news", "forum", "courseware", "wiki", "note"];

export function registerSearch(program: Command): void {
  program
    .command("search")
    .description("Ranked search across slides, scripts, news, forum, courseware and wiki — offline")
    .argument("<query...>", "Words to find (umlauts optional: Ubung finds Übung)")
    .option("--course <name>", "Only one course (folder or title fragment)")
    .option("--kind <kinds>", `Comma-separated: ${KINDS.join(",")}`)
    .option("--archive", "Also search past semesters (archive/)")
    .option("-n, --limit <n>", "Results", "10")
    .option("-o, --output <dir>", "Workspace directory")
    .action(
      act(async (words: string[], opts: { course?: string; kind?: string; archive?: boolean; limit: string; output?: string }) => {
        const sdk = await getSdk();
        const out = expandPath(opts.output || sdk.workspacePath);
        const query = words.join(" ");
        const kinds = opts.kind?.split(",").map((k) => k.trim()).filter((k): k is SearchKind => KINDS.includes(k as SearchKind));
        const hits = await searchWorkspace(out, query, {
          limit: Number(opts.limit) || 10,
          course: opts.course?.replace(/\s+/g, "-"),
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
        output(
          { query, count: hits.length, hits: hits.map(({ text: _text, ...h }) => ({ ...h, score: Math.round(h.score * 100) / 100 })) },
          lines.join("\n"),
        );
      }),
    );
}
