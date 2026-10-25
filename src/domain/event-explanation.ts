import type { StoredEventRecord } from '../storage/event-repository.js';

export type ExplanationCorrection = { id: string; field: string; value: string; createdAt: string; eventId: string };
export type ExplanationLink = { id: string; kind: 'entity' | 'transaction'; label: string };

// Only operational reason codes are public. Never serialize model prompts,
// responses, rationale, chain of thought, or arbitrary metadata.
const reasons: Record<string, string> = {
  private_evidence: 'No se consultó al modelo porque la evidencia es privada.',
  privacy_policy: 'La política de privacidad impidió consultar al modelo.',
  empty_response: 'El modelo no devolvió una respuesta utilizable.',
  invalid_response: 'La respuesta del modelo no cumplió el formato requerido.',
  parse_error: 'No se pudo leer la respuesta del modelo.',
};

export function explainEvent(event: StoredEventRecord, corrections: ExplanationCorrection[], links: ExplanationLink[]) {
  const visible = event.privacyStatus === 'standard';
  const metadata = event.modelMetadata ?? {};
  const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null;
  const correctionIds = Array.isArray(metadata.correctionIds) ? metadata.correctionIds : [];
  const applied = corrections.filter(c => c.eventId === event.id || correctionIds.includes(c.id));
  return {
    eventId: event.id,
    contentAvailable: visible,
    evidence: visible ? { title: event.title ?? null, body: event.body ?? null } : null,
    source: event.source,
    occurredAt: event.timestamp ?? null,
    ingestedAt: event.rawEventCreatedAt ?? null,
    classification: {
      version: text(event.classificationVersion),
      model: visible ? text(metadata.model) : null,
      provider: visible ? text(metadata.provider) : null,
      modelApplied: visible && typeof metadata.applied === 'boolean' ? metadata.applied : null,
      reason: visible && typeof metadata.reason === 'string' && Object.hasOwn(reasons, metadata.reason) ? reasons[metadata.reason] : null,
      hasAppliedCorrections: visible && correctionIds.length > 0,
    },
    // Extracted fields are candidates, not independently verified facts.
    fields: visible ? (event.classifiedEntities ?? []).map(field => ({
      type: field.type,
      value: field.value,
      origin: applied.some(c => c.field === field.type && c.value === field.value) ? 'human'
        : correctionIds.length > 0 ? 'unknown' : 'inferred',
    })) : [],
    corrections: visible ? applied.map(c => ({ field: c.field, value: c.value, createdAt: c.createdAt, reused: c.eventId !== event.id })) : [],
    links: visible ? links : [],
  };
}
