import { access, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { ensureDir } from "./config.js";
import { EXTRACTION_LIMITS_FOR_AGENTS } from "./extraction-guidance.js";
import type { MaterialKind, StudiumCourse, StudiumWorkspace } from "./types.js";

/** Slim search record — text lives here for keyword search; full page also in content.md. */
export interface SearchChunk {
  ref: string;
  citation: string;
  coursePath: string;
  courseTitle: string;
  sourceFile: string;
  extractSlug: string;
  page: number;
  pageLabel: string;
  kind: MaterialKind | "slides" | "document" | "image" | string;
  text: string;
  /** Relative to extractDir, e.g. pages/page-15.png */
  pageImage?: string;
}

export interface MaterialEntry {
  sourceFile: string;
  kind: MaterialKind | string;
  pages: number;
  extracted: boolean;
  extractSlug?: string;
  error?: string;
}

export interface MaterialsManifest {
  schemaVersion: "1";
  courseTitle: string;
  coursePath: string;
  materialCount: number;
  extractedCount: number;
  totalPages: number;
  materials: MaterialEntry[];
  generatedAt: string;
}

export interface CourseSearchIndex {
  schemaVersion: "1";
  courseTitle: string;
  coursePath: string;
  chunkCount: number;
  materialCount: number;
  corpusPath: string;
  indexedAt: string;
}

export interface WorkspaceSearchIndex {
  schemaVersion: "1";
  chunkCount: number;
  courseCount: number;
  indexedAt: string;
  courses: Array<{ coursePath: string; courseTitle: string; chunkCount: number; corpusPath: string }>;
}

const PAGE_HEADING = /^## (Page|Slide) (\d+)\s*$/m;
const PLACEHOLDER = /(?:^|[_(]) *(no extractable text|OCR — verify)/i;
const MIN_TEXT = 24;

/** Split content.md into page/slide sections. */
export function parseContentMdSections(content: string): Array<{ page: number; label: string; text: string }> {
  const parts = content.split(PAGE_HEADING);
  if (parts.length <= 1) {
    const body = content.replace(/^#[^\n]*\n+/m, "").replace(/^>[^\n]*\n+/gm, "").trim();
    return body ? [{ page: 1, label: "Page", text: body }] : [];
  }

  const sections: Array<{ page: number; label: string; text: string }> = [];
  for (let i = 1; i < parts.length; i += 3) {
    const label = parts[i] || "Page";
    const page = parseInt(parts[i + 1] || "1", 10);
    const text = (parts[i + 2] || "").trim();
    if (text) sections.push({ page, label, text });
  }
  return sections;
}

/** Index only pages worth citing: meaningful text or a rendered page image. */
export function isIndexableSection(text: string, hasPageImage: boolean): boolean {
  const trimmed = text.trim();
  if (hasPageImage) return true;
  if (!trimmed || trimmed.length < MIN_TEXT) return false;
  if (PLACEHOLDER.test(trimmed)) return false;
  return true;
}

export function pageRef(coursePath: string, sourceFile: string, page: number): string {
  return `${coursePath}#${sourceFile}:${page}`;
}

export function parsePageRef(ref: string): { coursePath: string; sourceFile: string; page: number } | null {
  const m = ref.match(/^(.+?)#(.+):(\d+)$/);
  if (!m) return null;
  return { coursePath: m[1], sourceFile: m[2], page: parseInt(m[3], 10) };
}

async function pageImageRel(extractDir: string, page: number, label: string): Promise<string | undefined> {
  const candidates = [
    join(extractDir, "pages", `page-${String(page).padStart(3, "0")}.png`),
    join(extractDir, "pages", `page-${String(page).padStart(2, "0")}.png`),
    join(extractDir, "pages", `page-${page}.png`),
  ];
  if (label === "Slide") {
    candidates.unshift(
      join(extractDir, "pages", `slide-${String(page).padStart(3, "0")}.png`),
      join(extractDir, "pages", `slide-${String(page).padStart(2, "0")}.png`),
    );
  }
  for (const abs of candidates) {
    try {
      await access(abs);
      return relative(extractDir, abs);
    } catch {
      // try next
    }
  }
  return undefined;
}

export interface ExtractionSearchContext {
  workspaceRoot: string;
  courseTitle: string;
  coursePath: string;
}

export function inferWorkspaceRoot(sourcePath: string): string | null {
  const m = sourcePath.match(/^(.+)\/[^/]+\/[^/]+\/files\//);
  return m?.[1] ?? null;
}

export function inferSearchContext(sourcePath: string, workspaceRoot: string): ExtractionSearchContext | null {
  const rel = relative(workspaceRoot, sourcePath);
  const m = rel.match(/^([^/]+\/[^/]+)\/files\//);
  if (!m) return null;
  const coursePath = m[1];
  return {
    workspaceRoot,
    courseTitle: basename(coursePath).replace(/-/g, " "),
    coursePath,
  };
}

/** Parse one extraction into search chunks (in memory — no duplicate files). */
export async function parseExtractionChunks(
  extractDir: string,
  ctx: ExtractionSearchContext,
  kind: MaterialKind | "slides" | "document" = "pdf",
): Promise<SearchChunk[]> {
  let content: string;
  let manifest: { source?: string; kind?: string };
  try {
    content = await readFile(join(extractDir, "content.md"), "utf-8");
    manifest = JSON.parse(await readFile(join(extractDir, "manifest.json"), "utf-8"));
  } catch {
    return [];
  }

  const sourceFile = basename(manifest.source || extractDir);
  const extractSlug = basename(extractDir);
  const sections = parseContentMdSections(content);
  const chunks: SearchChunk[] = [];

  for (const section of sections) {
    const pageImage = await pageImageRel(extractDir, section.page, section.label);
    if (!isIndexableSection(section.text, !!pageImage)) continue;

    chunks.push({
      ref: pageRef(ctx.coursePath, sourceFile, section.page),
      citation: `${ctx.courseTitle} · ${sourceFile} · ${section.label === "Slide" ? "slide" : "p."}${section.page}`,
      coursePath: ctx.coursePath,
      courseTitle: ctx.courseTitle,
      sourceFile,
      extractSlug,
      page: section.page,
      pageLabel: section.label,
      kind: (manifest.kind as MaterialKind) || kind,
      text: section.text,
      ...(pageImage ? { pageImage } : {}),
    });
  }
  return chunks;
}

/** Resolve filesystem paths for a search hit. */
export function chunkPaths(workspaceRoot: string, chunk: SearchChunk): {
  extractDir: string;
  contentMd: string;
  pageImage?: string;
} {
  const extractDir = join(workspaceRoot, chunk.coursePath, "extracted", chunk.extractSlug);
  return {
    extractDir,
    contentMd: join(extractDir, "content.md"),
    pageImage: chunk.pageImage ? join(extractDir, chunk.pageImage) : undefined,
  };
}

/** Read one page section from content.md (fallback when corpus text is truncated). */
export async function readPageSection(extractDir: string, page: number): Promise<string | null> {
  try {
    const content = await readFile(join(extractDir, "content.md"), "utf-8");
    for (const s of parseContentMdSections(content)) {
      if (s.page === page) return s.text;
    }
  } catch {
    // missing extraction
  }
  return null;
}

export async function buildMaterialsManifest(
  courseDir: string,
  course: Pick<StudiumCourse, "title" | "path">,
): Promise<MaterialsManifest> {
  const coursePath = course.path || basename(courseDir);
  const filesDir = join(courseDir, "files");
  const extractedRoot = join(courseDir, "extracted");

  const sourceFiles = await walkFilesFlat(filesDir);
  const extractDirs = new Map<string, string>();
  for (const e of await readdir(extractedRoot, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) extractDirs.set(e.name, join(extractedRoot, e.name));
  }

  const materials: MaterialEntry[] = [];
  for (const src of sourceFiles) {
    const sourceFile = basename(src);
    const entry: MaterialEntry = {
      sourceFile,
      kind: "unknown",
      pages: 0,
      extracted: false,
    };

    for (const [slug, dir] of extractDirs) {
      try {
        const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf-8")) as {
          source?: string;
          kind?: string;
          pages?: number;
          error?: string;
        };
        if (manifest.source !== src && basename(manifest.source || "") !== sourceFile) continue;
        entry.extracted = !manifest.error;
        entry.extractSlug = slug;
        entry.kind = manifest.kind || "unknown";
        entry.pages = manifest.pages || 0;
        entry.error = manifest.error;
        break;
      } catch {
        continue;
      }
    }
    materials.push(entry);
  }

  materials.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile));
  const manifest: MaterialsManifest = {
    schemaVersion: "1",
    courseTitle: course.title,
    coursePath,
    materialCount: materials.length,
    extractedCount: materials.filter((m) => m.extracted).length,
    totalPages: materials.reduce((n, m) => n + m.pages, 0),
    materials,
    generatedAt: new Date().toISOString(),
  };

  const searchDir = join(courseDir, "search");
  await ensureDir(searchDir);
  await writeFile(join(searchDir, "materials.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function walkFilesFlat(dir: string, out: string[] = []): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walkFilesFlat(p, out);
      else out.push(p);
    }
  } catch {
    // missing dir is fine
  }
  return out;
}

async function loadCorpusLines(corpusPath: string): Promise<SearchChunk[]> {
  const raw = await readFile(corpusPath, "utf-8").catch(() => "");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SearchChunk);
}

export async function resolvePageRef(
  workspacePath: string,
  workspace: StudiumWorkspace,
  ref: string,
): Promise<SearchChunk | null> {
  const parsed = parsePageRef(ref);
  if (!parsed) return null;
  const course = workspace.courses.find((c) => c.path === parsed.coursePath);
  if (!course?.path) return null;
  const chunks = await loadCorpusLines(join(workspacePath, course.path, "search", "corpus.jsonl"));
  return (
    chunks.find(
      (c) => c.sourceFile === parsed.sourceFile && c.page === parsed.page,
    ) ?? null
  );
}

/** Drop legacy duplicate artifacts from older index runs. */
async function cleanupLegacySearchArtifacts(courseDir: string): Promise<void> {
  const extractedRoot = join(courseDir, "extracted");
  for (const e of await readdir(extractedRoot, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory()) continue;
    const extractDir = join(extractedRoot, e.name);
    await rm(join(extractDir, "chunks"), { recursive: true, force: true }).catch(() => {});
    await rm(join(extractDir, "chunks.jsonl"), { force: true }).catch(() => {});
  }
  await rm(join(courseDir, "search", "CORPUS.md"), { force: true }).catch(() => {});
  await rm(join(courseDir, "MATERIALS.md"), { force: true }).catch(() => {});
}

export async function buildCourseSearchIndex(
  courseDir: string,
  course: Pick<StudiumCourse, "title" | "path">,
  workspaceRoot?: string,
): Promise<CourseSearchIndex | null> {
  const extractedRoot = join(courseDir, "extracted");
  const searchDir = join(courseDir, "search");
  await ensureDir(searchDir);
  await cleanupLegacySearchArtifacts(courseDir);

  const wsRoot = workspaceRoot || courseDir.replace(/\/[^/]+\/[^/]+$/, "");
  const ctx: ExtractionSearchContext = {
    workspaceRoot: wsRoot,
    courseTitle: course.title,
    coursePath: course.path || basename(courseDir),
  };

  const allChunks: SearchChunk[] = [];
  for (const e of await readdir(extractedRoot, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory()) continue;
    allChunks.push(...(await parseExtractionChunks(join(extractedRoot, e.name), ctx)));
  }

  if (allChunks.length === 0) return null;

  allChunks.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile) || a.page - b.page);

  const corpusPath = join(searchDir, "corpus.jsonl");
  await writeFile(corpusPath, allChunks.map((c) => JSON.stringify(c)).join("\n") + "\n");

  const materialCount = new Set(allChunks.map((c) => c.sourceFile)).size;
  const index: CourseSearchIndex = {
    schemaVersion: "1",
    courseTitle: course.title,
    coursePath: course.path || basename(courseDir),
    chunkCount: allChunks.length,
    materialCount,
    corpusPath: relative(courseDir, corpusPath),
    indexedAt: new Date().toISOString(),
  };
  await writeFile(join(searchDir, "index.json"), JSON.stringify(index, null, 2));
  return index;
}

