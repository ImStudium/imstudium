import { z } from "zod";

/**
 * imstudium/source/v1 — the feed contract (design 45 §10). Layer B pages are
 * what AUVY Vault's `imstudium` connector reads; the ingest shapes are what a
 * device sends up. None of these has a credential-shaped field (F3a; tested).
 */

export const SOURCE_CONTRACT = "imstudium/source/v1" as const;

// ── 10.1 Discovery and schema ────────────────────────────────────────────────

export const CollectionId = z.enum([
  "courses",
  "schedule",
  "deadlines",
  "exams",
  "materials",
  "news",
  "wiki",
  "courseware",
  "forum",
  "changes",
]);
export type CollectionId = z.infer<typeof CollectionId>;

export const ScopeKey = z
  .string()
  .regex(
    /^(current|archive\/(WS|SS)\d{4})\/(courses|schedule|deadlines|exams|materials|news|wiki|courseware|forum|changes)$/,
  );
export type ScopeKey = z.infer<typeof ScopeKey>;

export const Discovery = z.object({
  contract: z.literal(SOURCE_CONTRACT),
  provider: z.literal("imstudium"),
  /** id "<host>:<studip_user_id>", label "Digicampus (Uni Augsburg)" (no person name) */
  account: z.object({ id: z.string(), label: z.string() }),
  instance: z.object({
    origin: z.string(),
    slug: z.string(),
    version: z.string(),
    family: z.string(),
    forum_api: z.enum(["entries", "topics"]),
    courseware: z.boolean(),
  }),
  current_semester: z.object({ id: z.string(), name: z.string(), starts: z.string(), ends: z.string() }),
  scopes: z.array(
    z.object({
      scope_key: ScopeKey,
      collection: CollectionId,
      label: z.string(),
      kind: z.literal("studies_collection"),
      semester: z.string(),
      sheet: z.string().nullable(),
    }),
  ),
  deletions: z.literal("full_sync_plus_tombstones"),
});
export type Discovery = z.infer<typeof Discovery>;

export const CollectionSchema = z.object({
  collection: CollectionId,
  title: z.string(),
  about: z.string(),
  columns: z.array(z.object({ id: z.string(), type: z.enum(["text", "number", "date", "datetime", "boolean"]) })),
});
export type CollectionSchema = z.infer<typeof CollectionSchema>;

// ── 10.2 Item and page ───────────────────────────────────────────────────────

export const FeedFile = z.object({
  name: z.string(),
  mime: z.string(),
  bytes: z.number().int().nullable(),
  pages: z.number().int().nullable(),
  sha256: z.string().nullable(),
  studip_etag: z.string().nullable(),
  link_only: z.boolean(),
  terms_of_use: z.enum(["own", "cc", "licence_held", "par60a", "unclear", "unknown"]),
  /** v1: always null (K6); becomes a URL with ASK-14b. */
  url: z.null(),
  /** v1: always null; {workspace, brain, path, version} with ASK-14b. */
  brain: z.null(),
});
export type FeedFile = z.infer<typeof FeedFile>;

export const FeedItem = z.object({
  /** "<host>:<kind>:<studip_id>" */
  id: z.string(),
  /** ImStudium mirror write time (ISO, µs), NOT Stud.IP chdate. */
  updated_at: z.string(),
  title: z.string(),
  /** Relative, ~/Studium layout; ≤ 12 segments, ≤ 200 chars each. */
  path: z.string(),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  body_md: z.string().max(65536).optional(),
  file: FeedFile.optional(),
  /** Stud.IP deep link. */
  web_url: z.string().url(),
  /** ImStudium deep link. */
  app_url: z.string().url(),
  /** Tombstone (student action or disconnect of a scope), kept 30 days. */
  deleted_at: z.string().optional(),
});
export type FeedItem = z.infer<typeof FeedItem>;

export const SourcePage = z.object({
  contract: z.literal(SOURCE_CONTRACT),
  scope: ScopeKey,
  items: z.array(FeedItem).max(500),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});
export type SourcePage = z.infer<typeof SourcePage>;

// ── 10.4 Ingest (device → cloud) ─────────────────────────────────────────────

export const IngestRecords = z.object({
  connection: z.string(),
  walk_id: z.string(),
  items: z.array(FeedItem.omit({ updated_at: true })).max(200),
});
export type IngestRecords = z.infer<typeof IngestRecords>;

export const LeaseRequest = z.object({
  connection: z.string(),
  items: z
    .array(
      z.object({
        studip_file_ref_id: z.string(),
        chdate: z.string(),
        size: z.number().int(),
        studip_etag: z.string().nullable(),
      }),
    )
    .max(200),
});
export type LeaseRequest = z.infer<typeof LeaseRequest>;

export const LeaseGrant = z.object({
  studip_file_ref_id: z.string(),
  action: z.enum(["download", "skip_have", "skip_leased"]),
  lease_id: z.string().optional(),
  expires_at: z.string().optional(),
});
export type LeaseGrant = z.infer<typeof LeaseGrant>;

export const FileCommit = z.object({
  sha256: z.string(),
  bytes: z.number().int(),
  pages: z.number().int().nullable(),
  studip_etag: z.string().nullable(),
  text_sha256: z.string().nullable(),
});
export type FileCommit = z.infer<typeof FileCommit>;

export const WalkComplete = z.object({
  connection: z.string(),
  collection: CollectionId,
  walk_id: z.string(),
  complete: z.boolean(),
  seen_count: z.number().int(),
  seen_digest: z.string(),
});
export type WalkComplete = z.infer<typeof WalkComplete>;

/** Every feed schema by name — for `imstudium schema feed.<Name>` and the credential scan. */
export const FEED_SCHEMAS = {
  Discovery,
  CollectionSchema,
  FeedFile,
  FeedItem,
  SourcePage,
  IngestRecords,
  LeaseRequest,
  LeaseGrant,
  FileCommit,
  WalkComplete,
} as const;
