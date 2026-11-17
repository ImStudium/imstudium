export const MCP_TOOLS = [
  {
    name: "imstudium",
    description:
      "Run any read-only ImStudium command and get its JSON — the same as `imstudium --json <args>` in a terminal. " +
      "Start every session with [\"context\"]. Examples: [\"today\"], [\"week\",\"--next\"], [\"tasks\",\"--open\"], " +
      "[\"search\",\"gradient descent\"], [\"news\",\"statistik\",\"--since\",\"7d\"], [\"courseware\",\"datenbanken\"], " +
      "[\"sprechstunden\",\"statistik\"], [\"catalog\",\"search\",\"machine learning\"], [\"routes\",\"forum\"], " +
      "[\"api\",\"/users/me/courses\",\"--flat\"]. Writes and origin changes (--write, --save, -o/--output, --instance, semester start, files download, login, setup) are refused — use a terminal.",
    inputSchema: {
      type: "object",
      properties: {
        args: {
          type: "array",
          items: { type: "string" },
          description: "Command and arguments, e.g. [\"today\"] or [\"search\", \"Erwartungswert\", \"--archive\"]",
        },
      },
      required: ["args"],
    },
  },
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
    description: "List synced files by course and optional filename query. For content search, grep `<course.path>/search/corpus.jsonl` with your native tools.",
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
    name: "studium_read_material",
    description:
      "Extract one course file via the local AnyDoc + pdf-inspector pipeline. Returns markdown content. Not LaTeX; open the original file for formulas/diagrams. Photos copy into pageImages. A lecture recording returns its on-device transcript (## hh:mm:ss sections) once one exists; this tool never transcribes.",
    inputSchema: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course title substring" },
        file: { type: "string", minLength: 1, description: "Filename substring (e.g. 'vorlesung 3', 'klausur')" },
        page: { type: "integer", minimum: 1, description: "Optional: only this page/slide (1-based); for a recording, the transcript section" },
      },
      required: ["course", "file"],
    },
  },
  {
    name: "imstudium_sync_dry_run",
    description: "Preview pending file downloads without downloading",
    inputSchema: {
      type: "object",
      properties: {
        course: { type: "string" },
      },
    },
  },
  {
    name: "imstudium_list_courses",
    description: "Live course list from Stud.IP API (when workspace is stale)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "imstudium_whoami",
    description: "Check authentication status and current user",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "studium_modules",
    description: "Harness modules for mina — course/exam counts, no student id",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

export const TOOL_NAMES = MCP_TOOLS.map((t) => t.name);

interface PropertySchema {
  type: string;
  minLength?: number;
  minimum?: number;
  items?: { type: string };
}

function typeError(value: unknown, schema: PropertySchema): string | null {
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return "a string";
      return schema.minLength && value.trim().length < schema.minLength ? "a non-empty string" : null;
    case "number":
    case "integer": {
      const kind = schema.type === "integer" ? "an integer" : "a number";
      if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) return kind;
      return schema.minimum !== undefined && value < schema.minimum ? `${kind} of at least ${schema.minimum}` : null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : "true or false";
    case "array":
      if (!Array.isArray(value)) return `an array${schema.items ? ` of ${schema.items.type}s` : ""}`;
      return schema.items && value.some((v) => typeError(v, schema.items as PropertySchema)) ? `an array of ${schema.items.type}s` : null;
    default:
      return null;
  }
}

/**
 * Check a call's arguments against the tool's inputSchema before anything
 * runs: `{args: "today"}` or `{course: 123}` used to reach the handler and
 * fail as an internal error. Returns what is wrong, or null. Properties the
 * schema does not name are ignored, and so is null for an optional one.
 */
export function validateToolArgs(name: string, args: unknown): string | null {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  if (args !== undefined && args !== null && (typeof args !== "object" || Array.isArray(args))) return `${name} takes an object of arguments`;
  const given = (args ?? {}) as Record<string, unknown>;
  const schema = tool.inputSchema as { properties: Record<string, PropertySchema>; required?: readonly string[] };
  for (const key of schema.required ?? []) {
    if (given[key] === undefined || given[key] === null) return `${name} needs "${key}"`;
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (given[key] === undefined || given[key] === null) continue;
    const want = typeError(given[key], prop);
    if (want) return `"${key}" must be ${want}, got ${String(JSON.stringify(given[key])).slice(0, 60)}`;
  }
  return null;
}