/** Workspace index = stats only — no merged corpus file. */
export async function buildWorkspaceSearchIndex(
  workspacePath: string,
  workspace: StudiumWorkspace,
): Promise<WorkspaceSearchIndex | null> {
  const searchDir = join(workspacePath, "search");
  await ensureDir(searchDir);
  await rm(join(searchDir, "corpus.jsonl"), { force: true }).catch(() => {});

  const courseStats: WorkspaceSearchIndex["courses"] = [];
  let totalChunks = 0;

  for (const course of workspace.courses) {
    if (!course.path) continue;
    const courseDir = join(workspacePath, course.path);
    let idx: CourseSearchIndex | null = null;
    try {
      idx = JSON.parse(await readFile(join(courseDir, "search", "index.json"), "utf-8")) as CourseSearchIndex;
    } catch {
      idx = await buildCourseSearchIndex(courseDir, course, workspacePath);
    }
    if (!idx) continue;
    totalChunks += idx.chunkCount;
    courseStats.push({
      coursePath: course.path,
      courseTitle: course.title,
      chunkCount: idx.chunkCount,
      corpusPath: `${course.path}/${idx.corpusPath}`,
    });
  }

  if (totalChunks === 0) return null;

  const index: WorkspaceSearchIndex = {
    schemaVersion: "1",
    chunkCount: totalChunks,
    courseCount: courseStats.length,
    indexedAt: new Date().toISOString(),
    courses: courseStats,
  };
  await writeFile(join(searchDir, "index.json"), JSON.stringify(index, null, 2));
  return index;
}

