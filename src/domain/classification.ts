import type { ClassifiedEvent, EventInput } from "./event.js";

export const CLASSIFICATION_VERSION = "heuristic-v2";

function normalizeForMatching(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Detects posted card purchases. Rejected or attempted charges intentionally do
 * not pass this check: they remain notifications and never create ledger rows.
 */
export function isCompletedCardTransactionAlert(event: Pick<EventInput, "kind" | "title" | "body">) {
  if (event.kind !== "notification" && event.kind !== "email") {
    return false;
  }

  const text = normalizeForMatching(`${event.title ?? ""} ${event.body ?? ""}`);
  if (isRejectedCardTransactionAlert(event)) {
    return false;
  }

  const postedTransaction = /\b(se\s+realizo|se\s+efectuo|registramos|confirmamos)\s+(?:una\s+)?transaccion\b/u.test(text);
  const cardReference = /\b(?:tarjeta|visa|mastercard|amex)\b/u.test(text);
  const amount = /\b(?:uyu|usd|ars|brl|clp|cop|eur|gbp|mxn|pen)\s*\d+(?:[.,]\d{1,2})?\b|[$€£]\s*\d+(?:[.,]\d{1,2})?/iu.test(text);

  return postedTransaction && cardReference && amount;
}

export function isRejectedCardTransactionAlert(event: Pick<EventInput, "kind" | "title" | "body">) {
  const text = normalizeForMatching(`${event.title ?? ""} ${event.body ?? ""}`);
  return /\b(se\s+rechazo|rechazada|rechazado|declinada|declinado|declined)\b/u.test(text) &&
    /\b(?:tarjeta|visa|mastercard|amex|transaccion)\b/u.test(text);
}

/** A posted account-to-account movement is not spending or earnings. */
export function isAccountTransferAlert(event: Pick<EventInput, "kind" | "title" | "body">) {
  if (event.kind !== "notification" && event.kind !== "email") return false;
  const text = normalizeForMatching(`${event.title ?? ""} ${event.body ?? ""}`);
  return /\btransferencia\b/u.test(text)
    && /\b(?:realizada|enviada|recibida|acreditada|confirmada)\b/u.test(text)
    && /\b(?:desde\s+la\s+cuenta|a\s+la\s+cuenta|entre\s+cuentas)\b/u.test(text);
}

function extractCardAlertMerchant(value: string) {
  const directMatch = value.match(
    /\b(?:en|establecimiento)\s+([\p{L}\p{N}][\p{L}\p{N}&*\/-]*(?:\s+[\p{L}\p{N}&*\/-]+){0,8})(?=\.?\s+(?:si|fecha|a\s+las|el)\b|[.!]|$)/iu,
  );
  if (directMatch?.[1]?.trim()) return directMatch[1].trim();

  // Some card processors prefix the descriptor with a phone/reference and a
  // slash instead of the usual Spanish `en <merchant>` form. Preserve the
  // descriptor as evidence for the model, while dropping the transport noise.
  const descriptorMatch = value.match(
    /\b(?:monto\s+de|importe)\s+(?:ars|brl|clp|cop|eur|gbp|mxn|pen|usd|uyu)\s*\d+(?:[.,]\d{1,2})?\s+(?:en\s+)?(?:\+?\d{7,16}\/)?([\p{L}\p{N}][\p{L}\p{N}&*\/+._-]*(?:\s+[\p{L}\p{N}&*\/+._-]+){0,8})(?=\.?\s+(?:si|fecha|a\s+las|el)\b|[.!]|$)/iu,
  );
  return descriptorMatch?.[1]?.trim().replace(/[.!?,;:]+$/u, "") ?? null;
}

export function classifyEvent(event: EventInput): ClassifiedEvent {
  const content = `${event.title ?? ""} ${event.body ?? ""}`;
  const text = normalizeForMatching(content);
  const moneyMatch = content.match(/(?:[$€£]\s?\d+(?:[.,]\d{1,2})?)|(?:(?:ars|brl|clp|cop|eur|gbp|mxn|pen|usd|uyu)\s?\d+(?:[.,]\d{1,2})?)|(?:\d+(?:[.,]\d{1,2})?\s?(?:ars|brl|clp|cop|eur|gbp|mxn|pen|usd|uyu))/iu);
  const completedCardTransaction = isCompletedCardTransactionAlert(event);
  const rejectedCardTransaction = isRejectedCardTransactionAlert(event);
  const accountTransfer = isAccountTransferAlert(event);

  let inferredKind: ClassifiedEvent["inferredKind"] = "other";
  let confidence = 0.4;
  const entities: ClassifiedEvent["entities"] = [];

  if (rejectedCardTransaction) {
    inferredKind = "notification";
    confidence = 0.98;
  } else if (accountTransfer) {
    inferredKind = "transfer";
    confidence = 0.97;
  } else if (completedCardTransaction) {
    inferredKind = "expense";
    confidence = 0.99;
  } else if (event.kind === "expense") {
    inferredKind = "expense";
    confidence = 0.88;
  } else if (text.includes("compra") || text.includes("gasto")) {
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

  if ((event.kind === "notification" || event.kind === "email") && moneyMatch?.[0] && inferredKind === "other") {
    inferredKind = "expense";
    confidence = 0.82;
  }

  if (moneyMatch?.[0]) {
    entities.push({ type: "amount", value: moneyMatch[0] });
  }

  if (completedCardTransaction) {
    const merchant = extractCardAlertMerchant(content);
    if (merchant) {
      entities.push({ type: "merchant", value: merchant });
    }
  }

  return {
    ...event,
    classificationVersion: CLASSIFICATION_VERSION,
    inferredKind,
    confidence,
    entities,
  };
}
