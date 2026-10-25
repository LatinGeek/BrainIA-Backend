// Selective event reprocessing contract.
//
// The queue is the single execution path for a selective request. This module
// deliberately contains no I/O: the HTTP route, the queue producer and the
// worker share the same stage names, ordering, prerequisites and errors.

export const REPROCESS_STAGES = [
  "classification",
  "semanticInterpretation",
  "financialCorrelation",
  "embeddings",
] as const;

export type ReprocessStage = typeof REPROCESS_STAGES[number];

export type ReprocessStageSpec = {
  stage: ReprocessStage;
  /** Existing background job type that owns this stage's work. */
  jobType: "classification" | "semantic_enrichment" | "financial_correlation" | "embedding";
  /** Stages that must have produced a record before this stage can run. */
  prerequisites: readonly ReprocessStage[];
  /** Human-readable behavior, reused by the API documentation. */
  requires: string;
};

export const REPROCESS_STAGE_SPECS: Record<ReprocessStage, ReprocessStageSpec> = {
  classification: {
    stage: "classification",
    jobType: "classification",
    prerequisites: [],
    requires: "a stored raw event that is processing-allowed and not privacy-hidden",
  },
  semanticInterpretation: {
    stage: "semanticInterpretation",
    jobType: "semantic_enrichment",
    prerequisites: ["classification"],
    requires: "a classification row for the event, or classification in the same request",
  },
  financialCorrelation: {
    stage: "financialCorrelation",
    jobType: "financial_correlation",
    prerequisites: ["classification"],
    requires: "a classification row for the event, or classification in the same request",
  },
  embeddings: {
    stage: "embeddings",
    jobType: "embedding",
    prerequisites: ["classification"],
    requires: "a classification row for the event, or classification in the same request",
  },
};

/** Canonical execution order independent of the order the caller supplied. */
export const REPROCESS_STAGE_ORDER: readonly ReprocessStage[] = REPROCESS_STAGES;

export class ReprocessRequestError extends Error {
  readonly statusCode: 400 | 404 | 409;
  readonly code: string;
  readonly retryable = false;
  readonly details: Record<string, unknown>;

  constructor(
    statusCode: 400 | 404 | 409,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ReprocessRequestError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toResponse() {
    return { error: this.code, message: this.message, ...this.details };
  }
}

export class InvalidReprocessSelectionError extends ReprocessRequestError {
  constructor(message = "At least one valid reprocessing stage is required") {
    super(400, "invalid_reprocess_selection", message, { allowedStages: [...REPROCESS_STAGES] });
    this.name = "InvalidReprocessSelectionError";
  }
}

export class ReprocessEventNotFoundError extends ReprocessRequestError {
  constructor() {
    super(404, "event_not_found", "No stored event matches the provided id");
    this.name = "ReprocessEventNotFoundError";
  }
}

export class ReprocessNotProcessableError extends ReprocessRequestError {
  constructor(reason: string) {
    super(409, "event_not_processable", "This event cannot be reprocessed", { reason });
    this.name = "ReprocessNotProcessableError";
  }
}

export type MissingReprocessPrerequisite = {
  stage: ReprocessStage;
  requires: ReprocessStage[];
  reason: string;
};

export class ReprocessPrerequisitesMissingError extends ReprocessRequestError {
  readonly missing: MissingReprocessPrerequisite[];

  constructor(missing: MissingReprocessPrerequisite[]) {
    super(
      409,
      "reprocess_prerequisites_missing",
      "The requested stages have unmet prerequisites; include the prerequisite stage or run it first",
      { missing },
    );
    this.name = "ReprocessPrerequisitesMissingError";
    this.missing = missing;
  }
}

export class ReprocessInProgressError extends ReprocessRequestError {
  constructor(activeJobId: string, activeStages: ReprocessStage[]) {
    super(
      409,
      "reprocess_in_progress",
      "Another reprocessing execution is active for this event; wait for it or request a subset it already covers",
      { activeJob: { id: activeJobId, stages: activeStages } },
    );
    this.name = "ReprocessInProgressError";
  }
}

export class ReprocessRequestIdConflictError extends ReprocessRequestError {
  constructor() {
    super(
      409,
      "reprocess_idempotency_key_conflict",
      "This idempotency key was already used with a different stage selection",
    );
    this.name = "ReprocessRequestIdConflictError";
  }
}

/**
 * Raised by a worker when a prerequisite disappeared between acceptance and
 * execution. It is permanent for this attempt: repeating the same job cannot
 * recreate the dependency, so the job is dead-lettered instead of retried.
 */
export class ReprocessPrerequisiteError extends Error {
  readonly code = "reprocess_prerequisite_missing";
  readonly retryable = false;

  constructor(readonly stage: ReprocessStage, readonly missing: ReprocessStage[]) {
    super(`${stage} requires ${missing.join(", ")} before it can run`);
    this.name = "ReprocessPrerequisiteError";
  }
}

export function isReprocessStage(value: unknown): value is ReprocessStage {
  return typeof value === "string" && (REPROCESS_STAGES as readonly string[]).includes(value);
}

/**
 * Validates and canonicalizes a selection. Duplicates are removed and the
 * canonical dependency order is always used by the worker.
 */
export function normalizeReprocessStages(value: unknown): ReprocessStage[] {
  if (!Array.isArray(value) || value.length === 0) throw new InvalidReprocessSelectionError();
  const selected = new Set<ReprocessStage>();
  for (const entry of value) {
    if (!isReprocessStage(entry)) {
      throw new InvalidReprocessSelectionError(`Unknown reprocessing stage: ${String(entry)}`);
    }
    selected.add(entry);
  }
  return REPROCESS_STAGE_ORDER.filter((stage) => selected.has(stage));
}

export function reprocessStageKey(stages: readonly ReprocessStage[]) {
  return REPROCESS_STAGE_ORDER.filter((stage) => stages.includes(stage)).join("+");
}

export function sameReprocessSelection(
  left: readonly ReprocessStage[],
  right: readonly ReprocessStage[],
) {
  return reprocessStageKey(left) === reprocessStageKey(right);
}

/**
 * Computes unmet prerequisites from persisted state plus stages that the same
 * queued execution will run first. Classification in the request satisfies the
 * dependency for the later stages of that same job; it is never auto-added.
 */
export function missingReprocessPrerequisites(
  stages: readonly ReprocessStage[],
  satisfied: Partial<Record<ReprocessStage, boolean>>,
): MissingReprocessPrerequisite[] {
  const selected = new Set(stages);
  const missing: MissingReprocessPrerequisite[] = [];
  for (const stage of stages) {
    const unmet = REPROCESS_STAGE_SPECS[stage].prerequisites
      .filter((prerequisite) => !selected.has(prerequisite) && !satisfied[prerequisite]);
    if (!unmet.length) continue;
    missing.push({
      stage,
      requires: [...unmet],
      reason: unmet.every((prerequisite) => prerequisite === "classification")
        ? "classification_record_missing"
        : "prerequisite_record_missing",
    });
  }
  return missing;
}

export type ReprocessExecutionMode = "coalesce" | "new";
