import { z } from "zod";
import { ContextOutput } from "./cli/context.js";
import { DoctorOutput } from "./cli/doctor.js";
import {
  ArbeitCheckOutput,
  ArbeitListOutput,
  ArbeitShowOutput,
  LiteraturOutput,
  QuellenAddOutput,
  QuellenCheckOutput,
  QuellenListOutput,
  StileOutput,
  ZitierenOutput,
} from "./cli/arbeit.js";
import { CoursewareOutput, TasksOutput } from "./cli/content.js";
import { ForumOutput, MessagesOutput, NewsOutput } from "./cli/communication.js";
import { HolidaysOutput, TodayOutput, WeekOutput } from "./cli/planning.js";
import {
  ChangesOutput,
  KlausurenOutput,
  SearchOutput,
  SemesterOutput,
  SemesterStartOutput,
  SyncOutput,
} from "./cli/workspace.js";
import { envelopeV1, ErrorBody } from "./envelope.js";
import { FEED_SCHEMAS } from "./feed/index.js";

/**
 * The payload schema of every documented `--json` command, keyed by command
 * path ("semester start"). The CLI types its payloads against these; the
 * `schema` command and docs/COMMANDS.md are generated from them.
 */
export const CLI_OUTPUTS = {
  context: ContextOutput,
  today: TodayOutput,
  week: WeekOutput,
  holidays: HolidaysOutput,
  tasks: TasksOutput,
  courseware: CoursewareOutput,
  news: NewsOutput,
  inbox: MessagesOutput,
  outbox: MessagesOutput,
  forum: ForumOutput,
  search: SearchOutput,
  changes: ChangesOutput,
  klausuren: KlausurenOutput,
  semester: SemesterOutput,
  "semester start": SemesterStartOutput,
  sync: SyncOutput,
  doctor: DoctorOutput,
  arbeit: ArbeitListOutput,
  "arbeit list": ArbeitListOutput,
  "arbeit new": ArbeitShowOutput,
  "arbeit show": ArbeitShowOutput,
  "arbeit check": ArbeitCheckOutput,
  quellen: QuellenListOutput,
  "quellen list": QuellenListOutput,
  "quellen add": QuellenAddOutput,
  "quellen import": QuellenAddOutput,
  "quellen check": QuellenCheckOutput,
  zitieren: ZitierenOutput,
  literatur: LiteraturOutput,
  stile: StileOutput,
} satisfies Record<string, z.ZodType>;

export type CliCommandWithSchema = keyof typeof CLI_OUTPUTS;

/** Look up a schema by CLI command path, `error`, or `feed.<Name>`. */
export function findSchema(name: string): { name: string; schema: z.ZodType; kind: "cli" | "error" | "feed" } | null {
  const key = name.trim().replace(/\s+/g, " ");
  if (key === "error") return { name: "error", schema: ErrorBody, kind: "error" };
  if (key in CLI_OUTPUTS) {
    return { name: key, schema: envelopeV1(CLI_OUTPUTS[key as CliCommandWithSchema]), kind: "cli" };
  }
  const feed = key.replace(/^feed[.:/ ]/, "");
  if (feed !== key && feed in FEED_SCHEMAS) {
    return { name: `feed.${feed}`, schema: FEED_SCHEMAS[feed as keyof typeof FEED_SCHEMAS], kind: "feed" };
  }
  return null;
}

/** Every schema name `findSchema` accepts. */
export function schemaNames(): string[] {
  return [...Object.keys(CLI_OUTPUTS), "error", ...Object.keys(FEED_SCHEMAS).map((n) => `feed.${n}`)];
}

/** JSON Schema (draft 2020-12) for a command's `--json` output. */
export function toJsonSchema(name: string): Record<string, unknown> | null {
  const hit = findSchema(name);
  if (!hit) return null;
  // "input" mode leaves objects open (no additionalProperties:false): a new
  // key is an additive, non-breaking change; removing or retyping one is not.
  const schema = z.toJSONSchema(hit.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return {
    $id: `https://imstudium.com/schemas/${hit.kind === "feed" ? hit.name : `cli/${hit.name.replace(/ /g, "-")}`}.json`,
    title: hit.kind === "cli" ? `imstudium ${hit.name} --json` : hit.name,
    ...schema,
  };
}
