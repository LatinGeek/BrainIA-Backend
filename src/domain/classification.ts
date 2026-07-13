import type { ClassifiedEvent, EventInput } from "./event.js";

export const CLASSIFICATION_VERSION = "heuristic-v1";

export function classifyEvent(event: EventInput): ClassifiedEvent {
  const text = `${event.title ?? ""} ${event.body ?? ""}`.toLowerCase();

  let inferredKind: ClassifiedEvent["inferredKind"] = "other";
  let confidence = 0.4;
  const entities: ClassifiedEvent["entities"] = [];

  if (text.includes("transferencia") || text.includes("compra") || text.includes("gasto")) {
    inferredKind = "expense";
    confidence = 0.9;
  } else if (text.includes("@") || text.includes("mail") || text.includes("inbox")) {
    inferredKind = "email";
    confidence = 0.8;
  } else if (text.includes("nota") || text.includes("journal")) {
    inferredKind = "note";
    confidence = 0.75;
  } else if (text.includes("recordatorio") || text.includes("reminder")) {
    inferredKind = "task";
    confidence = 0.72;
  }

  const moneyMatch = text.match(/([$€]\s?\d+(?:[.,]\d{2})?)|(\d+(?:[.,]\d{2})?\s?(ars|usd|eur))/i);
  if (moneyMatch?.[0]) {
    entities.push({ type: "amount", value: moneyMatch[0] });
  }

  return {
    ...event,
    classificationVersion: CLASSIFICATION_VERSION,
    inferredKind,
    confidence,
    entities,
  };
}
