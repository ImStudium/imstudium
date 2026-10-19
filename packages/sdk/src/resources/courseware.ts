/**
 * Courseware (Stud.IP 5/6 "Lernmaterial"): units → structural elements →
 * containers → blocks, plus courseware tasks (Aufgaben) with deadlines.
 *
 * Split in three layers so the same code runs in the CLI and server-side:
 *  - normalizers: JSON:API resources in, plain objects out (pure)
 *  - CoursewareResource: the only part that talks to Stud.IP (read-only GETs)
 *  - render/write live in ../content/ and take normalized data only
 *
 * Read-only on purpose: GET /courseware-structural-elements/{id} stores the
 * student's "last visited page" (COURSEWARE_LAST_ELEMENT) in Stud.IP, so this
 * module never calls it. Roots come from the unit (include=structural-element),
 * everything below from /descendants, which has no side effects.
 */
import type { JsonApiQuery, PageResult, StudIpClient } from "../client.js";
import { ImstudiumError } from "../errors.js";
import { attr, Included, relId, relIds } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";

// ---------------------------------------------------------------------------
// Normalized shapes (stable keys — CLI --json and the hosted app rely on them)
// ---------------------------------------------------------------------------

export interface CwUnit {
  id: string;
  /** Title of the unit's root page — Stud.IP has no separate unit title. */
  title: string;
  description: string;
  courseId: string | null;
  rootId: string | null;
  position: number;
  /** "course" for course material, "user" for personal (Arbeitsplatz) units. */
  rangeType: "course" | "user" | null;
  rangeId: string | null;
  visibleFrom: string | null;
  visibleUntil: string | null;
  chdate: string | null;
}

export interface CwElement {
  id: string;
  title: string;
  parentId: string | null;
  position: number;
  /** content | template | oer | portfolio | draft | other */
  purpose: string;
  description: string;
  /** Estimated time from the element payload (free text, e.g. "45 min"). */
  requiredTime: string | null;
  canVisit: boolean;
  containerIds: string[];
  taskId: string | null;
  unitId: string | null;
  chdate: string | null;
  mkdate: string | null;
}

/** Element in reading order, with its place in the outline. */
export interface CwElementNode extends CwElement {
  depth: number;
  /** 0 for the unit root, then 1… in depth-first reading order. */
  order: number;
  /** "2.1.3"-style outline number; "" for the root. */
  number: string;
  childIds: string[];
}

export interface CwSection {
  name: string;
  blockIds: string[];
}

export interface CwContainer {
  id: string;
  elementId: string | null;
  position: number;
  /** list | accordion | tabs (anything else is kept verbatim). */
  type: string;
  title: string;
  visible: boolean;
  sections: CwSection[];
  blockIds: string[];
  chdate: string | null;
}

export interface CwBlock {
  id: string;
  containerId: string | null;
  position: number;
  type: string;
  title: string;
  visible: boolean;
  payload: Record<string, unknown>;
  chdate: string | null;
}

/** File metadata needed to link and download block files. */
export interface CwFile {
  id: string;
  name: string;
  size: number | null;
  mimeType: string | null;
  chdate: string | null;
  /** false when Stud.IP says the student may not download it. */
  downloadable: boolean;
}

export type CwTaskStatus = "open" | "overdue" | "submitted" | "upcoming";

export interface CwTask {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string | null;
  unitId: string | null;
  unitTitle: string | null;
  elementId: string | null;
  taskGroupId: string | null;
  startDate: string | null;
  /** Task group end date (the deadline the lecturer set). */
  endDate: string | null;
  /** The task's own submission date (normally equal to endDate). */
  submissionDate: string | null;
  /** Effective deadline: granted renewal date, else submission date, else end date. */
  deadline: string | null;
  submitted: boolean;
  /** Courseware progress of the task pages, 0–100. */
  progress: number | null;
  renewal: "pending" | "granted" | "declined" | null;
  renewalDate: string | null;
  status: CwTaskStatus;
  /** Whole days until the deadline (negative = overdue); null without deadline. */
  daysLeft: number | null;
  url: string | null;
}

