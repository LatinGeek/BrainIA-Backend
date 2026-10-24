// Per-stage processing progress for one event.
//
// This module is a pure projection. It never stores anything: every status is
// derived from records that already exist (classified_events, the financial
// ledger link, knowledge_embeddings) and from the newest background job per
// stage. `raw_events.processing_status` stays the compatible overall status; the
// progress object explains it stage by stage.
//
// Rule that drives the whole file: a job that is merely queued, or whose attempt
// is still open, is never reported as completed. "completed" is only ever
// derived from a produced record (or a successful job whose record is optional).

export const PROGRESS_STAGES = ["classification", "semanticInterpretation", "financialProjection", "searchIndexing"] as const;
export type ProgressStage = typeof PROGRESS_STAGES[number];

export const PROGRESS_STATUSES = [
  "pending", "running", "completed", "awaiting_review", "recoverable_failure", "terminal_failure", "not_applicable",
] as const;
export type ProgressStatus = typeof PROGRESS_STATUSES[number];

export type ProgressEvidence = "record" | "job" | "policy" | "dependency" | "none";

export type ProgressJobType = "classification" | "semantic_enrichment" | "embedding";
export const PROGRESS_JOB_TYPES: readonly ProgressJobType[] = ["classification", "semantic_enrichment", "embedding"];

export type ProgressJobSnapshot = {
  status: "queued" | "running" | "retry_scheduled" | "succeeded" | "dead_letter" | "cancelled";
  attemptCount: number;
  maxAttempts: number;
  runAfter: string | null;
  leaseExpiresAt: string | null;
};

export type EventProgressSnapshot = {
  event: {
    kind: string;
    processingStatus: string;
    processingAllowed: boolean;
    privacyStatus: string;
  };
  /** Present when a classified_events row exists for the event. */
  classification: { inferredKind: string; interpretationStatus: string } | null;
  /** A financial_transaction_events row links the event to the ledger. */
  financialLinked: boolean;
  /** A knowledge_embeddings row for the event exists at the current version. */
  embedded: boolean;
  /** Newest job per stage, when one was ever enqueued. */
  jobs: Partial<Record<ProgressJobType, ProgressJobSnapshot>>;
};

export type StageJobInfo = {
  status: ProgressJobSnapshot["status"];
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
};

export type StageProgress = {
  status: ProgressStatus;
  /** Stable machine code, safe to branch on and to localize. */
  code: string;
  /** English fallback text for agents and logs. Clients should prefer `code`. */
  message: string;
  evidence: ProgressEvidence;
  /** Job facts when a job row informed the status (never the raw error text). */
  job: StageJobInfo | null;
};

export type EventProgress = {
  version: 1;
  summary: { status: ProgressStatus; partial: boolean; message: string };
  stages: Record<ProgressStage, StageProgress>;
  derivedAt: string;
};

const FINANCIAL_KINDS = new Set(["expense", "income", "transfer"]);
const isFinancialKind = (kind: string | null | undefined) => FINANCIAL_KINDS.has(kind ?? "");

const LABEL: Record<ProgressStage, string> = {
  classification: "classification",
  semanticInterpretation: "interpretation",
  financialProjection: "financial recording",
  searchIndexing: "search indexing",
};

function jobInfo(job: ProgressJobSnapshot | undefined): StageJobInfo | null {
  if (!job) return null;
  return {
    status: job.status,
    attempt: job.attemptCount,
    maxAttempts: job.maxAttempts,
    nextAttemptAt: job.status === "retry_scheduled" ? job.runAfter : null,
  };
}

function stage(
  status: ProgressStatus, code: string, message: string,
  evidence: ProgressEvidence, job?: ProgressJobSnapshot,
): StageProgress {
  return { status, code, message, evidence, job: jobInfo(job) };
}

/**
 * Status a job implies on its own. `succeeded` is deliberately absent: only the
 * caller knows whether the record the job should have produced exists.
 */
function fromJob(
  label: string, job: ProgressJobSnapshot, now: Date,
): StageProgress | null {
  const attempt = `attempt ${job.attemptCount} of ${job.maxAttempts}`;
  switch (job.status) {
    case "queued":
      return stage("pending", "job_queued", `Waiting in the queue for ${label}.`, "job", job);
    case "running": {
      const live = job.leaseExpiresAt !== null && Date.parse(job.leaseExpiresAt) > now.getTime();
      // An expired lease means the worker died or stalled; the job is claimable
      // again but nothing is running right now.
      return live
        ? stage("running", "job_running", `${cap(label)} is running (${attempt}).`, "job", job)
        : stage("pending", "lease_expired", `${cap(label)} stalled and is waiting to be picked up again.`, "job", job);
    }
    case "retry_scheduled":
      return stage("recoverable_failure", "retry_scheduled",
        `${cap(label)} failed (${attempt}); a retry is scheduled.`, "job", job);
    case "dead_letter":
      return stage("terminal_failure", "retries_exhausted",
        `${cap(label)} failed after ${job.attemptCount} attempts and will not retry automatically.`, "job", job);
    case "cancelled":
      return stage("terminal_failure", "job_cancelled", `${cap(label)} was cancelled.`, "job", job);
    default:
      return null;
  }
}

