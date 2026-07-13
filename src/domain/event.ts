import { z } from "zod";

export const eventKindSchema = z.enum([
  "email",
  "expense",
  "note",
  "notification",
  "task",
  "other",
]);

export const eventSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  contractVersion: z.number().int().positive().default(1),
  kind: eventKindSchema.default("other"),
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  externalId: z.string().optional(),
  idempotencyKey: z.string().min(1).optional(),
  raw: z.record(z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
});

export type EventInput = z.infer<typeof eventSchema>;

export type ClassifiedEvent = EventInput & {
  classificationVersion: string;
  confidence: number;
  inferredKind: z.infer<typeof eventKindSchema>;
  entities: Array<{
    type: string;
    value: string;
  }>;
  modelMetadata?: Record<string, unknown> | null;
};
