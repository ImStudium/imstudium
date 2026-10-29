/**
 * The one error-code table. The CLI's exit codes, the MCP `isError` bodies
 * and the SDK's `ImstudiumError` all read it; docs/ERRORS.md is generated
 * from it. Zod-free on purpose: the SDK imports it on every start
 * (`@imstudium/contract/errors`).
 *
 * Rules: codes are SCREAMING_SNAKE and never reused. Merged codes stay as
 * `aliases`, so `canonicalCode("NO_SESSION")` → `AUTH_REQUIRED` and old
 * throw sites keep working.
 */

export const EXIT_CODES = {
  ok: 0,
  internal: 1,
  usage: 2,
  gated: 3,
  auth: 4,
  not_found: 5,
  offline: 6,
  upstream: 7,
  workspace: 8,
} as const;

export type ErrorCategory = Exclude<keyof typeof EXIT_CODES, "ok">;

export interface ErrorSpec {
  category: ErrorCategory;
  /** Safe to retry the same call unchanged (later, or after a backoff). */
  retryable: boolean;
  /** One line: when this happens. */
  summary: string;
  /** Default fix, used when the throw site gives none. */
  hint: string;
  /** Older codes that now mean this one. */
  aliases?: readonly string[];
}

const spec = (category: ErrorCategory, summary: string, hint: string, extra: Partial<ErrorSpec> = {}): ErrorSpec => ({
  category,
  retryable: false,
  summary,
  hint,
  ...extra,
});

export const ERROR_CODES = {
  // ── 1 internal ─────────────────────────────────────────────────────────────
  UNKNOWN: spec("internal", "Unexpected failure (a bug, or something the CLI did not anticipate)", "Run again with the same arguments; if it persists, open an issue with the command and the message"),
  UPDATE_FAILED: spec("internal", "`imstudium update` could not upgrade the global npm install", "Run: npm i -g @imstudium/cli@latest"),
  BROWSER_LAUNCH_FAILED: spec("internal", "The sign-in browser (Playwright) could not start", "Run: npx playwright install chromium"),
  CLI_NOT_FOUND: spec("internal", "The MCP server could not find the imstudium CLI to run", "npm i -g @imstudium/cli, or set IMSTUDIUM_CLI to its path"),
  // ── 2 usage ────────────────────────────────────────────────────────────────
  BAD_ARGS: spec("usage", "An argument or flag is missing, unknown or malformed", "See: imstudium <command> --help", {
    aliases: ["MISSING_ARG", "INVALID_KEY"],
  }),
  NO_CLIENT_ID: spec("usage", "OAuth sign-in was requested without a client id", "Set IMSTUDIUM_OAUTH_CLIENT_ID or oauth.clientId (docs/OAUTH.md), or run imstudium login without --oauth"),
  // ── 3 gated ────────────────────────────────────────────────────────────────
  WRITE_NOT_ALLOWED: spec("gated", "The call would change something in Stud.IP and was not explicitly allowed", "Read-only by default: add --write in a terminal if you really mean it (never over MCP)"),
  // ── 4 auth ─────────────────────────────────────────────────────────────────
  AUTH_REQUIRED: spec("auth", "No usable Stud.IP session (signed out, expired or rejected)", "Run: imstudium login", {
    aliases: ["NO_SESSION", "NOT_LOGGED_IN", "SESSION_EXPIRED"],
  }),
  SESSION_ORIGIN_MISMATCH: spec("auth", "The stored session belongs to another Stud.IP instance than the one requested", "Run: imstudium login --instance <url>"),
  LOGIN_FAILED: spec("auth", "Browser sign-in did not produce a session", "Run: imstudium login (or --manual)"),
  LOGIN_TIMEOUT: spec("auth", "Sign-in took too long", "Run: imstudium login and finish the sign-in within a few minutes"),
  LOGIN_CANCELLED: spec("auth", "The sign-in window was closed before the login finished", "Run: imstudium login"),
  LOGIN_INVALID_COOKIE: spec("auth", "The pasted or imported session cookie is not valid", "Copy Seminar_Session again, or run: imstudium login"),
  CHROME_PROFILE_LOCKED: spec("auth", "--chrome-profile needs Chrome closed", "Quit Chrome completely, then run: imstudium login --chrome-profile"),
  OAUTH_UNAVAILABLE: spec("auth", "OAuth is not available on this Stud.IP instance", "Run: imstudium login (browser sign-in)"),
  OAUTH_CLIENT_INVALID: spec("auth", "Stud.IP rejected the OAuth client id", "Check oauth.clientId in ~/.config/imstudium/config.json (docs/OAUTH.md)"),
  OAUTH_DENIED: spec("auth", "Access was denied on the Stud.IP consent page", "Run: imstudium login --oauth and allow access"),
  OAUTH_TOKEN_FAILED: spec("auth", "Exchanging the OAuth code for a token failed", "Run: imstudium login --oauth", { retryable: true }),
  OAUTH_REFRESH_FAILED: spec("auth", "Renewing the OAuth token failed", "Run: imstudium login"),
  // ── 5 not found ────────────────────────────────────────────────────────────
  NOT_FOUND: spec("not_found", "The thing you asked for does not exist (or you cannot see it)", "Check the id or name; list commands show what exists"),
  COURSE_NOT_FOUND: spec("not_found", "No course matches the name, shortcut or id", "imstudium courses list shows your courses; pass a title fragment, slug or id"),
  COURSE_AMBIGUOUS: spec("not_found", "Several courses match; the CLI will not guess", "Pass a longer title fragment or the course id (see details.candidates)"),
  SEMESTER_NOT_FOUND: spec("not_found", "No semester matches the label", "imstudium semesters lists them, e.g. --semester \"WS 2026/27\"", {
    aliases: ["NO_SEMESTER"],
  }),
  UNIT_NOT_FOUND: spec("not_found", "No Courseware unit matches", "imstudium courseware <course> lists the units"),
  PAGE_NOT_FOUND: spec("not_found", "No wiki page matches", "imstudium wiki <course> lists the pages"),
  ROUTE_NOT_FOUND: spec("not_found", "No JSON:API route matches the path", "imstudium routes lists the routes of your Stud.IP", {
    aliases: ["NO_ROUTE", "NO_ROUTES"],
  }),
  // ── 6 offline ──────────────────────────────────────────────────────────────
  NETWORK: spec("offline", "Stud.IP could not be reached (offline, DNS, timeout)", "Check the connection; local commands (context, search, changes, today --offline) still work", {
    retryable: true,
  }),
  // ── 7 upstream ─────────────────────────────────────────────────────────────
  UPSTREAM_ERROR: spec("upstream", "Stud.IP answered with an error (details.upstream holds its code)", "Retry later; if it persists the route may be disabled on your instance (imstudium routes)", {
    aliases: ["HTTP_ERROR", "API_ERROR"],
  }),
  // ── 8 workspace ────────────────────────────────────────────────────────────
  WORKSPACE_MISSING: spec("workspace", "No Studium workspace here, or the course is not in it yet", "Run: imstudium semester start (or imstudium sync)", {
    aliases: ["NO_WORKSPACE", "NO_COURSE_DIR", "NOT_IN_WORKSPACE"],
  }),
  NO_CORPUS: spec("workspace", "Nothing is extracted or indexed yet", "Run: imstudium sync --extract (or imstudium extract)"),
  NO_ICS: spec("workspace", "No calendar.ics in the workspace for --offline", "Run: imstudium sync (writes calendar.ics), or pass --ics <file>"),
} as const satisfies Record<string, ErrorSpec>;

