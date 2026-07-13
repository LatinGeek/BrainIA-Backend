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
  kind: eventKindSchema.default("other"),
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  timestamp: z.string().datetime().optional(),
  externalId: z.string().optional(),
  raw: z.record(z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
});

export type EventInput = z.infer<typeof eventSchema>;

export type ClassifiedEvent = EventInput & {
  confidence: number;
  inferredKind: z.infer<typeof eventKindSchema>;
  entities: Array<{
    type: string;
    value: string;
  }>;
};