export interface CwTaskGroup {
  id: string;
  title: string;
  courseId: string | null;
  startDate: string | null;
  endDate: string | null;
  targetElementId: string | null;
  taskIds: string[];
  chdate: string | null;
}

/** Everything needed to render one unit — pure data, no client. */
export interface CoursewareUnitContent {
  courseId: string;
  unit: CwUnit;
  /** Root first, then depth-first reading order. */
  elements: CwElementNode[];
  containers: Record<string, CwContainer[]>;
  blocks: Record<string, CwBlock>;
  files: Record<string, CwFile>;
  /** Elements whose containers could not be loaded (locked, no permission). */
  errors: Array<{ elementId: string; message: string }>;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Stud.IP renders unset timestamps as 1970 via date('c', 0) — treat those as null. */
export function cleanDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t) || t < Date.UTC(1980, 0, 1)) return null;
  return v;
}

function obj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export function byPosition<T extends { position: number; id: string }>(a: T, b: T): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

// ---------------------------------------------------------------------------
// Normalizers (pure)
// ---------------------------------------------------------------------------

export function normalizeElement(r: JsonApiResource): CwElement {
  const payload = obj(attr(r, "payload"));
  return {
    id: r.id,
    title: str(attr(r, "title")).trim() || "Untitled",
    parentId: relId(r, "parent"),
    position: num(attr(r, "position")),
    purpose: str(attr(r, "purpose")) || "content",
    description: str(payload.description).trim(),
    requiredTime: str(payload.required_time).trim() || null,
    canVisit: attr<boolean>(r, "can-visit") !== false,
    containerIds: relIds(r, "containers"),
    taskId: relId(r, "task"),
    unitId: relId(r, "unit"),
    chdate: cleanDate(attr(r, "chdate")),
    mkdate: cleanDate(attr(r, "mkdate")),
  };
}

export function normalizeUnit(r: JsonApiResource, included?: Included | JsonApiResource[]): CwUnit {
  const inc = included instanceof Included ? included : new Included(included ?? []);
  const rootId = relId(r, "structural-element");
  const root = inc.get("courseware-structural-elements", rootId);
  const rangeData = r.relationships?.range?.data;
  const range = rangeData && !Array.isArray(rangeData) ? rangeData : null;
  const rangeType = range?.type === "courses" ? "course" : range?.type === "users" ? "user" : null;
  const element = root ? normalizeElement(root) : null;
  return {
    id: r.id,
    title: element?.title ?? (str(attr(r, "title")) || `Unit ${num(attr(r, "position")) + 1}`),
    description: element?.description ?? "",
    courseId: rangeType === "course" ? range!.id : null,
    rootId,
    position: num(attr(r, "position")),
    rangeType,
    rangeId: range?.id ?? null,
    visibleFrom: cleanDate(attr(r, "visible-start-date")),
    visibleUntil: cleanDate(attr(r, "visible-end-date")),
    chdate: cleanDate(attr(r, "chdate")),
  };
}

function normalizeSections(payload: Record<string, unknown>): CwSection[] {
  const raw = payload.sections;
  // initialPayload of list/accordion stores one section as an object, not an array.
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  return list.map((s) => {
    const sec = obj(s);
    const ids = Array.isArray(sec.blocks) ? sec.blocks.map((b) => str(b)).filter(Boolean) : [];
    return { name: str(sec.name).trim(), blockIds: ids };
  });
}

export function normalizeContainer(r: JsonApiResource): CwContainer {
  const payload = obj(attr(r, "payload"));
  const rawType = str(attr(r, "container-type"));
  return {
    id: r.id,
    elementId: relId(r, "structural-element"),
    position: num(attr(r, "position")),
    type: rawType.replace(/-?container$/i, "").toLowerCase() || "list",
    title: str(attr(r, "title")),
    visible: attr<boolean>(r, "visible") !== false,
    sections: normalizeSections(payload),
    blockIds: relIds(r, "blocks"),
    chdate: cleanDate(attr(r, "chdate")),
  };
}