export interface AgentSearchGuidance {
  /** The harness already has grep / codebase / semantic search — use those on the paths below. */
  useNativeSearch: true;
  llmsTxt: string;
  corpusGlob: string;
  corpusFields: Array<"ref" | "citation" | "text" | "pageImage" | "extractSlug" | "sourceFile" | "page" | "coursePath">;
  grepExample: string;
  citeWith: string;
  resolveHit: {
    materialsIndex: string;
    pageText: string;
    pageImage: string;
  };
  chunkCount?: number;
  courseCount?: number;
  /** What local extraction can and cannot do — especially formulas / LaTeX. */
  extractionLimits: readonly string[];
}

/** Tell agents how to search — do not reimplement grep/semantic search in MCP/CLI. */
export function agentSearchGuidance(
  workspacePath: string,
  workspace: StudiumWorkspace,
): AgentSearchGuidance {
  const semSlug = workspace.activeSemester?.slug || "*";
  const corpusGlob = join(workspacePath, semSlug, "*", "search", "corpus.jsonl");
  return {
    useNativeSearch: true,
    llmsTxt: join(workspacePath, "llms.txt"),
    corpusGlob,
    corpusFields: ["ref", "citation", "text", "pageImage", "extractSlug", "sourceFile", "page", "coursePath"],
    grepExample: `rg -i "your terms" "${join(workspacePath, semSlug, "*", "search", "corpus.jsonl")}"`,
    citeWith: "ref field in each JSONL line (e.g. SS2026/Course#file.pdf:5)",
    resolveHit: {
      materialsIndex: "search/materials.json",
      pageText: "extracted/<extractSlug>/content.md (## Page N section)",
      pageImage: "extracted/<extractSlug>/pages/page-NNN.png",
    },
    chunkCount: workspace.search?.chunkCount,
    courseCount: workspace.search?.courseCount,
    extractionLimits: EXTRACTION_LIMITS_FOR_AGENTS,
  };
}

export async function rebuildSearchIndexes(
  workspacePath: string,
  workspace: StudiumWorkspace,
): Promise<WorkspaceSearchIndex | null> {
  for (const course of workspace.courses) {
    if (!course.path) continue;
    const courseDir = join(workspacePath, course.path);
    await buildCourseSearchIndex(courseDir, course, workspacePath);
    await buildMaterialsManifest(courseDir, course);
  }
  return buildWorkspaceSearchIndex(workspacePath, workspace);
}