export type ErrorCode = keyof typeof ERROR_CODES;

const ALIASES: Record<string, ErrorCode> = Object.fromEntries(
  (Object.entries(ERROR_CODES) as Array<[ErrorCode, ErrorSpec]>).flatMap(([code, s]) => (s.aliases ?? []).map((a) => [a, code])),
);

export function isErrorCode(code: string): code is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CODES, code);
}

/** Map a legacy alias to its current code; unknown codes pass through unchanged. */
export function canonicalCode(code: string): string {
  return ALIASES[code] ?? code;
}

/** The table entry for a code (aliases resolved); unknown codes count as UNKNOWN. */
export function errorSpec(code: string): ErrorSpec {
  const c = canonicalCode(code);
  return isErrorCode(c) ? ERROR_CODES[c] : ERROR_CODES.UNKNOWN;
}

/** Process exit code for an error code. */
export function exitCodeFor(code: string): number {
  return EXIT_CODES[errorSpec(code).category];
}

/** Whether a failure is worth retrying: the table says so, or the HTTP status does (429, 5xx). */
export function isRetryable(code: string, status?: number): boolean {
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  return errorSpec(code).retryable;
}

/** The JSON body every surface emits for an error (CLI stderr, MCP isError). */
export interface ErrorPayload {
  error: {
    code: string;
    message: string;
    status?: number;
    hint?: string;
    retryable: boolean;
    exitCode: number;
    /** The pre-0.3 code when an alias was thrown — kept for one minor so old agents can migrate. */
    legacyCode?: string;
    details?: Record<string, unknown>;
  };
}

/** Build the error body from loose parts (for code paths that do not hold an ImstudiumError). */
export function errorPayload(input: {
  code: string;
  message: string;
  status?: number;
  hint?: string;
  details?: Record<string, unknown>;
}): ErrorPayload {
  const code = canonicalCode(input.code);
  const known = isErrorCode(code);
  return {
    error: {
      code,
      message: input.message,
      ...(input.status !== undefined ? { status: input.status } : {}),
      hint: input.hint ?? (known ? ERROR_CODES[code].hint : undefined),
      retryable: isRetryable(code, input.status),
      exitCode: exitCodeFor(code),
      ...(code !== input.code ? { legacyCode: input.code } : {}),
      ...(input.details ? { details: input.details } : {}),
    },
  };
}
