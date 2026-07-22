import { pool } from "../storage/postgres.js";
import { findCanonicalMerchantByValue } from "../storage/entity-repository.js";

async function main() {
  const transactions = await pool.query<{ id: string; merchantLabel: string; merchantEntityId: string | null }>(`
    select t.id, t.merchant_label as "merchantLabel", t.merchant_entity_id as "merchantEntityId"
    from financial_transactions t
    left join entities merchant on merchant.id = t.merchant_entity_id
    where t.kind <> 'transfer'
      and (t.merchant_entity_id is null or merchant.type <> 'merchant')
    order by observed_at asc
  `);

  let linked = 0;
  for (const transaction of transactions.rows) {
    const merchant = await findCanonicalMerchantByValue(pool, transaction.merchantLabel);
    if (!merchant) {
      await pool.query(`update financial_transactions set merchant_entity_id = null, updated_at = now() where id = $1`, [transaction.id]);
      continue;
    }
    await pool.query(
      `update financial_transactions set merchant_entity_id = $2, updated_at = now() where id = $1`,
      [transaction.id, merchant.id],
    );
    linked += 1;
  }

  console.log(JSON.stringify({ inspected: transactions.rows.length, linked }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
