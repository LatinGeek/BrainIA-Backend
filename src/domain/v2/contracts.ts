import { createHash } from "node:crypto";
import { z } from "zod";

/** Public v2 errors never carry submitted content or free-form details. */
export class ApiError extends Error {
  get status(): number { return this.statusCode; }
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function validUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

/** RFC 8785: UTF-16 key sorting, ECMAScript numbers, and no normalization. */
export function canonicalize(value: unknown): string {
  const ancestors = new Set<object>();
  function visit(input: unknown): string {
    if (input === null) return "null";
    if (typeof input === "string") {
      if (!validUnicode(input)) throw new ApiError(400, "invalid_request", "Invalid Unicode");
      return JSON.stringify(input);
    }
    if (typeof input === "boolean") return JSON.stringify(input);
    if (typeof input === "number" && Number.isFinite(input)) return JSON.stringify(input);
    if (typeof input !== "object" || input === null || ancestors.has(input)) {
      throw new ApiError(400, "invalid_request", "Expected a JSON value");
    }
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        return "[" + Array.from(input, item => visit(item)).join(",") + "]";
      }
      if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) {
        throw new ApiError(400, "invalid_request", "Expected a JSON object");
      }
      const record = input as Record<string, unknown>;
      return "{" + Object.keys(record).sort().map(key => visit(key) + ":" + visit(record[key])).join(",") + "}";
    } finally {
      ancestors.delete(input);
    }
  }
  return visit(value);
}

// JSON Schema lengths count Unicode code points, independently of UTF-8 limits.
const text = (min = 0, max = Infinity) => z.string().refine(validUnicode, "Invalid Unicode")
  .refine(value => { const n = [...value].length; return n >= min && n <= max; }, "Invalid string length");
const byteText = (max: number) => text().refine(value => Buffer.byteLength(value, "utf8") <= max,
  { message: "UTF-8 byte limit exceeded", params: { apiCode: "payload_too_large", statusCode: 413 } });
const unique = <T>(values: T[]) => new Set(values).size === values.length;
export const idSchema = text(1, 160);
export type Id = z.infer<typeof idSchema>;
export const timestampSchema = z.string().datetime({ offset: true }).regex(/(Z|[+-][0-9]{2}:[0-9]{2})$/)
  .refine(value => {
    const offset = /[+-]([0-9]{2}):([0-9]{2})$/.exec(value);
    return !offset || (Number(offset[1]) <= 23 && Number(offset[2]) <= 59);
  }, "Invalid timezone offset");
