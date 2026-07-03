import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { StudIpClient } from "../client.js";
import type { FileRefAttributes, FileTreeNode, FolderAttributes, JsonApiResource } from "../types.js";
import { ensureDir } from "../config.js";

type FileRefResource = JsonApiResource<"file-refs"> & { attributes?: FileRefAttributes };
type FolderResource = JsonApiResource<"folders"> & { attributes?: FolderAttributes };

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

  async buildFolderTree(courseId: string): Promise<FileTreeNode[]> {
    const folders = await this.listAllFolders(courseId);
    const fileRefs = await this.listAllFileRefs(courseId);

    const folderMap = new Map<string, FileTreeNode>();
    const parentMap = new Map<string, string | null>();

    for (const f of folders) {
      const parentRel = f.relationships?.parent?.data;
      const parentId =
        parentRel && !Array.isArray(parentRel) ? parentRel.id : null;
      parentMap.set(f.id, parentId);
      folderMap.set(f.id, {
        id: f.id,
        name: f.attributes?.name || f.id,
        type: "folder",
        children: [],
      });
    }

    for (const fr of fileRefs) {
      const parentRel = fr.relationships?.parent?.data;
      const parentId =
        parentRel && !Array.isArray(parentRel) ? parentRel.id : null;
      if (!parentId || !folderMap.has(parentId)) continue;
      const node: FileTreeNode = {
        id: fr.id,
        name: fr.attributes?.name || fr.id,
        type: "file",
        fileRefId: fr.id,
        filesize: fr.attributes?.filesize,
        chdate: fr.attributes?.chdate,
      };
      folderMap.get(parentId)!.children!.push(node);
    }

    const roots: FileTreeNode[] = [];
    for (const [id, node] of folderMap) {
      const parentId = parentMap.get(id);
      if (parentId && folderMap.has(parentId)) {
        folderMap.get(parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  folderPathMap(folders: FolderResource[]): Map<string, string> {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const cache = new Map<string, string>();

    const pathFor = (id: string): string => {
      if (cache.has(id)) return cache.get(id)!;
      const folder = byId.get(id);
      if (!folder) return "";
      const name = folder.attributes?.name || id;
      const parentRel = folder.relationships?.parent?.data;
      const parentId =
        parentRel && !Array.isArray(parentRel) ? parentRel.id : null;
      const p = parentId && byId.has(parentId) ? join(pathFor(parentId), name) : name;
      cache.set(id, p);
      return p;
    };

    for (const f of folders) pathFor(f.id);
    return cache;
  }
}

export class WikiResource {
  constructor(private client: StudIpClient) {}

  async listCoursePages(courseId: string) {
    return this.client.paginateAll<JsonApiResource<"wiki-pages">>(
      `/courses/${courseId}/wiki-pages`,
    );
  }

  async exportCourseWiki(courseId: string, outDir: string): Promise<number> {
    await ensureDir(outDir);
    const pages = await this.listCoursePages(courseId);
    let count = 0;
    for (const page of pages) {
      const keyword = (page.attributes?.keyword as string) || page.id;
      const content = (page.attributes?.content as string) || "";
      const safeName = keyword.replace(/[^a-zA-Z0-9._-]+/g, "_");
      await writeFile(join(outDir, `${safeName}.md`), `# ${keyword}\n\n${content}\n`);
      count++;
    }
    return count;
  }
}

export class NewsResource {
  constructor(private client: StudIpClient) {}

  async listCourseNews(courseId: string) {
    return this.client.paginateAll<JsonApiResource<"news">>(`/courses/${courseId}/news`);
  }

  async exportCourseNews(courseId: string, outDir: string): Promise<number> {
    await ensureDir(outDir);
    const items = await this.listCourseNews(courseId);
    let count = 0;
    for (const item of items) {
      const title = (item.attributes?.title as string) || item.id;
      const content = (item.attributes?.content as string) || "";
      const date = (item.attributes?.mkdate as string) || "";
      const safeName = item.id.slice(0, 12);
      await writeFile(
        join(outDir, `${safeName}.md`),
        `# ${title}\n\n_${date}_\n\n${content}\n`,
      );
      count++;
    }
    return count;
  }
}
