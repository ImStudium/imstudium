import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { StudIpClient } from "../client.js";
import type { FileRefAttributes, FileTreeNode, FolderAttributes, JsonApiResource } from "../types.js";
import { ensureDir } from "../config.js";

// WikiResource moved to wiki.ts; re-exported so existing imports keep working.
export * from "./wiki.js";

export type FileRefResource = JsonApiResource<"file-refs"> & { attributes?: FileRefAttributes };
export type FolderResource = JsonApiResource<"folders"> & { attributes?: FolderAttributes };

export class FilesResource {
  constructor(private client: StudIpClient) {}

  async listAllFileRefs(courseId: string): Promise<FileRefResource[]> {
    return this.client.paginateAll<FileRefResource>(`/courses/${courseId}/file-refs`);
  }

  async listAllFolders(courseId: string): Promise<FolderResource[]> {
    return this.client.paginateAll<FolderResource>(`/courses/${courseId}/folders`);
  }

  async getFileRef(id: string): Promise<FileRefResource> {
    const doc = await this.client.get<FileRefResource>(`/file-refs/${id}`);
    if (!doc.data || Array.isArray(doc.data)) throw new Error("File ref not found");
    return doc.data;
  }

  async getFolder(id: string): Promise<FolderResource> {
    const doc = await this.client.get<FolderResource>(`/folders/${id}`);
    if (!doc.data || Array.isArray(doc.data)) throw new Error("Folder not found");
    return doc.data;
  }

  async listFolderFileRefs(folderId: string): Promise<FileRefResource[]> {
    return this.client.paginateAll<FileRefResource>(`/folders/${folderId}/file-refs`);
  }

  async listSubfolders(folderId: string): Promise<FolderResource[]> {
    return this.client.paginateAll<FolderResource>(`/folders/${folderId}/folders`);
  }

  async headFileRef(id: string): Promise<string | undefined> {
    const res = await this.client.head(`/file-refs/${id}/content`);
    return res.headers.get("etag") ?? undefined;
  }

  async downloadFileRef(id: string, destPath: string): Promise<number> {
    await ensureDir(dirname(destPath));
    const res = await this.client.download(`/file-refs/${id}/content`);
    const body = res.body;
    if (!body) throw new Error("Empty response body");

    const nodeStream = Readable.fromWeb(body as import("node:stream/web").ReadableStream);
    await pipeline(nodeStream, createWriteStream(destPath));
    const stat = await import("node:fs/promises").then((fs) => fs.stat(destPath));
    return stat.size;
  }

  /** Course folder tree with files, sizes and dates (root folder = course). */
  async buildFolderTree(courseId: string): Promise<FileTreeEntry[]> {
    const [folders, fileRefs] = await Promise.all([this.listAllFolders(courseId), this.listAllFileRefs(courseId)]);
    return buildFileTree(folders, fileRefs);
  }

  /**
   * Folder id → relative path below files/ for `layout: "tree"`.
   * The course root folder maps to "" so its files land directly in files/.
   */
  folderPathMap(folders: FolderResource[]): Map<string, string> {
    return folderPaths(folders);
  }
}

// ---------------------------------------------------------------------------
// Pure file-tree helpers (no client) — used by sync, `files tree` and the app
// ---------------------------------------------------------------------------

export interface FileTreeEntry extends FileTreeNode {
  /** Path relative to the course file area ("" for the root folder). */
  path: string;
  /** File size, or the recursive total for folders. */
  size: number;
  /** Recursive file count (folders only). */
  fileCount?: number;
  folderType?: string;
  mimeType?: string;
  mkdate?: string;
  description?: string;
  children?: FileTreeEntry[];
}

function parentOf(r: JsonApiResource): string | null {
  const rel = r.relationships?.parent?.data;
  return rel && !Array.isArray(rel) ? rel.id : null;
}

/** One local path segment from a Stud.IP name; "." and ".." (or only dots) never climb. */
function segment(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return !cleaned || /^\.+$/.test(cleaned) ? "_" : cleaned;
}

function isRootFolder(f: FolderResource, byId: Map<string, FolderResource>): boolean {
  const parent = parentOf(f);
  return !parent || !byId.has(parent) || f.attributes?.["folder-type"] === "RootFolder";
}