const uuidSchema = z.string().regex(/^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const decimalSchema = z.string().regex(/^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/);
const magnitudeSchema = z.string().regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const versionSchema = z.number().int().min(1).max(2147483647);
const cursorSchema = text(1, 512);
const eventTypeSchema = z.enum(["purchase", "payment", "income", "transfer", "refund", "adjustment", "delivery", "appointment", "communication", "other"]);
const eventLifecycleSchema = z.enum(["observed", "authorized", "pending", "declined", "posted", "review", "reversed", "expired", "cancelled"]);
const transactionKindSchema = z.enum(["expense", "income", "transfer"]);
const transactionLifecycleSchema = z.enum(["observed", "authorized", "pending", "declined", "posted", "review", "reversed", "expired", "cancelled"]);
const episodeTypeSchema = z.enum(["shopping", "work", "research", "travel", "purchase_delivery", "appointment"]);
const episodeStatusSchema = z.enum(["proposed", "active", "closed", "review", "retired"]);
const evidenceTypeSchema = z.enum(["observation", "event", "fact", "transaction", "episode"]);
const exportTypeSchema = z.enum(["observation", "revision", "fact", "correction", "event", "transaction", "episode", "artifact"]);

const commonContent = { title: byteText(1024).nullable(), body: byteText(49152).nullable() };
const emptyRaw = z.object({}).strict();
const attachmentSchema = z.object({
  refId: idSchema, provider: idSchema.optional(), mimeType: text().optional(),
  sizeBytes: z.number().int().min(0).max(1e12).optional(), sha256: hashSchema.optional(),
  expiresAt: timestampSchema.refine(value => value.endsWith("Z")).optional(),
}).strict();
const emailAddressSchema = z.object({
  address: z.string().email().refine(value => [...value].length <= 320), displayName: text(0, 256).optional(),
}).strict();
const notificationSchema = z.object({
  ...commonContent, type: z.literal("notification"), packageName: text(1),
  raw: z.object({ packageName: text().optional(), title: text().optional(), body: text().optional() }).strict(),
}).strict();
const noteSchema = z.object({ ...commonContent, type: z.literal("note"), raw: emptyRaw }).strict();
const receiptContentSchema = z.object({
  ...commonContent, type: z.literal("receipt"), merchantText: text().nullable(), reference: text().nullable(),
  attachmentRefs: z.array(attachmentSchema).max(0),
  raw: z.object({ amount: text().optional(), currency: text().optional(), merchant: text().optional(), transactionType: text().optional() }).strict(),
}).strict();
const emailSchema = z.object({
  ...commonContent, type: z.literal("email"), raw: emptyRaw, providerMessageId: idSchema,
  providerThreadId: idSchema.nullable(), sender: emailAddressSchema, recipients: z.array(emailAddressSchema).max(100),
  attachmentRefs: z.array(attachmentSchema).max(0),
}).strict();
const activitySchema = z.object({
  ...commonContent, type: z.literal("activity"), raw: emptyRaw, activityMarker: z.enum(["observed", "inferred"]),
  signalTypes: z.array(z.enum(["still", "walking", "running", "cycling", "driving", "transit", "unknown"])).min(1).max(8).refine(unique),
  interval: z.object({ start: timestampSchema, end: timestampSchema }).strict(), confidence: z.number().min(0).max(1),
}).strict();
const locationSchema = z.object({
  ...commonContent, type: z.literal("location"), raw: emptyRaw, latitude: decimalSchema,
  longitude: decimalSchema, accuracyMeters: magnitudeSchema, intervalStart: timestampSchema,
  intervalEnd: timestampSchema, provider: idSchema,
}).strict();
export const contentSchema = z.discriminatedUnion("type", [notificationSchema, noteSchema, receiptContentSchema, emailSchema, activitySchema, locationSchema])
  .superRefine((content, ctx) => {
    if (content.type === "activity" && Date.parse(content.interval.end) < Date.parse(content.interval.start)) {
      ctx.addIssue({ code: "custom", path: ["interval"], message: "Interval is reversed" });
    }
    if (content.type === "location") {
      if (Math.abs(Number(content.latitude)) > 90 || Math.abs(Number(content.longitude)) > 180) {
        ctx.addIssue({ code: "custom", message: "Coordinates are out of range" });
      }
      if (Date.parse(content.intervalEnd) < Date.parse(content.intervalStart)) {
        ctx.addIssue({ code: "custom", path: ["intervalEnd"], message: "Interval is reversed" });
      }
    }
  });

export const envelopeSchema = z.object({
  contractVersion: z.literal(2), deliveryId: uuidSchema, sourceInstanceId: idSchema,
  sourceObservationKey: text(1, 512), producerRevisionId: uuidSchema,
  producerSequence: z.string().regex(/^[1-9][0-9]{0,18}$/)
    .refine(value => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n, "Sequence exceeds int64"),
  changeKind: z.enum(["posted", "updated", "removed", "imported"]),
  canonicalizationVersion: z.literal("jcs-sha256-v1"), contentFingerprint: hashSchema,
  sourceOccurredAt: timestampSchema.nullable(), sourceUpdatedAt: timestampSchema.nullable(),
  deviceObservedAt: timestampSchema, content: contentSchema,
}).strict().superRefine((envelope, ctx) => {
  if (Buffer.byteLength(JSON.stringify(envelope), "utf8") > 65536) {
    ctx.addIssue({ code: "custom", message: "Item exceeds UTF-8 byte limit", params: { apiCode: "payload_too_large", statusCode: 413 } });
  }
  try {
    if (fingerprint(envelope) !== envelope.contentFingerprint) {
      ctx.addIssue({ code: "custom", path: ["contentFingerprint"], message: "Fingerprint mismatch", params: { apiCode: "fingerprint_mismatch", statusCode: 422 } });
    }
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid JSON content" });
  }
});
export type Envelope = z.infer<typeof envelopeSchema>;
export type Content = z.infer<typeof contentSchema>;

export function fingerprint(value: Pick<Envelope, "changeKind" | "content" | "sourceOccurredAt" | "sourceUpdatedAt">): string {
  const { changeKind, content, sourceOccurredAt, sourceUpdatedAt } = value;
  return createHash("sha256").update(canonicalize({ changeKind, content, sourceOccurredAt, sourceUpdatedAt }), "utf8").digest("hex");
}

export function parseEnvelope(value: unknown): Envelope {
  // Check before parsing: normalization/stripping must never alter fingerprint input.
  canonicalize(value);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 65536) {
    throw new ApiError(413, "payload_too_large", "Item exceeds UTF-8 byte limit");
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if ((record.contractVersion !== undefined && record.contractVersion !== 2)
      || (record.canonicalizationVersion !== undefined && record.canonicalizationVersion !== "jcs-sha256-v1")) {
      throw new ApiError(422, "unsupported_contract", "Unsupported contract version");
    }
  }
  const result = envelopeSchema.safeParse(value);
  if (result.success) return result.data;
  // A strict-shape error wins over hashing a parser result with rejected keys
  // removed. Fingerprints are meaningful only after the shape is valid.
  if (result.error.issues.some(item => item.code !== "custom")) {
    throw new ApiError(400, "invalid_request", "Invalid observation envelope");
  }
  const issue = result.error.issues.find(item => item.code === "custom" && item.params?.apiCode);
  if (issue?.code === "custom") {
    throw new ApiError(Number(issue.params?.statusCode ?? 400), String(issue.params?.apiCode ?? "invalid_request"), issue.message);
  }
  throw new ApiError(400, "invalid_request", "Invalid observation envelope");
}

