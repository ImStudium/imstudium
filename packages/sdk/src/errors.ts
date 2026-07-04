import type { JsonApiDocument } from "./types.js";

export class ImstudiumError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "ImstudiumError";
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

export function parseApiErrors(doc: JsonApiDocument): ImstudiumError {
  const err = doc.errors?.[0];
  const status = err?.status ? parseInt(err.status, 10) : undefined;
  return new ImstudiumError(
    err?.detail || err?.title || "Unknown API error",
    err?.code || "API_ERROR",
    status,
    status === 401 ? "Run imstudium login first" : undefined,
  );
}

export async function readResponseError(res: Response): Promise<ImstudiumError> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("json")) {
    try {
      const doc = (await res.json()) as JsonApiDocument;
      if (doc.errors?.length) return parseApiErrors(doc);
    } catch {
      // fall through
    }
  }
  return new ImstudiumError(
    `HTTP ${res.status}: ${res.statusText}`,
    "HTTP_ERROR",
    res.status,
    res.status === 401 ? "Run imstudium login first" : undefined,
  );
}
