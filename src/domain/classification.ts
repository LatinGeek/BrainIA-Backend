import type { ClassifiedEvent, EventInput } from "./event.js";
import { findMoneyText, MONEY_NUMBER_SOURCE } from "./money.js";

export const CLASSIFICATION_VERSION = "heuristic-v4";

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
  const amount = Boolean(findMoneyText(text));

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

/** A transfer addressed to a person is a payment, not money moved internally. */
export function isThirdPartyTransferAlert(event: Pick<EventInput, "kind" | "title" | "body">) {
  if (event.kind !== "notification" && event.kind !== "email") return false;
  const text = normalizeForMatching(`${event.title ?? ""} ${event.body ?? ""}`);
  return /\b(?:transferencia|transfer|pago)\b/u.test(text)
    && /\b(?:realizada|enviada|efectuada|confirmada|completada)\b/u.test(text)
    && /\b(?:a|para)\s+(?!la\s+cuenta\b|cuenta\b)[a-z]/u.test(text)
    && !/\b(?:a\s+la\s+cuenta|entre\s+cuentas)\b/u.test(text);
}

/** Explicit settlement wins over promotional footers in a genuine receipt. */
export function isCompletedFinancialNotice(event: Pick<EventInput, "kind" | "title" | "body">) {
  if (event.kind !== "notification" && event.kind !== "email") return false;
  if (isRejectedCardTransactionAlert(event)) return false;
  if (isCompletedCardTransactionAlert(event) || isAccountTransferAlert(event) || isThirdPartyTransferAlert(event)) return true;
  const text = normalizeForMatching(`${event.title ?? ""} ${event.body ?? ""}`);
  return /\b(?:gastaste|pagaste|descontamos|se pago|pago realizado|pago confirmado|pago aprobado|compra aprobada|compra realizada|compra confirmada|you paid|payment approved|payment completed|payment successful|purchase approved|purchase confirmed)\b/u.test(text);
}

/** Prices, balances and order follow-ups are evidence, not posted spending. */
export function isNonTransactionalFinancialNotice(event: Pick<EventInput, "kind" | "title" | "body">) {
  if (event.kind !== "notification" && event.kind !== "email") return false;
  if (isRejectedCardTransactionAlert(event)) return true;
  if (isCompletedFinancialNotice(event)) return false;
  const text = normalizeForMatching(`${event.title ?? ""} ${event.body ?? ""}`);
  return /\b(?:promocion|promocional|oferta|descuento|ahorra|gratis|suscribite|suscribete|sumate|pedi|hace tu pedido|haz tu pedido|compra ahora|compra con mas seguridad|crea un numero de tarjeta|prextamo|precio especial|super precio|feria de dolares|aprovecha la oportunidad|conocer tu experiencia|confirma si recibiste|saldo disponible|saldo actual|available balance|special offer|discount|subscribe now|order now)\b/u.test(text);
}

function extractCardAlertMerchant(value: string) {
  const directMatch = value.match(
    /\bestablecimiento\s+([\p{L}\p{N}][\p{L}\p{N}&*\/-]*(?:\s+[\p{L}\p{N}&*\/-]+){0,8})(?=\.?\s+(?:si|fecha|a\s+las|el)\b|[.!]|$)/iu,
  );
  if (directMatch?.[1]?.trim()) return directMatch[1].trim();

  // Some card processors prefix the descriptor with a phone/reference and a
  // slash instead of the usual Spanish `en <merchant>` form. Preserve the
  // descriptor as evidence for the model, while dropping the transport noise.
  const descriptorMatch = value.match(new RegExp(
    String.raw`\b(?:monto\s+de|importe)\s+(?:ars|brl|clp|cop|eur|gbp|mxn|pen|usd|uyu)\s*${MONEY_NUMBER_SOURCE}\s+(?:en\s+)?(?:\+?\d{7,16}\/)?([\p{L}\p{N}][\p{L}\p{N}&*\/+._-]*(?:\s+[\p{L}\p{N}&*\/+._-]+){0,8}?)(?=\.?\s+(?:si|fecha|a\s+las|el)\b|[.!]|$)`,
    "iu",
  ));
  return descriptorMatch?.[1]?.trim().replace(/[.!?,;:]+$/u, "") ?? null;
}