function cap(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function blocked(upstream: StageProgress, upstreamStage: ProgressStage, label: string): StageProgress | null {
  if (upstream.status === "terminal_failure") {
    return stage("terminal_failure", `blocked_by_${upstreamStage}`,
      `${cap(label)} cannot run because ${LABEL[upstreamStage]} failed.`, "dependency");
  }
  if (upstream.status === "pending" || upstream.status === "running" || upstream.status === "recoverable_failure") {
    return stage("pending", `waiting_for_${upstreamStage}`,
      `${cap(label)} is waiting for ${LABEL[upstreamStage]}.`, "dependency");
  }
  return null;
}

function deriveClassification(s: EventProgressSnapshot, now: Date): StageProgress {
  if (s.classification) return stage("completed", "classified", "Event classified.", "record", s.jobs.classification);
  const job = s.jobs.classification;
  if (job) {
    const mapped = fromJob("classification", job, now);
    if (mapped) return mapped;
    // Succeeded but the classified record is missing (for example after a data
    // deletion). Do not claim completion without the record.
    return stage("pending", "awaiting_record", "Classification finished but its result is not stored yet.", "job", job);
  }
  if (s.event.processingStatus === "retryable") {
    return stage("recoverable_failure", "retryable_without_job", "Classification failed and can be retried.", "none");
  }
  return stage("pending", "not_scheduled", "Classification has not been scheduled yet.", "none");
}

function deriveInterpretation(s: EventProgressSnapshot, classification: StageProgress, now: Date): StageProgress {
  if (s.event.processingStatus === "discarded" && s.classification) {
    return stage("not_applicable", "discarded_by_semantic_decision", "Event was discarded by the semantic decision.", "record");
  }
  if (classification.status !== "completed") {
    return blocked(classification, "classification", "interpretation")
      ?? stage("pending", "waiting_for_classification", "Interpretation is waiting for classification.", "dependency");
  }
  const job = s.jobs.semantic_enrichment;
  const status = s.classification!.interpretationStatus;
  // interpretation_status was added with a default of 'pending' and never backfilled,
  // so events resolved before it existed still read 'pending'. The overall status
  // is the evidence for them: only a semantic decision sets semantically_resolved.
  if (status === "resolved" || (status === "pending" && s.event.processingStatus === "semantically_resolved")) {
    return stage("completed", "interpreted", "Event interpreted.", "record", job);
  }
  if (status === "review" || s.event.processingStatus === "review") {
    return stage("awaiting_review", "needs_review", "Interpretation needs your review.", "record", job);
  }
  if (job) {
    const mapped = fromJob("interpretation", job, now);
    if (mapped) return mapped;
    return status === "retryable" || status === "unclassified"
      ? stage("recoverable_failure", "interpretation_unresolved",
        "Interpretation could not resolve the event and can be retried.", "job", job)
      : stage("pending", "awaiting_record", "Interpretation finished but its result is not stored yet.", "job", job);
  }
  return status === "retryable" || status === "unclassified"
    ? stage("recoverable_failure", "interpretation_retryable", "Interpretation could not resolve the event and can be retried.", "record")
    : stage("pending", "not_scheduled", "Interpretation has not been scheduled yet.", "none");
}

function deriveFinancial(s: EventProgressSnapshot, classification: StageProgress): StageProgress {
  if (s.financialLinked) {
    return stage("completed", "ledger_linked", "Transaction recorded in the ledger.", "record");
  }
  if (s.classification) {
    if (!isFinancialKind(s.classification.inferredKind)) {
      return stage("not_applicable", "not_financial", "Event is not a financial transaction.", "record");
    }
    return stage("terminal_failure", "ledger_not_derived",
      "A financial event was detected, but no transaction could be recorded (amount or direction unclear).", "record");
  }
  // Not classified yet. The ledger entry is written in the classification
  // transaction, so this stage can only follow it.
  if (classification.status === "terminal_failure") {
    return stage("terminal_failure", "blocked_by_classification",
      "Financial recording cannot run because classification failed.", "dependency");
  }
  return isFinancialKind(s.event.kind)
    ? stage("pending", "waiting_for_classification", "Financial recording is waiting for classification.", "dependency")
    : stage("pending", "applicability_unknown",
      "Waiting for classification to know whether this is a financial event.", "dependency");
}

function deriveSearch(s: EventProgressSnapshot, interpretation: StageProgress, now: Date): StageProgress {
  if (s.embedded) return stage("completed", "indexed", "Event is searchable.", "record", s.jobs.embedding);
  if (s.event.processingStatus === "discarded") {
    return stage("not_applicable", "discarded", "Discarded events are not indexed.", "record");
  }
  const job = s.jobs.embedding;
  if (job) {
    const mapped = fromJob("search indexing", job, now);
    if (mapped) return mapped;
    // The worker succeeded without storing an embedding: privacy policy declined it.
    return stage("not_applicable", "not_indexable", "Event is not eligible for search indexing.", "policy", job);
  }
  if (interpretation.status === "completed" || interpretation.status === "awaiting_review") {
    return stage("pending", "not_scheduled", "Search indexing has not been scheduled yet.", "none");
  }
  return blocked(interpretation, "semanticInterpretation", "search indexing")
    ?? stage("pending", "waiting_for_semanticInterpretation", "Search indexing is waiting for interpretation.", "dependency");
}

const SEVERITY: Record<ProgressStatus, number> = {
  terminal_failure: 6, recoverable_failure: 5, awaiting_review: 4, running: 3, pending: 2, completed: 1, not_applicable: 0,
};

const PHRASE: Partial<Record<ProgressStatus, string>> = {
  pending: "pending",
  running: "in progress",
  awaiting_review: "awaiting review",
  recoverable_failure: "failed and will retry",
  terminal_failure: "failed",
};

function summarize(stages: Record<ProgressStage, StageProgress>, s: EventProgressSnapshot) {
  const list = PROGRESS_STAGES.map((key) => ({ key, ...stages[key] }));
  const open = list.filter((item) => item.status !== "completed" && item.status !== "not_applicable");
  const anyCompleted = list.some((item) => item.status === "completed");
  const lead = open.reduce<typeof open[number] | null>(
    (best, item) => (!best || SEVERITY[item.status] > SEVERITY[best.status] ? item : best), null);

  if (!lead) {
    const status: ProgressStatus = anyCompleted ? "completed" : "not_applicable";
    if (!anyCompleted) return { status, partial: false, message: "Nothing to process for this event." };
    const noun = stages.financialProjection.status === "completed" ? `${financialNoun(s)} recorded; ` : "";
    return { status, partial: false, message: `${noun}${noun ? "processing complete." : "Processing complete."}` };
  }

  const prefix = stages.financialProjection.status === "completed" && lead.key !== "financialProjection"
    ? `${financialNoun(s)} recorded; ` : "";
  const phrase = `${LABEL[lead.key]} ${PHRASE[lead.status]}`;
  return {
    status: lead.status,
    // Partial success: something is already done while another stage is not.
    partial: anyCompleted,
    message: `${prefix ? prefix + phrase : cap(phrase)}.`,
  };
}

function financialNoun(s: EventProgressSnapshot) {
  switch (s.classification?.inferredKind ?? s.event.kind) {
    case "expense": return "Expense";
    case "income": return "Income";
    case "transfer": return "Transfer";
    default: return "Transaction";
  }
}

export function deriveEventProgress(snapshot: EventProgressSnapshot, now: Date = new Date()): EventProgress {
  const notApplicable = !snapshot.event.processingAllowed || snapshot.event.privacyStatus === "hidden";
  let stages: Record<ProgressStage, StageProgress>;
  if (notApplicable) {
    const reason = snapshot.event.privacyStatus === "hidden" ? "hidden_event" : "processing_disabled";
    const text = snapshot.event.privacyStatus === "hidden"
      ? "Hidden events are not processed." : "Processing is disabled for this event.";
    const na = () => stage("not_applicable", reason, text, "policy");
    stages = { classification: na(), semanticInterpretation: na(), financialProjection: na(), searchIndexing: na() };
  } else {
    const classification = deriveClassification(snapshot, now);
    const semanticInterpretation = deriveInterpretation(snapshot, classification, now);
    stages = {
      classification,
      semanticInterpretation,
      financialProjection: deriveFinancial(snapshot, classification),
      searchIndexing: deriveSearch(snapshot, semanticInterpretation, now),
    };
  }
  return { version: 1, summary: summarize(stages, snapshot), stages, derivedAt: now.toISOString() };
}
