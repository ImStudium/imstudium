import type { JsonApiDocument } from "./types.js";

export class DigicampusError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "DigicampusError";
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        hint: this.hint,
        status: this.status,
      },
    };
  }
}

export function parseApiErrors(doc: JsonApiDocument): DigicampusError {
  const err = doc.errors?.[0];
  const status = err?.status ? parseInt(err.status, 10) : undefined;
  return new DigicampusError(
    err?.detail || err?.title || "Unknown API error",
    err?.code || "API_ERROR",
    status,
    status === 401 ? "Run digicampus login first" : undefined,
  );
}

export async function readResponseError(res: Response): Promise<DigicampusError> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("json")) {
    try {
      const doc = (await res.json()) as JsonApiDocument;
      if (doc.errors?.length) return parseApiErrors(doc);
    } catch {
      // fall through
    }
  }
  return new DigicampusError(
    `HTTP ${res.status}: ${res.statusText}`,
    "HTTP_ERROR",
    res.status,
    res.status === 401 ? "Run digicampus login first" : undefined,
  );
}
