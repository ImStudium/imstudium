/**
 * Tolerant attribute readers shared by the planning/people/catalog
 * normalisers. Internal — not exported from the package index.
 */
import { ImstudiumError } from "../errors.js";
import type { JsonApiDocument, JsonApiResource } from "../types.js";

export function str(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t ? t : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function num(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** First non-empty attribute among several spellings (Stud.IP renamed some in 6.0). */
export function first(resource: JsonApiResource | undefined, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = resource?.attributes?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export function listOf<T extends JsonApiResource>(doc: JsonApiDocument<T>): T[] {
  return Array.isArray(doc.data) ? doc.data : doc.data ? [doc.data] : [];
}

/** PHP arrays with gaps arrive as objects; comma lists as strings. */
export function arrayish(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>);
  if (typeof value === "string" && value.trim()) return value.split(",");
  return [];
}

/** True for errors that mean "not logged in / session gone" rather than "doesn't exist". */
export function isAuthError(err: unknown): boolean {
  if (!(err instanceof ImstudiumError)) return false;
  return err.status === 401 || err.code === "AUTH_REQUIRED" || err.code === "SESSION_ORIGIN_MISMATCH";
}

/** True for errors where an offline fallback (ICS, workspace) makes sense. */
export function isOfflineError(err: unknown): boolean {
  return isAuthError(err) || (err instanceof ImstudiumError && err.code === "NETWORK");
}

/** https://host from a client base like https://host/jsonapi.php/v1 */
export function originOf(apiBase: string): string {
  return apiBase.replace(/\/jsonapi\.php\/v1\/?$/, "");
}