/** Items deliberately remain unknown here: the route validates each independently. */
export const batchSchema = z.object({ contractVersion: z.literal(2), items: z.array(z.unknown()).min(1).max(100) }).strict()
  .superRefine((batch, ctx) => {
    if (Buffer.byteLength(JSON.stringify(batch), "utf8") > 1048576) {
      ctx.addIssue({ code: "custom", message: "Batch exceeds UTF-8 byte limit", params: { apiCode: "payload_too_large", statusCode: 413 } });
    }
  });
export type BatchRequest = z.infer<typeof batchSchema>;

export const policySchema = z.object({
  expectedVersion: versionSchema, enabled: z.boolean(), externalModelsAllowed: z.boolean(),
  externalEmbeddingsAllowed: z.boolean(), retentionDays: z.number().int().min(1).max(3650).nullable(),
}).strict().refine(value => value.externalModelsAllowed || !value.externalEmbeddingsAllowed,
  { path: ["externalEmbeddingsAllowed"], message: "External embeddings require external models permission" });
export type PolicyRequest = z.infer<typeof policySchema>;

const entityRefSchema = z.object({ entityId: idSchema, entityType: idSchema, label: text() }).strict();
export const typedValueSchema = z.discriminatedUnion("factType", [
  z.object({ factType: z.literal("string"), value: text(0, 8192) }).strict(),
  z.object({ factType: z.literal("decimal"), value: decimalSchema }).strict(),
  z.object({ factType: z.literal("currency"), value: currencySchema }).strict(),
  z.object({ factType: z.literal("timestamp"), value: timestampSchema }).strict(),
  z.object({ factType: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ factType: z.literal("entity_ref"), value: entityRefSchema }).strict(),
]);
export type TypedValue = z.infer<typeof typedValueSchema>;
const correctionCommon = {
  idempotencyKey: idSchema, scope: z.enum(["once", "rule"]),
  ruleMatch: z.object({ sourceInstanceId: idSchema, exactDescriptor: text(1, 512) }).strict().nullable(),
  reason: text(0, 2000).optional(),
};
const target = <T extends "fact" | "event" | "transaction" | "episode">(type: T) =>
  z.object({ type: z.literal(type), id: idSchema, expectedVersion: versionSchema }).strict();
const correction = <T extends "fact" | "event" | "transaction" | "episode", F extends string, V extends z.ZodTypeAny>(type: T, field: F, value: V) =>
  z.object({ ...correctionCommon, target: target(type), field: z.literal(field), value }).strict();