export function normalizeBlock(r: JsonApiResource): CwBlock {
  return {
    id: r.id,
    containerId: relId(r, "container"),
    position: num(attr(r, "position")),
    type: str(attr(r, "block-type")) || "unknown",
    title: str(attr(r, "title")),
    visible: attr<boolean>(r, "visible") !== false,
    payload: obj(attr(r, "payload")),
    chdate: cleanDate(attr(r, "chdate")),
  };
}

export function normalizeFileRef(r: JsonApiResource): CwFile {
  const size = attr<number>(r, "filesize");
  return {
    id: r.id,
    name: str(attr(r, "name")) || r.id,
    size: typeof size === "number" ? size : null,
    mimeType: str(attr(r, "mime-type")) || null,
    chdate: cleanDate(attr(r, "chdate")),
    downloadable: attr<boolean>(r, "is-downloadable") !== false,
  };
}

export function normalizeTaskGroup(r: JsonApiResource): CwTaskGroup {
  return {
    id: r.id,
    title: str(attr(r, "title")).trim(),
    courseId: relId(r, "course"),
    startDate: cleanDate(attr(r, "start-date")),
    endDate: cleanDate(attr(r, "end-date")),
    targetElementId: relId(r, "target"),
    taskIds: relIds(r, "tasks"),
    chdate: cleanDate(attr(r, "chdate")),
  };
}

const DAY = 86_400_000;

/** Whole calendar days from `now` to `iso` in local time (0 = today). */
export function daysUntil(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((b - a) / DAY);
}

export interface TaskContext {
  courseId: string;
  courseTitle?: string | null;
  /** unit id → title, to name the unit a task lives in. */
  unitTitles?: Record<string, string>;
  origin?: string;
  now?: Date;
}

/**
 * One courseware task as the student sees it. Title and dates come from the
 * task group; the deadline honours a granted extension (Verlängerung).
 */
export function normalizeTask(
  r: JsonApiResource,
  included: Included | JsonApiResource[],
  ctx: TaskContext,
): CwTask {
  const inc = included instanceof Included ? included : new Included(included);
  const now = ctx.now ?? new Date();
  const groupRes = inc.one(r, "task-group");
  const group = groupRes ? normalizeTaskGroup(groupRes) : null;
  const elementRes = inc.one(r, "structural-element");
  const element = elementRes ? normalizeElement(elementRes) : null;

  const submissionDate = cleanDate(attr(r, "submission-date"));
  const renewalRaw = str(attr(r, "renewal"));
  const renewal =
    renewalRaw === "pending" || renewalRaw === "granted" || renewalRaw === "declined" ? renewalRaw : null;
  const renewalDate = cleanDate(attr(r, "renewal-date"));
  const deadline =
    renewal === "granted" && renewalDate ? renewalDate : (submissionDate ?? group?.endDate ?? null);
  const submitted = attr<boolean>(r, "submitted") === true;
  const progressRaw = attr<number>(r, "progress");
  const startDate = group?.startDate ?? null;

  let status: CwTaskStatus = "open";
  if (submitted) status = "submitted";
  else if (startDate && Date.parse(startDate) > now.getTime()) status = "upcoming";
  else if (deadline && Date.parse(deadline) < now.getTime()) status = "overdue";

  const unitId = element?.unitId ?? null;
  return {
    id: r.id,
    title: group?.title || element?.title || "Task",
    courseId: ctx.courseId,
    courseTitle: ctx.courseTitle ?? null,
    unitId,
    unitTitle: unitId ? (ctx.unitTitles?.[unitId] ?? null) : null,
    elementId: element?.id ?? relId(r, "structural-element"),
    taskGroupId: group?.id ?? relId(r, "task-group"),
    startDate,
    endDate: group?.endDate ?? null,
    submissionDate,
    deadline,
    submitted,
    progress: typeof progressRaw === "number" ? Math.round(progressRaw * 10) / 10 : null,
    renewal,
    renewalDate,
    status,
    daysLeft: daysUntil(deadline, now),
    url: ctx.origin
      ? unitId && element
        ? coursewareElementUrl(ctx.origin, ctx.courseId, unitId, element.id)
        : coursewareTasksUrl(ctx.origin, ctx.courseId)
      : null,
  };
}

