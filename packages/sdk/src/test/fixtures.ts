import type { JsonApiDocument, JsonApiResource } from "../types.js";

export function courseResource(
  id: string,
  title: string,
  extra?: Record<string, unknown>,
): JsonApiResource<"courses"> {
  return {
    type: "courses",
    id,
    attributes: { title, ...extra },
  };
}

export function fileRefResource(
  id: string,
  name: string,
  chdate = "2026-07-01T10:00:00+02:00",
): JsonApiResource<"file-refs"> {
  return {
    type: "file-refs",
    id,
    attributes: { name, chdate, filesize: 1024 },
  };
}

export function userDoc(id = "user1", name = "Test Student"): JsonApiDocument {
  return {
    data: {
      type: "users",
      id,
      attributes: { "formatted-name": name, username: "test" },
    },
  };
}

export function paginatedDoc<T extends JsonApiResource>(
  items: T[],
  path = "/courses",
): JsonApiDocument<T> {
  return {
    data: items,
    meta: { page: { offset: 0, limit: 100, total: items.length } },
    links: { next: null },
  };
}

export function mockFetch(handlers: Record<string, () => Response | Promise<Response>>) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method || "GET").toUpperCase();

    for (const [pattern, handler] of Object.entries(handlers)) {
      const [pMethod, pPath] = pattern.split(" ");
      if (method === pMethod && url.includes(pPath)) {
        return handler();
      }
    }

    return new Response(
      JSON.stringify({ errors: [{ status: "404", title: "Not found", detail: url }] }),
      { status: 404, headers: { "content-type": "application/vnd.api+json" } },
    );
  };
}
