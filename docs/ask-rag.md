# Ask: retrieval-augmented answers for Explorar

`POST /api/v1/ask` answers questions about the owner's own data. Accuracy is the
design goal: numbers come from SQL, the model only phrases them, and every
answer is checked against its evidence before the app marks it as verified.

## Pipeline

1. **Plan** (`src/domain/ask.ts`, `src/storage/ask.ts`). One fast DeepSeek JSON
   call (`ask_plan`, no evidence sent) rewrites follow-ups into a standalone
   question and extracts intent, period, categories, merchants, accounts and
   search phrasings. The plan is sanitised: categories/accounts must exist,
   dates must parse and are clamped to today. A recognised Spanish time
   expression ("el mes pasado", "marzo del año pasado", "últimos 15 días") is
   resolved deterministically in the user's time zone and overrides the
   model's dates. Without a model, a heuristic planner produces the same shape.
   Finance totals without a stated period use "últimos 90 días", and the answer
   is told the window was assumed.
2. **Retrieve** (`src/storage/ask-retrieval.ts`), in one owner-scoped read
   transaction:
   - *Finance*: totals, breakdowns (category, merchant, account, month, week,
     day) and movement lists via SQL over canonical `financial_transactions`,
     using `REPORTABLE_TRANSACTION_FILTERS` and `summaryScopeFilters` shared
     with the Money summary. Currencies are never mixed; comparisons use the
     previous equivalent window; rows excluded for unconfirmed amount/currency
     are counted and disclosed.
   - *Knowledge*: prefix/accent-tolerant full-text OR query over events
     (raw and interpreted text) and entities/aliases, plus exact cosine KNN
     over `knowledge_embeddings` computed inside Postgres, fused with
     reciprocal rank fusion. Events are hydrated with their linked movement and
     mentioned entities; a purchase seen as notification + email is kept once.
3. **Pack**: calculations first, then movements, records, elements; at most
   16 sources / 14k characters, numbered `S1..Sn`.
4. **Authorize**: evidence from sources whose policy denies LLM egress is
   excluded *before* retrieval results are built, so one private source never
   blocks the whole answer; `authorizeModelDispatch(ask_answer)` then gates the
   dispatch and redaction applies to every non-system message.
5. **Answer**: streamed DeepSeek completion with a prompt that requires citing
   `[S#]`, copying figures from calculation sources, stating the period and
   coverage, and refusing to speculate.
6. **Validate**: citations to missing sources are removed; every material
   figure (amounts, percentages; not days, small counts or years) must appear in
   the evidence, otherwise `grounding.status = "unverified"` and the app shows a
   warning.

## Embeddings

`OPENAI_EMBEDDING_API_KEY` alone enables `text-embedding-3-small` at 512
dimensions; `EMBEDDING_API_URL/KEY/MODEL/DIMENSIONS` override it for another
OpenAI-compatible provider. Without a key the local lexical hash vector is
used. Query and stored vectors are only compared when produced by the same
model, version and dimensions. Event text embedded is contextual: date, source,
kind, linked movement in Spanish (amount, merchant, category), interpretation,
then raw text capped at 1.8k characters. Unchanged text already embedded by the
current model is skipped.

After enabling the key, backfill once:

```bash
npm run backfill:embeddings            # dry run: counts candidates
npm run backfill:embeddings -- --apply # embeds events and their entities
```

(The `dev` and `backfill:embeddings` scripts load `.env.local` themselves, so
the key only has to live in that file. A dry run prints the resolved model under
`externalProvider`; `null` there means the key was not read and the backfill
would quietly write local hash vectors instead.)

Similarity is an exact scan of the owner's rows (no vector extension, which the
fail-closed schema contract would flag). That is fast for one person's data; if
an owner grows beyond ~100k vectors, move to pgvector with an HNSW index via a
reviewed migration and contract update.

## Known limits

- Conversations are held by the client; the server stores no chat history.
- Long emails are truncated rather than chunked.
- Planner output for brand-new merchant names relies on substring matching of
  merchant labels, entity values and aliases.

## Tests

`tests/ask-domain.test.ts` (dates, plan sanitisation, fusion, grounding,
citations) and `tests/ask.test.ts` (PGlite: totals equal the Money summary,
breakdown/comparison, privacy exclusion, owner isolation, dedupe, streamed
model path with a stubbed provider, NDJSON route).