/** Soonest deadline first; open before submitted; no deadline last. */
export function sortTasks(tasks: CwTask[]): CwTask[] {
  const rank = (t: CwTask) => (t.status === "submitted" ? 1 : 0);
  return [...tasks].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    const da = a.deadline ? Date.parse(a.deadline) : Infinity;
    const db = b.deadline ? Date.parse(b.deadline) : Infinity;
    return da - db || a.title.localeCompare(b.title);
  });
}

/**
 * Order the root and its descendants into reading order with depth and
 * outline numbers. Elements whose parent is missing hang under the root.
 */
export function buildElementTree(root: CwElement, descendants: CwElement[]): CwElementNode[] {
  const all = new Map<string, CwElement>([[root.id, root]]);
  for (const d of descendants) if (!all.has(d.id)) all.set(d.id, d);
  const children = new Map<string, CwElement[]>();
  for (const el of all.values()) {
    if (el.id === root.id) continue;
    const parent = el.parentId && all.has(el.parentId) ? el.parentId : root.id;
    const list = children.get(parent) ?? [];
    list.push(el);
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort(byPosition);

  const out: CwElementNode[] = [];
  const seen = new Set<string>();
  const visit = (el: CwElement, depth: number, number: string) => {
    if (seen.has(el.id)) return;
    seen.add(el.id);
    const kids = children.get(el.id) ?? [];
    out.push({ ...el, depth, order: out.length, number, childIds: kids.map((k) => k.id) });
    kids.forEach((kid, i) => visit(kid, depth + 1, number ? `${number}.${i + 1}` : String(i + 1)));
  };
  visit(root, 0, "");
  return out;
}

// ---------------------------------------------------------------------------
// Stud.IP web links (pure)
// ---------------------------------------------------------------------------

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, "").replace(/\/jsonapi\.php\/v1$/, "");
}

/** Same format Stud.IP 6 builds in StructuralElement::getURL(). */
export function coursewareElementUrl(origin: string, courseId: string, unitId: string, elementId: string): string {
  return `${trimOrigin(origin)}/dispatch.php/course/courseware/courseware/${unitId}?cid=${courseId}#/structural_element/${elementId}`;
}

export function coursewareUnitsUrl(origin: string, courseId: string): string {
  return `${trimOrigin(origin)}/dispatch.php/course/courseware?cid=${courseId}`;
}

export function coursewareTasksUrl(origin: string, courseId: string): string {
  return `${trimOrigin(origin)}/dispatch.php/course/courseware/tasks?cid=${courseId}`;
}

// ---------------------------------------------------------------------------
// Fetching (the only part that needs a client)
// ---------------------------------------------------------------------------

/** Block payload keys that point at file-refs. */
export function blockFileIds(block: CwBlock): string[] {
  const p = block.payload;
  const ids: string[] = [];
  const add = (v: unknown) => {
    const s = str(v);
    if (s && /^[0-9a-f]{32}$/i.test(s)) ids.push(s);
  };
  switch (block.type) {
    case "before-after":
      if (str(p.before_source) !== "web") add(p.before_file_id);
      if (str(p.after_source) !== "web") add(p.after_file_id);
      break;
    case "headline":
      if (str(p.background_type) === "image") add(p.background_image_id);
      break;
    case "dialog-cards":
      for (const c of Array.isArray(p.cards) ? p.cards : []) {
        add(obj(c).front_file_id);
        add(obj(c).back_file_id);
      }
      break;
    case "video":
    case "audio":
      if (str(p.source) !== "web") add(p.file_id);
      break;
    case "document":
    case "download":
    case "image-map":
    case "canvas":
      add(p.file_id);
      break;
    case "gallery":
      for (const f of Array.isArray(p.files) ? p.files : []) add(obj(f).id);
      break;
  }
  return [...new Set(ids)];
}

