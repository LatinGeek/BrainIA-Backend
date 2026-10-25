// Deliberate test-only fault; never imported by the production application.
import { evaluate as current, classificationVersion } from './comparison-adapter.mjs';
export { classificationVersion };
export const revision = 'deliberate-amount-regression-1';
export async function evaluate(input, config) {
  const result = await current(input, config);
  for (const observation of result.observations) {
    if (observation.id === 'expense-uyu') observation.amount = '1.73';
  }
  return result;
}
