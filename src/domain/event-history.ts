import { createHash } from "node:crypto";
import { z } from "zod";

export const eventHistoryStatuses = [
  "captured",
  "classified",
  "semantically_resolved",
  "review",
  "retryable",
  "discarded",
] as const;

export const EVENT_HISTORY_DEFAULT_LIMIT = 25;
export const EVENT_HISTORY_MAX_LIMIT = 100;
const MAX_LIST_VALUES = 20;
const MAX_CURSOR_LENGTH = 512;

// `occurredAt` is the event's own timestamp (raw_events.timestamp), falling back to
// the ingestion time when the producer sent none so every row has a sortable key.
// `ingestedAt` is when BrainIA stored the event (raw_events.created_at).
export const eventHistoryDateFields = ["occurredAt", "ingestedAt"] as const;
export type EventHistoryDateField = (typeof eventHistoryDateFields)[number];

const csvList = <T extends z.ZodTypeAny>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((value) =>
      (Array.isArray(value) ? value : [value])
        .flatMap((part) => part.split(","))
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).min(1).max(MAX_LIST_VALUES))
    .transform((values) => [...new Set(values)].sort());

const isoInstant = z
  .string()
  .datetime({ offset: true, message: "Expected an ISO-8601 date-time with timezone" })
  .transform((value) => new Date(value).toISOString());

export const eventHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(EVENT_HISTORY_MAX_LIMIT).default(EVENT_HISTORY_DEFAULT_LIMIT),
    cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
    order: z.enum(["asc", "desc"]).default("desc"),
    dateField: z.enum(eventHistoryDateFields).default("occurredAt"),
    from: isoInstant.optional(),
    to: isoInstant.optional(),
    source: csvList(z.string().min(1).max(200)).optional(),
    category: csvList(z.string().min(1).max(200)).optional(),
    status: csvList(z.enum(eventHistoryStatuses)).optional(),
  })
  .strict()
  .refine((query) => !query.from || !query.to || query.from < query.to, {
    message: "`from` must be earlier than `to`",
    path: ["from"],
  });

export type EventHistoryQuery = z.infer<typeof eventHistoryQuerySchema>;

export type EventHistoryFilters = {
  order: "asc" | "desc";
  dateField: EventHistoryDateField;
  from?: string;
  to?: string;
  source?: string[];
  category?: string[];
  status?: (typeof eventHistoryStatuses)[number][];
};

export const eventHistoryFilters = (query: EventHistoryQuery): EventHistoryFilters => ({
  order: query.order,
  dateField: query.dateField,
  ...(query.from ? { from: query.from } : {}),
  ...(query.to ? { to: query.to } : {}),
  ...(query.source ? { source: query.source } : {}),
  ...(query.category ? { category: query.category } : {}),
  ...(query.status ? { status: query.status } : {}),
});

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

// Binds a cursor to one owner and one filter/order combination. The binding is
// defense in depth: queries are always owner-scoped, but a cursor replayed
// across owners or across a changed filter set is rejected instead of silently
// producing skipped or duplicated rows.
export const eventHistoryOwnerDigest = (ownerId: string | undefined) => digest(["owner", ownerId ?? null]);
export const eventHistoryFilterDigest = (filters: EventHistoryFilters) =>
  digest([
    filters.order,
    filters.dateField,
    filters.from ?? null,
    filters.to ?? null,
    filters.source ?? null,
    filters.category ?? null,
    filters.status ?? null,
  ]);

export type EventHistoryCursorPosition = {
  /** Full-precision sort key as emitted by Postgres (timestamptz::text). */
  key: string;
  id: string;
};

const cursorSchema = z
  .object({
    v: z.literal(1),
    o: z.string().length(16),
    f: z.string().length(16),
    k: z.string().min(1).max(64),
    i: z.string().min(1).max(200),
  })
  .strict();

export class InvalidEventCursorError extends Error {
  constructor(message = "The cursor is malformed, expired, or does not match this request") {
    super(message);
    this.name = "InvalidEventCursorError";
  }
}

export function encodeEventHistoryCursor(
  position: EventHistoryCursorPosition,
  ownerId: string | undefined,
  filters: EventHistoryFilters,
): string {
  const payload = {
    v: 1 as const,
    o: eventHistoryOwnerDigest(ownerId),
    f: eventHistoryFilterDigest(filters),
    k: position.key,
    i: position.id,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeEventHistoryCursor(
  cursor: string,
  ownerId: string | undefined,
  filters: EventHistoryFilters,
): EventHistoryCursorPosition {
  if (cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new InvalidEventCursorError();

  let parsed: z.infer<typeof cursorSchema>;
  try {
    parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new InvalidEventCursorError();
  }

  if (parsed.o !== eventHistoryOwnerDigest(ownerId)) throw new InvalidEventCursorError();
  if (parsed.f !== eventHistoryFilterDigest(filters)) throw new InvalidEventCursorError();
  // The key is passed back to Postgres as `::timestamptz`; reject anything that
  // is not a plain timestamp literal before it reaches the query.
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/.test(parsed.k)) {
    throw new InvalidEventCursorError();
  }
  return { key: parsed.k, id: parsed.i };
}