/** Image entries a gallery block already carries in its payload (no extra call needed). */
export function payloadFiles(block: CwBlock): CwFile[] {
  if (block.type !== "gallery") return [];
  const files = Array.isArray(block.payload.files) ? block.payload.files : [];
  return files
    .map((f): CwFile | null => {
      const o = obj(f);
      const a = obj(o.attributes);
      const id = str(o.id);
      if (!id) return null;
      const size = a.filesize;
      return {
        id,
        name: str(a.name) || id,
        size: typeof size === "number" ? size : null,
        mimeType: str(a["mime-type"]) || null,
        chdate: cleanDate(a.chdate) ?? cleanDate(a.mkdate),
        downloadable: true,
      };
    })
    .filter((f): f is CwFile => !!f);
}

export interface LoadUnitOptions {
  /** Skip the per-element container/block calls (outline only). */
  outlineOnly?: boolean;
  /** Fetch metadata for files referenced by blocks (default true). */
  fileMeta?: boolean;
}

export class CoursewareResource {
  constructor(private client: StudIpClient) {}

  /** Instance origin, e.g. https://digicampus.uni-augsburg.de */
  get origin(): string {
    return trimOrigin(this.client.apiBase);
  }

  /** paginate() with `include`, retried without it if the instance rejects the include (400). */
  private async paginateIncluding(path: string, query: JsonApiQuery): Promise<PageResult<JsonApiResource>> {
    try {
      return await this.client.paginate(path, query);
    } catch (e) {
      if (!(e instanceof ImstudiumError && e.status === 400 && query.include)) throw e;
      const { include: _drop, ...rest } = query;
      return this.client.paginate(path, rest);
    }
  }

  private async units(path: string): Promise<CwUnit[]> {
    const page = await this.paginateIncluding(path, { include: "structural-element" });
    const inc = new Included(page.included);
    return page.data.map((u) => normalizeUnit(u, inc)).sort(byPosition);
  }

  /** Units (Lernmaterialien) of a course the student can read, in shelf order. */
  async listCourseUnits(courseId: string): Promise<CwUnit[]> {
    try {
      return await this.units(`/courses/${courseId}/courseware-units`);
    } catch (e) {
      // Courseware tool not activated in this course.
      if (e instanceof ImstudiumError && (e.status === 404 || e.status === 403)) return [];
      throw e;
    }
  }

  /** The student's own units (Arbeitsplatz / contents courseware). */
  async listUserUnits(userId: string): Promise<CwUnit[]> {
    return this.units(`/users/${userId}/courseware-units`);
  }

  async getUnit(unitId: string): Promise<CwUnit> {
    const { data, included } = await this.client.getOne(`/courseware-units/${unitId}`, {
      include: "structural-element",
    });
    return normalizeUnit(data, included);
  }

  /** Root page + all readable descendants in reading order (no side effects). */
  async loadElementTree(unit: CwUnit, root?: CwElement): Promise<CwElementNode[]> {
    if (!unit.rootId) return [];
    const rootElement =
      root ??
      ({
        id: unit.rootId,
        title: unit.title,
        parentId: null,
        position: 0,
        purpose: "content",
        description: unit.description,
        requiredTime: null,
        canVisit: true,
        containerIds: [],
        taskId: null,
        unitId: unit.id,
        chdate: unit.chdate,
        mkdate: null,
      } satisfies CwElement);
    const desc = await this.client.paginateAll(`/courseware-structural-elements/${unit.rootId}/descendants`);
    return buildElementTree(rootElement, desc.map(normalizeElement));
  }

