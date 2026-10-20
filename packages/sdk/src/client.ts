import type { JsonApiDocument, JsonApiResource } from "./types.js";
import { ImstudiumError, readResponseError } from "./errors.js";

/** JSON:API query: include, sparse fieldsets, filters, paging, sort, plus raw params. */
export interface JsonApiQuery {
  include?: string | string[];
  fields?: Record<string, string | string[]>;
  filter?: Record<string, string | number | boolean | undefined>;
  page?: { limit?: number; offset?: number };
  sort?: string;
  [param: string]: unknown;
}

export interface StudIpClientOptions {
  baseUrl: string;
  getAuthHeaders?: () => Record<string, string>;
  getCookies?: () => Record<string, string>;
  fetchImpl?: typeof fetch;
  /** Per-request timeout for JSON calls (default 30 s). Downloads get 10 min. */
  timeoutMs?: number;
  /** Retries on network errors, 429 and 5xx (default 3). */
  retries?: number;
  /** Parallel requests in flight against the instance (default 6). */
  concurrency?: number;
  /**
   * Called once on 401. Return true when the session was renewed
   * (e.g. silent browser refresh) and the request should be retried.
   */
  onUnauthorized?: () => Promise<boolean>;
  userAgent?: string;
}

export interface PageResult<T extends JsonApiResource> {
  data: T[];
  included: JsonApiResource[];
  total?: number;
}

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Small FIFO semaphore — keeps a sync of 30 courses polite to the instance. */
class Gate {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function retryDelay(attempt: number, res?: Response): number {
  const header = res?.headers.get("retry-after");
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, Math.min(at - Date.now(), 60_000));
  }
  const base = 400 * 2 ** attempt;
  return base + Math.floor(Math.random() * base * 0.25);
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "TimeoutError" ||
    err.name === "AbortError" ||
    err.name === "TypeError" ||
    /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket/i.test(err.message)
  );
}

/** Serialise a JsonApiQuery (or a flat record) into URLSearchParams. */
export function toSearchParams(query?: JsonApiQuery | Record<string, string>): URLSearchParams {
  const qs = new URLSearchParams();
  if (!query) return qs;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (key === "include") {
      qs.set("include", Array.isArray(value) ? value.join(",") : String(value));
    } else if (key === "fields" && typeof value === "object") {
      for (const [type, f] of Object.entries(value as Record<string, string | string[]>)) {
        qs.set(`fields[${type}]`, Array.isArray(f) ? f.join(",") : f);
      }
    } else if (key === "filter" && typeof value === "object") {
      for (const [name, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== undefined) qs.set(`filter[${name}]`, String(v));
      }
    } else if (key === "page" && typeof value === "object") {
      const page = value as { limit?: number; offset?: number };
      if (page.limit !== undefined) qs.set("page[limit]", String(page.limit));
      if (page.offset !== undefined) qs.set("page[offset]", String(page.offset));
    } else {
      qs.set(key, String(value));
    }
  }
  return qs;
}

export class StudIpClient {
  private readonly baseUrl: string;
  private readonly getAuthHeaders?: () => Record<string, string>;
  private readonly getCookies?: () => Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly gate: Gate;
  private readonly onUnauthorized?: () => Promise<boolean>;
  private readonly userAgent?: string;
  private renewing: Promise<boolean> | null = null;

  constructor(options: StudIpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getAuthHeaders = options.getAuthHeaders;
    this.getCookies = options.getCookies;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retries = options.retries ?? 3;
    this.gate = new Gate(options.concurrency ?? 6);
    this.onUnauthorized = options.onUnauthorized;
    this.userAgent = options.userAgent;
  }

