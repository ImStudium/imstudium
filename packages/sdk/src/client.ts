import type { JsonApiDocument, JsonApiResource } from "./types.js";
import { DigicampusError, readResponseError } from "./errors.js";

export interface StudIpClientOptions {
  baseUrl: string;
  getAuthHeaders?: () => Record<string, string>;
  getCookies?: () => Record<string, string>;
  fetchImpl?: typeof fetch;
}

export class StudIpClient {
  private readonly baseUrl: string;
  private readonly getAuthHeaders?: () => Record<string, string>;
  private readonly getCookies?: () => Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: StudIpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getAuthHeaders = options.getAuthHeaders;
    this.getCookies = options.getCookies;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.api+json",
      ...this.getAuthHeaders?.(),
      ...extra,
    };
    const cookies = this.getCookies?.();
    if (cookies && Object.keys(cookies).length > 0) {
      headers.Cookie = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }
    return headers;
  }

  private resolveUrl(path: string): string {
    if (path.startsWith("http")) return path;
    const normalized = path.startsWith("/") ? path : `/${path}`;
    if (normalized.startsWith("/v1/")) {
      return `${this.baseUrl}${normalized.replace(/^\/v1/, "")}`;
    }
    return `${this.baseUrl}${normalized}`;
  }

  async request<T extends JsonApiResource = JsonApiResource>(
    method: string,
    path: string,
    options?: { body?: unknown; headers?: Record<string, string>; raw?: boolean },
  ): Promise<JsonApiDocument<T>> {
    const url = this.resolveUrl(path);
    const headers = this.buildHeaders(options?.headers);
    if (options?.body) {
      headers["Content-Type"] = "application/vnd.api+json";
    }

    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      throw await readResponseError(res);
    }

    if (options?.raw) {
      return res as unknown as JsonApiDocument<T>;
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      throw new DigicampusError("Expected JSON response", "INVALID_RESPONSE");
    }

    return (await res.json()) as JsonApiDocument<T>;
  }

  async get<T extends JsonApiResource = JsonApiResource>(
    path: string,
    params?: Record<string, string>,
  ): Promise<JsonApiDocument<T>> {
    let url = path;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url = `${path}${path.includes("?") ? "&" : "?"}${qs}`;
    }
    return this.request<T>("GET", url);
  }

  async head(path: string): Promise<Response> {
    const url = this.resolveUrl(path);
    const res = await this.fetchImpl(url, {
      method: "HEAD",
      headers: this.buildHeaders(),
    });
    if (!res.ok) throw await readResponseError(res);
    return res;
  }

  async download(path: string): Promise<Response> {
    const url = this.resolveUrl(path);
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: this.buildHeaders(),
    });
    if (!res.ok) throw await readResponseError(res);
    return res;
  }

  async paginateAll<T extends JsonApiResource = JsonApiResource>(
    initialPath: string,
    params?: Record<string, string>,
  ): Promise<T[]> {
    const items: T[] = [];
    const query = new URLSearchParams(params);
    if (!query.has("page[limit]")) query.set("page[limit]", "100");

    let nextPath: string | null = initialPath;
    let nextQuery: URLSearchParams = query;

    while (nextPath) {
      const qs = nextQuery.toString();
      const fullPath: string = qs ? `${nextPath}?${qs}` : nextPath;
      const doc: JsonApiDocument<T> = await this.get<T>(fullPath);
      const data = doc.data;
      if (Array.isArray(data)) items.push(...data);
      else if (data) items.push(data);

      const nextLink: string | null | undefined = doc.links?.next;
      if (!nextLink || typeof nextLink !== "string") break;

      try {
        const base = this.baseUrl.replace(/\/jsonapi\.php\/v1$/, "");
        const nextUrl = new URL(nextLink, `${base}/jsonapi.php/v1/`);
        nextPath = nextUrl.pathname.replace(/^.*\/jsonapi\.php\/v1/, "") || "/";
        nextQuery = nextUrl.searchParams;
      } catch {
        break;
      }
    }

    return items;
  }
}
