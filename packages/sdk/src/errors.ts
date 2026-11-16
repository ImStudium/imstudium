import {
  canonicalCode,
  errorPayload,
  errorSpec,
  exitCodeFor,
  isRetryable,
  type ErrorCategory,
  type ErrorPayload,
} from "@imstudium/contract/errors";
import type { JsonApiDocument } from "./types.js";

export { ERROR_CODES, EXIT_CODES, canonicalCode, type ErrorCode, type ErrorPayload } from "@imstudium/contract/errors";

/**
 * Every failure the SDK, CLI and MCP report. The code comes from the one
 * table in @imstudium/contract (docs/ERRORS.md): legacy aliases are mapped on
 * construction, and exit code, retryability and the default hint follow from
 * the code.
 */
export class ImstudiumError extends Error {
  public readonly code: string;
  public readonly hint?: string;
  /** The alias the throw site used, when it differs from `code`. */
  public readonly legacyCode?: string;

  constructor(
    message: string,
    code: string,
    public readonly status?: number,
    hint?: string,
    /** Machine-readable extras, e.g. `{ candidates }` or `{ upstream: { code } }`. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ImstudiumError";
    this.code = canonicalCode(code);
    if (this.code !== code) this.legacyCode = code;
    this.hint = hint ?? errorSpec(this.code).hint;
  }

  get category(): ErrorCategory {
    return errorSpec(this.code).category;
  }

  /** Process exit code (0 ok · 1 internal · 2 usage · 3 gated · 4 auth · 5 not found · 6 offline · 7 upstream · 8 workspace). */
  get exitCode(): number {
    return exitCodeFor(this.code);
  }

  get retryable(): boolean {
    return isRetryable(this.code, this.status);
  }

  toJSON(): ErrorPayload {
    const body = errorPayload({ code: this.code, message: this.message, status: this.status, hint: this.hint, details: this.details });
    if (this.legacyCode) body.error.legacyCode = this.legacyCode;
    return body;
  }
}

/** File system failures that mean "this path cannot be used here": a usage error, not a bug. */
const UNUSABLE_PATH: Record<string, string> = {
  ENOTDIR: "a part of the path is a file, not a folder",
  EEXIST: "something is already there",
  EISDIR: "it is a folder, not a file",
  EACCES: "no permission",
  EPERM: "no permission",
  EROFS: "the file system is read-only",
};

/** Any thrown value as an ImstudiumError (unknown errors become UNKNOWN, network failures NETWORK, a bad path NOT_FOUND or BAD_ARGS). */
export function toImstudiumError(err: unknown): ImstudiumError {
  if (err instanceof ImstudiumError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? (err.cause as { code?: string } | undefined) : undefined;
  if (err instanceof TypeError && /fetch failed|network/i.test(message)) {
    return new ImstudiumError(message, "NETWORK", undefined, undefined, cause?.code ? { cause: cause.code } : undefined);
  }
  const fs = err instanceof Error ? (err as Error & { code?: unknown; path?: unknown; syscall?: unknown }) : undefined;
  if (fs && typeof fs.code === "string" && typeof fs.path === "string" && !String(fs.syscall ?? "").startsWith("spawn")) {
    if (fs.code === "ENOENT") {
      return new ImstudiumError(`No such file or folder: ${fs.path}`, "NOT_FOUND", undefined, "Check the path; a relative path starts in the folder you are in", { path: fs.path, cause: fs.code });
    }
    const why = UNUSABLE_PATH[fs.code];
    if (why) {
      return new ImstudiumError(`Cannot use ${fs.path}: ${why}`, "BAD_ARGS", undefined, "Pass a file you can read, or a folder you can write to", { path: fs.path, cause: fs.code });
    }
  }
  return new ImstudiumError(message, "UNKNOWN");
}

/** HTTP status → code for answers without a usable JSON:API error. */
function codeForStatus(status: number | undefined): string {
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 404) return "NOT_FOUND";
  return "UPSTREAM_ERROR";
}

/**
 * A JSON:API error document as an ImstudiumError. Stud.IP's own code never
 * becomes ours: it travels in `details.upstream`.
 */
export function parseApiErrors(doc: JsonApiDocument, httpStatus?: number): ImstudiumError {
  const err = doc.errors?.[0];
  // Stud.IP 6 error objects often omit `status`; the HTTP status still tells 400 from 500.
  const status = err?.status ? parseInt(err.status, 10) : httpStatus;
  return new ImstudiumError(
    err?.detail || err?.title || "Unknown API error",
    codeForStatus(status),
    status,
    status === 401 ? "Run imstudium login first" : undefined,
    err?.code || err?.title ? { upstream: { code: err?.code ?? null, title: err?.title ?? null } } : undefined,
  );
}

export async function readResponseError(res: Response): Promise<ImstudiumError> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("json")) {
    try {
      const doc = (await res.json()) as JsonApiDocument;
      if (doc.errors?.length) return parseApiErrors(doc, res.status);
    } catch {
      // fall through
    }
  }
  return new ImstudiumError(
    `HTTP ${res.status}: ${res.statusText}`,
    codeForStatus(res.status),
    res.status,
    res.status === 401 ? "Run imstudium login first" : undefined,
  );
}