  /** API base, e.g. https://digicampus.uni-augsburg.de/jsonapi.php/v1 */
  get apiBase(): string {
    return this.baseUrl;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.api+json",
      ...(this.userAgent ? { "User-Agent": this.userAgent } : {}),
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

  resolveUrl(path: string): string {
    if (path.startsWith("http")) return path;
    const normalized = path.startsWith("/") ? path : `/${path}`;
    if (normalized.startsWith("/v1/")) {
      return `${this.baseUrl}${normalized.replace(/^\/v1/, "")}`;
    }
    return `${this.baseUrl}${normalized}`;
  }

  /** Renew the session at most once at a time, however many requests hit 401 together. */
  private async renewOnce(): Promise<boolean> {
    if (!this.onUnauthorized) return false;
    if (!this.renewing) {
      this.renewing = this.onUnauthorized().finally(() => {
        setTimeout(() => (this.renewing = null), 0);
      });
    }
    return this.renewing;
  }

  /**
   * One HTTP exchange with timeout, retry/backoff (network, 429, 5xx) and a
   * single session renewal on 401. Returns the raw Response (ok only).
   */
  async fetchRaw(
    method: string,
    path: string,
    init?: { body?: string; headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<Response> {
    const url = this.resolveUrl(path);
    let renewed = false;

    return this.gate.run(async () => {
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await this.fetchImpl(url, {
            method,
            headers: this.buildHeaders(init?.headers),
            body: init?.body,
            signal: AbortSignal.timeout(init?.timeoutMs ?? this.timeoutMs),
          });
        } catch (err) {
          if (attempt < this.retries && isNetworkError(err)) {
            await sleep(retryDelay(attempt));
            continue;
          }
          throw new ImstudiumError(
            `Network error: ${err instanceof Error ? err.message : String(err)}`,
            "NETWORK",
            undefined,
            "Check your connection. Local commands (studium, klausuren, search, today) work offline.",
          );
        }

        if (res.status === 401 && !renewed && (await this.renewOnce())) {
          renewed = true;
          continue;
        }
        if (RETRY_STATUS.has(res.status) && attempt < this.retries) {
          await res.body?.cancel().catch(() => undefined);
          await sleep(retryDelay(attempt, res));
          continue;
        }
        if (!res.ok) throw await readResponseError(res);
        return res;
      }
    });
  }

  async request<T extends JsonApiResource = JsonApiResource>(
    method: string,
    path: string,
    options?: { body?: unknown; headers?: Record<string, string>; raw?: boolean },
  ): Promise<JsonApiDocument<T>> {
    const headers = { ...options?.headers };
    if (options?.body) headers["Content-Type"] = "application/vnd.api+json";
    const res = await this.fetchRaw(method, path, {
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (options?.raw) {
      return res as unknown as JsonApiDocument<T>;
    }
    if (res.status === 204) return {} as JsonApiDocument<T>;

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      await res.body?.cancel().catch(() => undefined);
      throw new ImstudiumError(
        "Expected JSON from Stud.IP but got a web page — the session has most likely expired.",
        "AUTH_REQUIRED",
        undefined,
        "Run imstudium login",
      );
    }
    return (await res.json()) as JsonApiDocument<T>;
  }

  async get<T extends JsonApiResource = JsonApiResource>(
    path: string,
    params?: JsonApiQuery | Record<string, string>,
  ): Promise<JsonApiDocument<T>> {
    const qs = toSearchParams(params).toString();
    const url = qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
    return this.request<T>("GET", url);
  }

  /** GET a single resource; throws NOT_FOUND when data is empty. */
  async getOne<T extends JsonApiResource = JsonApiResource>(
    path: string,
    params?: JsonApiQuery,
  ): Promise<{ data: T; included: JsonApiResource[] }> {
    const doc = await this.get<T>(path, params);
    if (!doc.data || Array.isArray(doc.data)) {
      throw new ImstudiumError(`No resource at ${path}`, "NOT_FOUND", 404);
    }
    return { data: doc.data, included: doc.included ?? [] };
  }

  async head(path: string): Promise<Response> {
    return this.fetchRaw("HEAD", path);
  }

  async download(path: string): Promise<Response> {
    return this.fetchRaw("GET", path, { timeoutMs: 10 * 60_000 });
  }

  /** Follow links.next until exhausted; keeps every `included` resource. */
  async paginate<T extends JsonApiResource = JsonApiResource>(
    initialPath: string,
    params?: JsonApiQuery | Record<string, string>,
    options?: { max?: number },
  ): Promise<PageResult<T>> {
    const data: T[] = [];
    const included: JsonApiResource[] = [];
    const seen = new Set<string>();
    let total: number | undefined;
    const query = toSearchParams(params);
    if (!query.has("page[limit]")) query.set("page[limit]", "100");

    let nextPath: string | null = initialPath;
    let nextQuery: URLSearchParams = query;

    while (nextPath) {
      const qs = nextQuery.toString();
      const fullPath: string = qs ? `${nextPath}?${qs}` : nextPath;
      const doc: JsonApiDocument<T> = await this.request<T>("GET", fullPath);
      if (Array.isArray(doc.data)) data.push(...doc.data);
      else if (doc.data) data.push(doc.data);
      for (const inc of doc.included ?? []) {
        const key = `${inc.type}:${inc.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          included.push(inc);
        }
      }
      total = doc.meta?.page?.total ?? total;
      if (options?.max && data.length >= options.max) break;

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

    return { data: options?.max ? data.slice(0, options.max) : data, included, total };
  }

  async paginateAll<T extends JsonApiResource = JsonApiResource>(
    initialPath: string,
    params?: JsonApiQuery | Record<string, string>,
  ): Promise<T[]> {
    return (await this.paginate<T>(initialPath, params)).data;
  }
}
