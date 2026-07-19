# Semantic graph governance v2

## Purpose

The graph stores durable knowledge about the user. Raw events remain immutable
evidence and are not converted into nodes merely because a field was present in
the payload.

## Event classification contract

Every event is evaluated against the controlled life-domain roots: Health,
Social, Finances, Work, Entrepreneurship, Psychology, Location, Home, Food,
Communication, Learning, and Entertainment.

The governor selects exactly one primary domain when the leading root has at
least 0.80 confidence and leads the runner-up by at least 0.10. It then descends
recursively through immediate children until it must reuse a child, stop at the
current node, propose a reusable child, merge an identity, discard a fragment,
or declare no relation. Maximum depth is eight.

After the primary path is selected, every other domain is evaluated
independently with the same descent rules. An event may have at most one anchor
per domain, and secondary anchors require 0.90 confidence to auto-apply. Only
the most-specific anchor is stored; ancestors are reached by traversal.

Anchor cardinality is separate from subject classification. Every durable
subject extracted from the event receives its own path, even when several
subjects share the same domain. One email can therefore place its message
under `Email`, the user's recipient address under `Email accounts`, and an
external sender under `Email contacts`, while keeping one Communication anchor.

Examples:

- `Home -> Home automation -> Xiaomi Home`
- `Communication -> Email -> email account/message`
- `Food -> Food / Delivery -> Orders -> PedidosYa`
- `Entertainment -> Music -> Spotify`

A PedidosYa purchase may be primarily anchored to Orders and secondarily to
Financial activity. It must not also be anchored to Food, Food / Delivery, or
Finances.

## Entity hierarchy contract

Every non-root durable entity has exactly one immediate hierarchy parent and a
traversable path to exactly one life domain. Hierarchy edges point child to
parent and use only `part_of` or `belongs_to_domain`.

Identity resolution and aliases happen before classification. A known alias is
resolved to its canonical entity. Ambiguous identity matches and merges require
review. Cycles, self-links, multiple parents, and direct ancestor shortcuts are
invalid.

Associations such as `spent_at`, `sent_by`, `uses_service`, `occurred_at`, or
`related_to` are evaluated after hierarchy and never count as parents. A
standard association between existing canonical entities may auto-apply at
0.90 confidence; unknown relation types or endpoints require review.

## Durable node creation

A proposed child must be independently meaningful, reusable across events,
concisely named, and assigned to one immediate parent. Amounts, timestamps,
identifiers, package names, generic notification titles, truncated text, and
raw payload fragments are evidence, not nodes.

Evidence uses associative relations such as `evidence_for` and
`produced_by_app`; it never uses hierarchy relations. A proposed concept that
only repeats an existing identity with a type suffix (for example `Xiaomi Home
app` for the `Xiaomi Home` app) is rejected in favor of using the identity as
the durable leaf.

A new node becomes durable only after explicit approval or after two
independent events propose the same normalized child under the same parent,
each at 0.85 confidence and with aggregate confidence of at least 0.90. Until
then it remains a reviewable observation.

## LLM output and enforcement

The model returns structured decisions containing the subject, action, role,
domain, complete path, per-level trace, confidence, rationale, proposed child,
and typed associations. The backend validates every domain, path transition,
target, confidence threshold, and cardinality rule against the live graph. The
model cannot write nodes or relations directly.

Existing-parent paths with every step at 0.90 confidence may auto-apply. New
children, merges, parent changes, destructive discards, conflicts, and lower
confidence paths enter Review with their complete path and evidence.

## Unified processing

Live ingestion, manual event reprocessing, semantic backfill, and reconciliation
must call the same resolver. Reprocessing is idempotent for decisions,
observations, candidates, event anchors, and relations. Each persisted decision
records governance version `semantic-governance-v2`, prompt version, model,
evidence event, and the validated model response.

## Reconciliation and acceptance

Historical reconciliation resolves aliases, reclassifies durable entities,
removes redundant ancestor anchors, and queues uncertain parent changes or
merges. Raw events and financial provenance are always preserved.

The graph is healthy when it has zero hierarchy cycles, zero non-root durable
orphans, zero multiple-parent entities, zero ancestor shortcuts, and no event
with more than one anchor in the same domain.