const membershipValue = z.object({ eventIds: z.array(idSchema).min(1).max(100) }).strict();
export const correctionSchema = z.union([
  correction("fact", "fact_value", typedValueSchema),
  correction("event", "event_type", eventTypeSchema),
  correction("event", "lifecycle", eventLifecycleSchema),
  correction("event", "occurred_start", timestampSchema),
  correction("event", "occurred_end", timestampSchema.nullable()),
  correction("transaction", "merchant_label", text(1, 512)),
  correction("transaction", "category", idSchema),
  correction("transaction", "account_id", idSchema),
  correction("transaction", "amount", magnitudeSchema),
  correction("transaction", "currency", currencySchema),
  correction("transaction", "occurred_at", timestampSchema),
  correction("transaction", "posted_at", timestampSchema.nullable()),
  correction("transaction", "kind", transactionKindSchema),
  correction("transaction", "lifecycle", transactionLifecycleSchema),
  correction("episode", "membership_include", membershipValue),
  correction("episode", "membership_exclude", membershipValue),
  correction("episode", "split", z.object({ groups: z.array(membershipValue).min(2).max(20) }).strict()),
  correction("episode", "merge", z.object({ sourceEpisodeIds: z.array(idSchema).min(1).max(50), targetEpisodeId: idSchema }).strict()),
]).refine(value => value.scope !== "rule" || value.ruleMatch !== null,
  { path: ["ruleMatch"], message: "Rule scope requires ruleMatch" });
export type CorrectionRequest = z.infer<typeof correctionSchema>;

const orderedRange = (value: { from?: string; to?: string }) => !value.from || !value.to || Date.parse(value.from) <= Date.parse(value.to);
export const querySchema = z.object({
  query: text(1, 2000), maxEvidence: z.number().int().min(1).max(30), externalSynthesisAllowed: z.boolean(),
  filters: z.object({ sourceInstanceIds: z.array(idSchema).max(100).optional(), from: timestampSchema.optional(),
    to: timestampSchema.optional(), types: z.array(evidenceTypeSchema).max(5).refine(unique).optional() }).strict(),
}).strict().refine(value => orderedRange(value.filters), { path: ["filters"], message: "Date range is reversed" });
export type QueryRequest = z.infer<typeof querySchema>;

// Query strings accept decimal integer text only; arrays, blanks and booleans fail.
const limitSchema = z.union([z.number().int(), z.string().regex(/^[0-9]+$/).transform(Number)])
  .pipe(z.number().int().min(1).max(100)).default(50);
const pageFields = { cursor: cursorSchema.optional(), limit: limitSchema };
export const pageSchema = z.object(pageFields).strict();
export const financialListSchema = z.object({
  ...pageFields, from: timestampSchema, to: timestampSchema, currency: currencySchema.optional(),
  lifecycle: transactionLifecycleSchema.optional(), accountId: idSchema.optional(),
}).strict().refine(orderedRange, "Date range is reversed");
export const financialSummarySchema = z.object({
  from: timestampSchema, to: timestampSchema, accountId: idSchema.optional(),
  conversionTo: z.enum(["USD", "UYU"]).optional(), fxRateId: idSchema.optional(),
}).strict().refine(value => orderedRange(value) && Date.parse(value.to) - Date.parse(value.from) <= 366 * 86400000,
  "Date range must be ordered and at most 366 days")
  .refine(value => value.conversionTo === undefined || value.fxRateId !== undefined,
    { path: ["fxRateId"], message: "Conversion requires fxRateId" });
export const exportSchema = z.object({
  ...pageFields, from: timestampSchema.optional(), to: timestampSchema.optional(),
  types: z.union([exportTypeSchema.transform(value => [value]), z.array(exportTypeSchema)]).refine(unique).optional(),
}).strict().refine(orderedRange, "Date range is reversed");
export const episodeListSchema = z.object({
  ...pageFields, sourceInstanceId: idSchema.optional(), from: timestampSchema.optional(), to: timestampSchema.optional(),
  type: episodeTypeSchema.optional(), status: episodeStatusSchema.optional(),
}).strict().refine(orderedRange, "Date range is reversed");
export type PageQuery = z.infer<typeof pageSchema>;
export type FinancialListQuery = z.infer<typeof financialListSchema>;
export type FinancialSummaryQuery = z.infer<typeof financialSummarySchema>;
export type ExportQuery = z.infer<typeof exportSchema>;
export type EpisodeListQuery = z.infer<typeof episodeListSchema>;
