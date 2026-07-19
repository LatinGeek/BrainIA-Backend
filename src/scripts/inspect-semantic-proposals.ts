import { classifyEvent } from "../domain/classification.js";
import { buildEntityDrafts } from "../domain/entities.js";
import { semanticInstanceDraft } from "../domain/ontology.js";
import { loadRawEventById } from "../storage/event-repository.js";
import { buildModelSemanticProposals } from "../storage/semantic-enrichment.js";
import { pool } from "../storage/postgres.js";

const eventId = process.argv[2];
if (!eventId) throw new Error("Usage: inspect-semantic-proposals <event-id>");
const event = await loadRawEventById(pool, eventId);
if (!event) throw new Error("Event not found");
const classified = classifyEvent(event);
const entities = buildEntityDrafts({ ...classified, raw: classified.raw });
entities.push(semanticInstanceDraft({ eventId: event.id, inferredKind: classified.inferredKind, source: event.source, title: event.title, body: event.body }));
const proposals = await buildModelSemanticProposals({ entities, source: event.source, inferredKind: classified.inferredKind, title: event.title, body: event.body, clientId: event.clientId });
console.log(JSON.stringify({ eventId, inferredKind: classified.inferredKind, entities: entities.map(({ type, value, normalizedValue }) => ({ type, value, normalizedValue })), proposals }, null, 2));
await pool.end();
