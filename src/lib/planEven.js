// Wochenplanung: per-task overrides of the capacity distribution ("Für diese Aufgabe gleichmäßig verteilen").
// Central (the whole team sees them), app storage key 'plan:even' = { [issueId]: { by, byName, at } }.
//
// Wiring (src/index.js):
//   import { getEven, setEven } from './lib/planEven.js';
//   def('plan.even', async ({ payload, ctx, roles }) => setEven(payload, { ...(await withName(ctx)), roles }));  // a WRITE
// Dataset (src/lib/dataset.js buildDataset):
//   ds.planEven = await getEven().catch(() => ({}));
// Payload: { even: [issueId], auto: [issueId] } – even = keep the even share, auto = back to the capacity split.
// Result:  { even: map, changed: { even: n, auto: n } }
import { get, set, audit as storeAudit } from './store.js';
import { AccessError } from './perms.js';
import { canPlan, validateEvenPayload } from '../../shared/weekPlan.js';

export const EVEN_KEY = 'plan:even';
export const EVEN_MAX_TOTAL = 5000;
const D = (deps = {}) => ({ get: deps.get || get, set: deps.set || set, audit: deps.audit || storeAudit, now: deps.now || (() => new Date()) });

export async function getEven(deps) {
  const v = await D(deps).get(EVEN_KEY);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export async function setEven(payload, ctx = {}, deps) {
  const d = D(deps);
  if (!ctx?.accountId) throw new AccessError('ANONYMOUS');
  if (!canPlan(ctx.roles)) throw new AccessError('NO_ACCESS:planWeeks');
  let parsed;
  try { parsed = validateEvenPayload(payload); } catch (e) { e.code = 'INVALID'; throw e; }
  const { even, auto } = parsed;
  const cur = { ...(await getEven(deps)) };
  const at = d.now().toISOString();
  for (const id of auto) delete cur[id];
  for (const id of even) cur[id] = { by: ctx.accountId, byName: ctx.displayName || null, at };
  // keep the store bounded: the oldest overrides go first
  const ids = Object.keys(cur);
  if (ids.length > EVEN_MAX_TOTAL) for (const id of ids.sort((a, b) => String(cur[a].at).localeCompare(String(cur[b].at))).slice(0, ids.length - EVEN_MAX_TOTAL)) delete cur[id];
  await d.set(EVEN_KEY, cur);
  await d.audit(ctx, 'plan.distribution', { even, auto }).catch(() => {});
  return { even: cur, changed: { even: even.length, auto: auto.length } };
}
