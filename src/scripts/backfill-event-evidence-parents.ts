import { rootEventEvidenceFromAnchors } from "../storage/semantic-repository.js";
import { pool } from "../storage/postgres.js";

// Historical event instances predate the invariant that evidence always sits
// directly beneath the primary canonical meaning selected for its event. This
// also replaces obsolete hierarchy links, rather than merely filling blanks.
const reparented = await rootEventEvidenceFromAnchors(pool);

console.log(JSON.stringify({ reparented }));
await pool.end();
