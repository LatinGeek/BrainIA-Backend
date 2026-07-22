import type { ClassifiedEvent, EventInput } from "./event.js";
import type { FinancialTransactionCandidate } from "./financial-transactions.js";
import type { SemanticDecision } from "../storage/semantic-enrichment.js";
import type { EntityDraft } from "./entities.js";

export type EventInterpretation = {
  displayTitle: string | null;
  displayDescription: string | null;
  status: "resolved" | "review" | "retryable" | "unclassified";
  source: "deepseek" | "structural";
  confidence: number | null;
  model: string;
  promptVersion: string;
  failureReason: string | null;
};

const GENERIC_NAMES = /^(?:aviso|alerta|notification|notificaci(?:o|ó)n|message|mensaje|movimiento|transaction|transacci(?:o|ó)n)$/iu;

function meaningful(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length >= 2 && !GENERIC_NAMES.test(trimmed) && !/(?:\.\.\.|…)$/.test(trimmed);
}

function formattedAmount(candidate: FinancialTransactionCandidate) {
  return `${candidate.currency} ${candidate.amount.toFixed(2)}`;
}

export function buildEventInterpretation(input: {
  event: Pick<EventInput, "source">;
  classified: Pick<ClassifiedEvent, "inferredKind">;
  decision: SemanticDecision;
  eventIdentity?: EntityDraft | null;
  financialCandidate?: FinancialTransactionCandidate | null;
}): EventInterpretation {
  const eventPath = input.decision.paths.find((path) =>
    ["financial_event", "email_message", "activity_instance"].includes(path.subject.type),
  );
  const merchantPath = input.decision.paths.find((path) => path.subject.type === "merchant");
  const governedEventIdentity = eventPath?.subject ?? input.eventIdentity ?? null;
  const identityTitle = governedEventIdentity?.value?.trim() ?? null;
  const identityDescription = governedEventIdentity?.description?.trim() ?? null;
  const merchant = merchantPath?.subject.value?.trim() ?? input.financialCandidate?.merchantLabel?.trim() ?? null;

  let displayTitle = meaningful(identityTitle) ? identityTitle : null;
  let displayDescription = identityDescription && identityDescription.length >= 20 ? identityDescription : null;

  if (input.financialCandidate && meaningful(merchant) && merchantPath?.subject.identitySource === "ai") {
    const isIncome = String(input.classified.inferredKind) === "income";
    const isTransfer = String(input.classified.inferredKind) === "transfer";
    const direction = isIncome ? "income" : isTransfer ? "transfer" : "payment";
    displayTitle = `${merchant} ${direction} · ${formattedAmount(input.financialCandidate)}`;
    displayDescription = isTransfer
      ? `An ${formattedAmount(input.financialCandidate)} transfer between your accounts, captured from ${input.event.source}.`
      : isIncome
        ? `An ${formattedAmount(input.financialCandidate)} income event associated with ${merchant}, captured from ${input.event.source}.`
        : `A ${formattedAmount(input.financialCandidate)} payment to ${merchant}, captured from ${input.event.source}.`;
  }

  const hasAiEventIdentity = governedEventIdentity?.identitySource === "ai" && governedEventIdentity.metadata?.aiIdentity === true;
  const source = hasAiEventIdentity ? "deepseek" : input.decision.source;
  const status = input.decision.source === "structural"
    ? "retryable"
    : input.decision.status === "resolved"
      ? "resolved"
      : input.decision.status === "review"
        ? "review"
        : "unclassified";

  return {
    displayTitle: source === "deepseek" ? displayTitle : null,
    displayDescription: source === "deepseek" ? displayDescription : null,
    status,
    source,
    confidence: eventPath?.identity?.confidence ?? eventPath?.confidence ?? null,
    model: input.decision.model,
    promptVersion: input.decision.promptVersion,
    failureReason: input.decision.failureReason ?? null,
  };
}
