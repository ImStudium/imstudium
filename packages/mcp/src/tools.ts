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
      "Extract one course file via the local AnyDoc + pdf-inspector pipeline. Returns markdown content. Not LaTeX; open the original file for formulas/diagrams. Photos copy into pageImages.",
    inputSchema: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course title substring" },
        file: { type: "string", description: "Filename substring (e.g. 'vorlesung 3', 'klausur')" },
        page: { type: "number", description: "Optional: only this page/slide (1-based)" },
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
