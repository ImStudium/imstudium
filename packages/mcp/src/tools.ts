export const MCP_TOOLS = [
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
      "Extract one course file (PDF/PPTX/DOCX/images). Returns text + pageImages + viewerHtml. MANDATORY for agents: read every pageImage OR open viewerFileUrl in Playwright/browser before explaining slides — text alone misses diagrams and formulas.",
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
    name: "digicampus_sync",
    description: "Refresh workspace from live DigiCampus (requires login). Full sync + rebuild.",
    inputSchema: {
      type: "object",
      properties: {
        course: { type: "string", description: "Optional single course filter" },
      },
    },
  },
  {
    name: "digicampus_sync_dry_run",
    description: "Preview pending file downloads without downloading",
    inputSchema: {
      type: "object",
      properties: {
        course: { type: "string" },
      },
    },
  },
  {
    name: "digicampus_list_courses",
    description: "Live course list from DigiCampus API (when workspace is stale)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "digicampus_whoami",
    description: "Check authentication status and current user",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

export const TOOL_NAMES = MCP_TOOLS.map((t) => t.name);