/** Prex confirms settled purchases as `Gastaste $ … en <comercio>`. */
function extractCompletedPaymentMerchant(value: string) {
  const match = value.match(new RegExp(
    String.raw`\b(?:gastaste|pagaste)\s+(?:(?:u\$s|usd|uyu)\s*)?[$€£]?\s*${MONEY_NUMBER_SOURCE}\s+en\s+(.+?)\s*$`,
    "iu",
  ));
  return match?.[1]?.trim().replace(/[.!?,;:]+$/u, "") || null;
}

export function classifyEvent(event: EventInput): ClassifiedEvent {
  const content = `${event.title ?? ""} ${event.body ?? ""}`;
  const text = normalizeForMatching(content);
  const moneyText = findMoneyText(content);
  const completedCardTransaction = isCompletedCardTransactionAlert(event);
  const rejectedCardTransaction = isRejectedCardTransactionAlert(event);
  const accountTransfer = isAccountTransferAlert(event);
  const thirdPartyTransfer = isThirdPartyTransferAlert(event);
  const selectedTransactionType = typeof event.raw?.transactionType === "string"
    && ["income", "expense", "transfer"].includes(event.raw.transactionType)
    ? event.raw.transactionType as "income" | "expense" | "transfer"
    : null;

  let inferredKind: ClassifiedEvent["inferredKind"] = "other";
  let confidence = 0.4;
  const entities: ClassifiedEvent["entities"] = [];

  // A transaction direction deliberately chosen in Capture is source-of-truth.
  // Do this before textual payment heuristics: titles such as "fee paid" can
  // otherwise make a user-entered income look like an expense.
  if (selectedTransactionType && event.kind === selectedTransactionType) {
    inferredKind = selectedTransactionType;
    confidence = 1;
  } else if (rejectedCardTransaction) {
    inferredKind = "notification";
    confidence = 0.98;
  } else if (isNonTransactionalFinancialNotice(event)) {
    inferredKind = "notification";
    confidence = 0.98;
  } else if (accountTransfer) {
    inferredKind = "transfer";
    confidence = 0.97;
  } else if (thirdPartyTransfer) {
    inferredKind = "expense";
    confidence = 0.96;
  } else if (completedCardTransaction) {
    inferredKind = "expense";
    confidence = 0.99;
  } else if (event.kind === "expense") {
    inferredKind = "expense";
    confidence = 0.88;
  } else if (event.kind === "income") {
    inferredKind = "income";
    confidence = 0.88;
  } else if (event.kind === "transfer") {
    inferredKind = "transfer";
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

  if ((event.kind === "notification" || event.kind === "email") && moneyText && inferredKind === "other") {
    // A standalone price or balance does not establish that money moved.
    // Explicit settlement wording still handles terse wallet notifications.
    const completed = isCompletedFinancialNotice(event);
    inferredKind = completed ? "expense" : "notification";
    confidence = completed ? 0.82 : 0.5;
  }

  if (moneyText) {
    entities.push({ type: "amount", value: moneyText });
  }

  if (completedCardTransaction) {
    const merchant = extractCardAlertMerchant(content);
    if (merchant) {
      entities.push({ type: "merchant", value: merchant });
    }
  }

  // Some wallet providers do not mention a card, so they do not enter the
  // Santander-style card-alert branch above. Their settled-payment wording is
  // still explicit enough to expose a merchant for the ledger projection.
  if (inferredKind === "expense" && !entities.some((entity) => entity.type === "merchant")) {
    const merchant = extractCompletedPaymentMerchant(content);
    if (merchant) entities.push({ type: "merchant", value: merchant });
  }

  return {
    ...event,
    classificationVersion: CLASSIFICATION_VERSION,
    inferredKind,
    confidence,
    entities,
  };
}
