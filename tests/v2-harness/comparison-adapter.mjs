// Read-only projection of existing domain functions. No oracle enters this module.
import { classifyEvent, CLASSIFICATION_VERSION } from '../../src/domain/classification.ts';
import { buildEntityDrafts } from '../../src/domain/entities.ts';
import { buildRelationDrafts } from '../../src/domain/relations.ts';
import { buildFinancialTransactionCandidate } from '../../src/domain/financial-transactions.ts';

export const revision = 'interpretation-comparison-1';
export const classificationVersion = CLASSIFICATION_VERSION;

export async function evaluate(input, config) {
  const observations = [];
  const prompts = [];
  for (const event of input.events) {
    let classified = classifyEvent(event);
    if (config.mode === 'replay') {
      const { createClassificationAssistant } = await import('../../src/storage/classification-assistant.ts');
      const assistant = createClassificationAssistant({
        apiKey: 'synthetic-offline-replay', model: config.model,
        loadLessons: async () => [],
        generateCompletion: async request => {
          prompts.push({ version: request.audit.promptVersion, systemPrompt: request.systemPrompt });
          if (!Object.hasOwn(config.responses, event.id)) throw new Error(`Missing replay for ${event.id}`);
          return config.responses[event.id];
        },
      });
      classified = await assistant({ event, base: classified });
    }
    const entities = buildEntityDrafts(classified);
    const candidate = buildFinancialTransactionCandidate({ event, classified, entityDrafts: entities });
    const relations = buildRelationDrafts({ ...classified, entities });
    observations.push({
      id: event.id, eventType: classified.inferredKind,
      amount: candidate?.amountDecimal ?? null, currency: candidate?.currency ?? null,
      merchant: candidate?.merchantLabel ?? null, category: candidate?.category ?? null,
      relationships: relations.map(relation => ({ type: relation.relationType,
        from: `${relation.sourceEntity.type}:${relation.sourceEntity.normalizedValue}`,
        to: `${relation.targetEntity.type}:${relation.targetEntity.normalizedValue}`,
      })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      // Candidate review reasons are measured; a missing financial projection is
      // unresolved evidence. This does not simulate the semantic governor/UI.
      reviewRequired: candidate ? candidate.reviewReasons.length > 0 :
        ['expense', 'income', 'transfer', 'other'].includes(classified.inferredKind),
      reviewReasons: candidate?.reviewReasons ?? [],
    });
  }
  return { observations, crossRelationships: [], prompts,
    usage: null, cost: null,
    limitations: ['Cross-capture consolidation and semantic-governor/UI review are not executed by this read-only domain adapter.'] };
}
