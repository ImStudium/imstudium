/**
 * Consultation hours (Sprechstunden) — READ-ONLY. ImStudium shows blocks and
 * free slots; booking stays in Stud.IP (`consultationBookingUrl`).
 */
import type { StudIpClient } from "../client.js";
import { Included, relIds } from "../jsonapi.js";
import type { JsonApiResource } from "../types.js";
import { berlinIso } from "../berlin.js";
import { first, num, originOf, str } from "./attrs.js";

export interface ConsultationSlotInfo {
  id: string;
  start: string;
  end: string;
  bookable: boolean;
  locked: boolean;
  bookings: number;
  capacity: number;
  free: number;
  note: string | null;
}

export interface ConsultationBlockInfo {
  id: string;
  rangeType: string | null;
  rangeId: string | null;
  /** Filled by callers that know whose block this is (lecturer name, course title). */
  owner?: string;
  start: string;
  end: string;
  room: string | null;
  note: string | null;
  /** Bookings allowed per slot. */
  size: number;
  requireReason: string | null;
  slots: ConsultationSlotInfo[];
  freeSlots: number;
}

export function normalizeConsultationSlot(resource: JsonApiResource, blockSize: number): ConsultationSlotInfo | null {
  // Stud.IP 6.1 quirk: slots use snake_case start_time/end_time, blocks use start/end.
  const start = berlinIso(first(resource, "start_time", "start-time", "start"));
  if (!start) return null;
  const bookings = relIds(resource, "bookings").length;
  const locked = Boolean(first(resource, "is-locked"));
  const bookableAttr = first(resource, "is-bookable");
  const capacity = Math.max(1, blockSize || 1);
  const bookable = bookableAttr === undefined ? !locked && bookings < capacity : Boolean(bookableAttr);
  return {
    id: resource.id,
    start,
    end: berlinIso(first(resource, "end_time", "end-time", "end")) ?? start,
    bookable,
    locked,
    bookings,
    capacity,
    free: bookable ? Math.max(1, capacity - bookings) : 0,
    note: str(first(resource, "note")),
  };
}

export function normalizeConsultationBlock(resource: JsonApiResource, included: Included): ConsultationBlockInfo {
  const size = num(first(resource, "size")) ?? 1;
  const range = resource.relationships?.range?.data;
  const rangeRef = range && !Array.isArray(range) ? range : null;
  const slots = relIds(resource, "slots")
    .map((id) => included.get("consultation-slots", id))
    .filter((r): r is JsonApiResource => !!r)
    .map((r) => normalizeConsultationSlot(r, size))
    .filter((s): s is ConsultationSlotInfo => !!s)
    .sort((a, b) => a.start.localeCompare(b.start));
  return {
    id: resource.id,
    rangeType: rangeRef?.type ?? null,
    rangeId: rangeRef?.id ?? null,
    start: berlinIso(first(resource, "start")) ?? "",
    end: berlinIso(first(resource, "end")) ?? "",
    room: str(first(resource, "room")),
    note: str(first(resource, "note")),
    size,
    requireReason: str(first(resource, "require-reason")),
    slots,
    freeSlots: slots.filter((s) => s.bookable).length,
  };
}

/** Stud.IP page where the student books a slot (ImStudium never books). */
export function consultationBookingUrl(instanceOrigin: string, range: { username?: string | null; courseId?: string | null }): string | null {
  const base = `${instanceOrigin.replace(/\/$/, "")}/dispatch.php/consultation/overview`;
  if (range.username) return `${base}?username=${encodeURIComponent(range.username)}`;
  if (range.courseId) return `${base}?cid=${range.courseId}`;
  return null;
}

export class ConsultationsResource {
  constructor(private client: StudIpClient) {}

  get instanceOrigin(): string {
    return originOf(this.client.apiBase);
  }

  /** Consultation blocks with their slots for a user (lecturer), course or institute. */
  async list(
    range: { type: "users" | "courses" | "institutes"; id: string },
    options: { includeExpired?: boolean } = {},
  ): Promise<ConsultationBlockInfo[]> {
    const page = await this.client.paginate(`/${range.type}/${range.id}/consultations`, {
      filter: options.includeExpired ? undefined : { current: 1 },
      include: "slots",
      page: { limit: 100 },
    });
    const included = new Included(page.included);
    return page.data.map((b) => normalizeConsultationBlock(b, included)).sort((a, b) => a.start.localeCompare(b.start));
  }
}