  /** Containers of one page with their blocks, both in display order. */
  async loadContainers(elementId: string): Promise<{ containers: CwContainer[]; blocks: CwBlock[] }> {
    const page = await this.paginateIncluding(`/courseware-structural-elements/${elementId}/containers`, {
      include: "blocks",
    });
    const containers = page.data.map(normalizeContainer).sort(byPosition);
    let blocks = page.included.filter((r) => r.type === "courseware-blocks").map(normalizeBlock);
    const have = new Set(blocks.map((b) => b.id));
    const missing = containers.filter((c) => c.blockIds.some((id) => !have.has(id)));
    for (const c of missing) {
      const more = await this.client.paginateAll(`/courseware-containers/${c.id}/blocks`);
      blocks = blocks.concat(more.map(normalizeBlock).filter((b) => !have.has(b.id)));
    }
    return { containers, blocks: blocks.sort(byPosition) };
  }

  async fileMeta(fileRefId: string): Promise<CwFile | null> {
    try {
      const { data } = await this.client.getOne(`/file-refs/${fileRefId}`);
      return normalizeFileRef(data);
    } catch (e) {
      if (e instanceof ImstudiumError && (e.status === 403 || e.status === 404)) return null;
      throw e;
    }
  }

  /** Files attached to one block (Stud.IP's own list for the block). */
  async listBlockFiles(blockId: string): Promise<CwFile[]> {
    const doc = await this.client.get(`/courseware-blocks/${blockId}/file-refs`);
    const list = Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
    return list.map(normalizeFileRef);
  }

  /** Full unit: outline, containers, blocks and file metadata — ready to render. */
  async loadUnitContent(unit: CwUnit, options: LoadUnitOptions = {}): Promise<CoursewareUnitContent> {
    const elements = await this.loadElementTree(unit);
    const content: CoursewareUnitContent = {
      courseId: unit.courseId ?? unit.rangeId ?? "",
      unit,
      elements,
      containers: {},
      blocks: {},
      files: {},
      errors: [],
    };
    if (options.outlineOnly) return content;

    await Promise.all(
      elements.map(async (el) => {
        try {
          const { containers, blocks } = await this.loadContainers(el.id);
          content.containers[el.id] = containers;
          for (const b of blocks) content.blocks[b.id] = b;
        } catch (e) {
          content.containers[el.id] = [];
          const status = e instanceof ImstudiumError ? e.status : undefined;
          // 403: page locked by progression rules; 404: page has no content (yet).
          if (status === 403) el.canVisit = false;
          else if (status !== 404) {
            content.errors.push({ elementId: el.id, message: e instanceof Error ? e.message : String(e) });
          }
        }
      }),
    );

    if (options.fileMeta !== false) {
      const wanted = new Set<string>();
      for (const b of Object.values(content.blocks)) {
        for (const f of payloadFiles(b)) content.files[f.id] = f;
        for (const id of blockFileIds(b)) if (!content.files[id]) wanted.add(id);
      }
      await Promise.all(
        [...wanted].map(async (id) => {
          const meta = await this.fileMeta(id).catch(() => null);
          if (meta) content.files[id] = meta;
        }),
      );
    }
    return content;
  }

  /**
   * Courseware tasks of a course for the signed-in student. Stud.IP only
   * returns tasks of started task groups the student (or their group) solves.
   */
  async listTasks(
    courseId: string,
    ctx: Omit<TaskContext, "courseId"> = {},
  ): Promise<CwTask[]> {
    let page;
    try {
      page = await this.paginateIncluding("/courseware-tasks", {
        filter: { cid: courseId },
        include: "task-group,structural-element",
      });
    } catch (e) {
      if (e instanceof ImstudiumError && (e.status === 404 || e.status === 403)) return [];
      throw e;
    }
    const inc = new Included(page.included);
    return sortTasks(
      page.data.map((t) => normalizeTask(t, inc, { origin: this.origin, ...ctx, courseId })),
    );
  }

  async getTaskGroup(id: string): Promise<CwTaskGroup> {
    const { data } = await this.client.getOne(`/courseware-task-groups/${id}`);
    return normalizeTaskGroup(data);
  }
}