/** Folder id → path segments joined with "/", root folder(s) = "". */
export function folderPaths(folders: FolderResource[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const cache = new Map<string, string>();
  const pathFor = (id: string, guard = 0): string => {
    const hit = cache.get(id);
    if (hit !== undefined) return hit;
    const folder = byId.get(id);
    if (!folder || guard > 64) return "";
    const p = isRootFolder(folder, byId)
      ? ""
      : [pathFor(parentOf(folder)!, guard + 1), segment(folder.attributes?.name || id)].filter(Boolean).join("/");
    cache.set(id, p);
    return p;
  };
  for (const f of folders) pathFor(f.id);
  return cache;
}

/** Nest folders and file-refs; folders first, then files, by name. Pure. */
export function buildFileTree(folders: FolderResource[], fileRefs: FileRefResource[]): FileTreeEntry[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const paths = folderPaths(folders);
  const nodes = new Map<string, FileTreeEntry>();
  for (const f of folders) {
    nodes.set(f.id, {
      id: f.id,
      name: f.attributes?.name || (isRootFolder(f, byId) ? "/" : f.id),
      type: "folder",
      path: paths.get(f.id) ?? "",
      size: 0,
      fileCount: 0,
      folderType: f.attributes?.["folder-type"],
      chdate: f.attributes?.chdate,
      mkdate: f.attributes?.mkdate,
      description: f.attributes?.description || undefined,
      children: [],
    });
  }
  for (const fr of fileRefs) {
    const parent = parentOf(fr);
    const folder = parent ? nodes.get(parent) : undefined;
    if (!folder) continue;
    const name = fr.attributes?.name || fr.id;
    const attrs = fr.attributes as (FileRefAttributes & { "mime-type"?: string }) | undefined;
    folder.children!.push({
      id: fr.id,
      name,
      type: "file",
      fileRefId: fr.id,
      path: folder.path ? `${folder.path}/${name}` : name,
      size: attrs?.filesize ?? 0,
      filesize: attrs?.filesize,
      chdate: attrs?.chdate,
      mkdate: attrs?.mkdate,
      mimeType: attrs?.["mime-type"],
      description: attrs?.description || undefined,
    });
  }
  const roots: FileTreeEntry[] = [];
  for (const f of folders) {
    const node = nodes.get(f.id)!;
    const parent = parentOf(f);
    if (!isRootFolder(f, byId) && parent && nodes.has(parent)) nodes.get(parent)!.children!.push(node);
    else roots.push(node);
  }
  const finish = (n: FileTreeEntry): void => {
    if (n.type !== "folder") return;
    n.children!.forEach(finish);
    n.children!.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, "de") : a.type === "folder" ? -1 : 1));
    n.size = n.children!.reduce((sum, c) => sum + c.size, 0);
    n.fileCount = n.children!.reduce((sum, c) => sum + (c.type === "file" ? 1 : (c.fileCount ?? 0)), 0);
  };
  roots.forEach(finish);
  return roots;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Readable tree: indented names, size and change date in aligned columns. */
export function formatFileTree(roots: FileTreeEntry[], options: { maxDepth?: number; rootLabel?: string } = {}): string[] {
  const rows: Array<{ label: string; size: string; date: string }> = [];
  const walk = (n: FileTreeEntry, depth: number, prefix: string, last: boolean) => {
    const branch = depth === 0 ? "" : `${prefix}${last ? "└── " : "├── "}`;
    const name = depth === 0 ? (options.rootLabel ?? n.name).replace(/\/+$/, "") : n.name;
    const label = n.type === "folder" ? `${branch}${name}/` : `${branch}${name}`;
    const count = n.fileCount ?? 0;
    const size = n.type === "folder" ? `${count} file${count === 1 ? "" : "s"} · ${humanSize(n.size)}` : humanSize(n.size);
    rows.push({ label, size, date: (n.chdate ?? "").slice(0, 10) });
    if (n.type !== "folder" || (options.maxDepth !== undefined && depth >= options.maxDepth)) return;
    const kids = n.children ?? [];
    const childPrefix = depth === 0 ? "" : `${prefix}${last ? "    " : "│   "}`;
    kids.forEach((c, i) => walk(c, depth + 1, childPrefix, i === kids.length - 1));
  };
  roots.forEach((r) => walk(r, 0, "", true));
  const width = Math.min(70, Math.max(10, ...rows.map((r) => r.label.length)));
  const sizeWidth = Math.max(...rows.map((r) => r.size.length), 4);
  return rows.map((r) => {
    const label = r.label.length > width ? `${r.label.slice(0, width - 1)}…` : r.label.padEnd(width);
    return `${label}  ${r.size.padStart(sizeWidth)}  ${r.date}`.trimEnd();
  });
}

// News moved to ./news.ts (dated markdown + README index); re-exported for existing imports.
export { NewsResource } from "./news.js";
