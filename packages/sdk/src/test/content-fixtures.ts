/**
 * Synthetic Stud.IP JSON:API fixtures for courseware, tasks, wiki and files.
 * Everything here is invented — no real course material, names or ids.
 */
import type { JsonApiResource } from "../types.js";

/** Deterministic fake 32-hex Stud.IP id. */
export function hid(tag: string): string {
  let hex = "";
  for (const ch of tag) hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return hex.padEnd(32, "0").slice(0, 32);
}

export const COURSE = hid("course");
export const UNIT = hid("unit1");
export const ROOT = hid("root");
export const CH1 = hid("ch1");
export const CH2 = hid("ch2");
export const CH1A = hid("ch1a");
export const FILE_PDF = hid("filepdf");
export const FILE_IMG = hid("fileimg");
export const FILE_HIDDEN = hid("filehid");

const one = (type: string, id: string) => ({ data: { type, id } });
const many = (type: string, ids: string[]) => ({ data: ids.map((id) => ({ type, id })) });

export function element(
  id: string,
  title: string,
  position: number,
  parent: string | null,
  extra: Record<string, unknown> = {},
  containers: string[] = [],
): JsonApiResource {
  return {
    type: "courseware-structural-elements",
    id,
    attributes: {
      title,
      position,
      purpose: "content",
      payload: { description: "", required_time: "" },
      "can-visit": true,
      chdate: "2026-10-01T10:00:00+02:00",
      mkdate: "2026-09-01T10:00:00+02:00",
      ...extra,
    },
    relationships: {
      parent: parent ? one("courseware-structural-elements", parent) : { data: null },
      containers: many("courseware-containers", containers),
      course: one("courses", COURSE),
      unit: one("courseware-units", UNIT),
    },
  };
}

export function unitResource(id = UNIT, root = ROOT, position = 0): JsonApiResource {
  return {
    type: "courseware-units",
    id,
    attributes: {
      position,
      "content-type": "courseware",
      "visible-start-date": null,
      chdate: "2026-10-01T10:00:00+02:00",
    },
    relationships: {
      "structural-element": one("courseware-structural-elements", root),
      range: one("courses", COURSE),
    },
  };
}

export function container(
  id: string,
  elementId: string,
  type: string,
  blocks: string[],
  sections: unknown = [{ name: "", icon: "", blocks }],
  position = 0,
): JsonApiResource {
  return {
    type: "courseware-containers",
    id,
    attributes: {
      position,
      "container-type": type,
      title: type,
      visible: true,
      payload: { colspan: "full", sections },
      chdate: "2026-10-02T10:00:00+02:00",
    },
    relationships: {
      blocks: many("courseware-blocks", blocks),
      "structural-element": one("courseware-structural-elements", elementId),
    },
  };
}

export function block(
  id: string,
  type: string,
  payload: Record<string, unknown>,
  position = 0,
  containerId = hid("cont"),
): JsonApiResource {
  return {
    type: "courseware-blocks",
    id,
    attributes: {
      position,
      "block-type": type,
      title: type,
      visible: true,
      payload,
      chdate: "2026-10-03T10:00:00+02:00",
    },
    relationships: { container: one("courseware-containers", containerId) },
  };
}

export function fileRef(id: string, name: string, size = 2048, downloadable = true, parent = hid("folder")): JsonApiResource {
  return {
    type: "file-refs",
    id,
    attributes: {
      name,
      filesize: size,
      "mime-type": name.endsWith(".png") ? "image/png" : "application/pdf",
      chdate: "2026-10-04T08:30:00+02:00",
      mkdate: "2026-10-04T08:30:00+02:00",
      "is-downloadable": downloadable,
    },
    relationships: { parent: one("folders", parent) },
  };
}

export function taskGroup(id: string, title: string, start: string, end: string): JsonApiResource {
  return {
    type: "courseware-task-groups",
    id,
    attributes: { title, "start-date": start, "end-date": end, chdate: start },
    relationships: { course: one("courses", COURSE) },
  };
}

export function task(
  id: string,
  group: string,
  elementId: string,
  attrs: Record<string, unknown>,
): JsonApiResource {
  return {
    type: "courseware-tasks",
    id,
    attributes: {
      progress: 0,
      "submission-date": "2026-10-24T23:59:00+02:00",
      submitted: false,
      renewal: null,
      "renewal-date": "1970-01-01T01:00:00+01:00",
      visible: true,
      ...attrs,
    },
    relationships: {
      "task-group": one("courseware-task-groups", group),
      "structural-element": one("courseware-structural-elements", elementId),
      solver: { data: null },
    },
  };
}

export function wikiPage(id: string, name: string, content: string, parent: string | null = null): JsonApiResource {
  return {
    type: "wiki-pages",
    id,
    attributes: { name, content, chdate: "2026-10-05T12:00:00+02:00", version: 2 },
    relationships: {
      parent: parent ? one("wiki-pages", parent) : { data: null },
      author: one("users", hid("someauthor")),
    },
  };
}

export function folder(id: string, name: string, parent: string | null, type = "StandardFolder"): JsonApiResource {
  return {
    type: "folders",
    id,
    attributes: { name, "folder-type": type, chdate: "2026-10-01T09:00:00+02:00" },
    relationships: { parent: parent ? one("folders", parent) : { data: null } },
  };
}

/** Minimal JSON:API fetch mock: exact path → document; records every request. */
export function routeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const path = url.pathname.replace(/^.*\/jsonapi\.php\/v1/, "");
    calls.push(`${path}${url.search}`);
    const body = routes[path];
    if (body === undefined) {
      return new Response(JSON.stringify({ errors: [{ status: "404", title: "Not found", detail: path }] }), {
        status: 404,
        headers: { "content-type": "application/vnd.api+json" },
      });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/vnd.api+json" } });
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}
