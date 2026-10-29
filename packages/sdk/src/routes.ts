import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { paths } from "./config.js";

export interface ApiRoute {
  methods: string[];
  /** Pattern without the /v1 prefix, e.g. /courses/{id}/news */
  pattern: string;
}

export interface RouteCatalog {
  schemaVersion: 1;
  origin: string;
  studipVersion?: string;
  fetchedAt: string;
  routes: ApiRoute[];
}

const MAX_AGE_MS = 7 * 24 * 3600_000;

/** /discovery is public on Stud.IP — no session needed. */
export async function fetchRouteCatalog(origin: string): Promise<RouteCatalog> {
  const base = `${origin.replace(/\/$/, "")}/jsonapi.php/v1`;
  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`, {
      headers: { Accept: "application/vnd.api+json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return (await res.json()) as { data?: Array<{ id: string; attributes?: Record<string, unknown> }> };
  };
  const doc = await get("/discovery");
  const routes = (doc.data ?? []).map((r) => ({
    methods: (r.attributes?.methods as string[]) ?? [],
    pattern: String(r.attributes?.pattern ?? "").replace(/^\/v1/, ""),
  }));
  let studipVersion: string | undefined;
  try {
    const props = await get("/studip/properties");
    studipVersion = String(props.data?.find((p) => p.id === "studip-version")?.attributes?.value ?? "");
  } catch {
    // optional
  }
  return {
    schemaVersion: 1,
    origin,
    studipVersion: studipVersion || undefined,
    fetchedAt: new Date().toISOString(),
    routes: routes.sort((a, b) => a.pattern.localeCompare(b.pattern)),
  };
}

export async function readRouteCatalog(file = paths.routesFile): Promise<RouteCatalog | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as RouteCatalog;
  } catch {
    return null;
  }
}

/** Cached catalog for this origin; refreshed weekly or on demand, stale copy when offline. */
export async function loadRouteCatalog(
  origin: string,
  options: { refresh?: boolean; file?: string } = {},
): Promise<RouteCatalog | null> {
  const file = options.file ?? paths.routesFile;
  const cached = await readRouteCatalog(file);
  const fresh =
    cached &&
    cached.origin === origin &&
    Date.now() - Date.parse(cached.fetchedAt) < MAX_AGE_MS;
  if (fresh && !options.refresh) return cached;
  try {
    const catalog = await fetchRouteCatalog(origin);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(catalog, null, 2) + "\n");
    return catalog;
  } catch {
    return cached && cached.origin === origin ? cached : null;
  }
}

/** Compile a Slim route pattern ({id}, {id:.+}, {type:a|b}) into a RegExp. */
export function routeRegex(pattern: string): RegExp {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < pattern.length && depth > 0) {
        if (pattern[j] === "{") depth++;
        else if (pattern[j] === "}") depth--;
        j++;
      }
      const inner = pattern.slice(i + 1, j - 1);
      const colon = inner.indexOf(":");
      const rx = colon >= 0 ? inner.slice(colon + 1) : "[^/]+";
      out += `(${rx})`;
      i = j;
    } else {
      out += ch.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(`^${out}$`);
}

/** The route a concrete path hits, e.g. /courses/abc/news → /courses/{id}/news */
export function matchRoute(catalog: RouteCatalog, path: string, method = "GET"): ApiRoute | null {
  const clean = path.split("?")[0]!.replace(/^\/v1/, "").replace(/\/$/, "") || "/";
  let best: ApiRoute | null = null;
  for (const route of catalog.routes) {
    if (!route.methods.includes(method.toUpperCase())) continue;
    if (!routeRegex(route.pattern).test(clean)) continue;
    // Prefer the most literal pattern (fewest placeholders)
    const score = (route.pattern.match(/\{/g) || []).length;
    const bestScore = best ? (best.pattern.match(/\{/g) || []).length : Infinity;
    if (score < bestScore) best = route;
  }
  return best;
}

/** Filter by substring or method; groups by top-level resource for printing. */
export function searchRoutes(
  catalog: RouteCatalog,
  query?: string,
  method?: string,
): ApiRoute[] {
  const q = query?.toLowerCase();
  return catalog.routes.filter(
    (r) =>
      (!method || r.methods.includes(method.toUpperCase())) &&
      (!q || r.pattern.toLowerCase().includes(q)),
  );
}

export function groupRoutes(routes: ApiRoute[]): Record<string, ApiRoute[]> {
  const out: Record<string, ApiRoute[]> = {};
  for (const r of routes) {
    const key = r.pattern.split("/").filter(Boolean)[0] ?? "/";
    (out[key] ??= []).push(r);
  }
  return out;
}
