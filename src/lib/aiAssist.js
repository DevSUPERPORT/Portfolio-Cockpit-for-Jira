// KI-Assistent (server): one entry point for every assisted feature – Wochenplanung, Fehlende Werte, Support-Verteilen,
// Plan vs. Ist, Team- und Projekt-Lagebild, Meine Arbeit. The pure part (facts, prompts, validation, fallback)
// lives in shared/aiAssist.js; this module adds the gates around it:
//
//   1. the switch: AI on AND this feature on (config.ai, aiAllowed) – checked first, before anything is read,
//      counted or sent; and again inside llm() right before Forge LLM is touched;
//   2. payload shape (cheap) → daily quota per person (takeQuota);
//   3. data minimisation per the admin's choices (sharing(cfg)): handles instead of people, no texts unless allowed;
//      briefings are built from the caller's own dataset (built as the user, within the role's privacy scope);
//   4. strict validation of the answer; an invalid or missing answer falls back to the cockpit's own rules;
//   5. one audit entry per call (feature, source, counts – never prompt contents).
//
// Nothing here writes to Jira: every suggestion is applied by the user through the existing write paths
// (plan.apply via pending moves, issue.fill, support.dispatch, mine.book), each with its own undo entry.
//
// Resolver (src/index.js):  def('ai.assist', async ({ payload, ctx, cfg, roles }) => {
//   requireAi(cfg, payload.feature); …  assist(payload.feature, payload, { ...ctx, cfg, roles, loadDs }) })
// Classification: READ (it reads and suggests; it changes nothing).
import { llm as llmReal, takeQuota as quotaReal, sharing, dropCached } from './ai.js';
import { audit as auditReal } from './store.js';
import { aiAllowed } from './config.js';
import { ASSIST_FEATURES, buildFacts, promptFor, parseJson, validateOutput, fallbackFor, finish, invalid } from '../../shared/aiAssist.js';

const MAX_PAYLOAD = 150_000; // characters of JSON – a week, a board or a handful of tickets fit easily
const disabled = () => Object.assign(new Error('AI_DISABLED'), { code: 'AI_DISABLED' });
const NEEDS_DATASET = new Set(['teamBrief', 'projectBrief']);

function precheck(feature, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('payload');
  let size = 0;
  try { size = JSON.stringify(payload).length; } catch { throw invalid('payload'); }
  if (size > MAX_PAYLOAD) throw invalid('payload too large');
  if (feature === 'teamBrief' && !(typeof payload.teamId === 'string' && /^[A-Za-z0-9:_.-]{1,128}$/.test(payload.teamId))) throw invalid('teamId');
  if (feature === 'projectBrief' && !(typeof payload.ref === 'string' && /^(issue|space):[A-Za-z0-9_-]{1,40}$/.test(payload.ref))) throw invalid('ref');
  if (feature === 'gaps' && !payload.gap) throw invalid('gap');
  if (feature === 'intent' && !(typeof payload.wish === 'string' && payload.wish.trim().length >= 2 && payload.wish.length <= 300)) throw invalid('wish');
  if (feature === 'playbookDraft' && !(payload.topic && typeof payload.topic === 'object')) throw invalid('topic');
}
const countOf = (r) => r?.picks?.length ?? r?.items?.length ?? r?.comments?.length ?? (r?.suggestion || r?.card || r?.draft ? 1 : 0);

// ctx = { accountId, displayName?, cfg, roles, loadDs?() } – accountId, cfg and roles from the resolver wrapper, never
// from the payload. deps (tests): { llm, takeQuota, audit, loadDs, loadComments }.
// similarSummary: comment texts of the similar items are loaded here, as the user, and only when texts may be sent
// (cfg.ai.shareTexts) – ctx.loadComments(ids) comes from the resolver (src/lib/history.js loadComments).
export async function assist(feature, payload, ctx, deps = {}) {
  const cfg = ctx?.cfg;
  if (!ASSIST_FEATURES.includes(feature) || !aiAllowed(cfg, feature)) throw disabled(); // 1. the switch, first
  if (!ctx?.accountId) throw Object.assign(new Error('ANONYMOUS'), { code: 'FORBIDDEN' });
  const D = { llm: deps.llm || llmReal, takeQuota: deps.takeQuota || quotaReal, audit: deps.audit || auditReal, loadDs: deps.loadDs || ctx.loadDs, loadComments: deps.loadComments || ctx.loadComments };
  const lang = payload?.lang === 'en' ? 'en' : 'de';
  precheck(feature, payload); // 2.
  await D.takeQuota(ctx.accountId, cfg);
  const share = sharing(cfg); // 3.
  const ds = NEEDS_DATASET.has(feature) ? await D.loadDs() : null;
  const ids = feature === 'similarSummary' && share.texts ? (Array.isArray(payload.items) ? payload.items : []).map((x) => String(x?.id ?? '')).filter((x) => /^\d{1,18}$/.test(x)).slice(0, 20) : [];
  const comments = ids.length && D.loadComments ? await D.loadComments(ids).catch(() => null) : null;
  const built = buildFacts(feature, payload, { share, ds, comments });
  const { system, user } = promptFor(built, lang);
  const meta = {};
  let result, source = 'ai', reason = null;
  try {
    const text = await D.llm(system, user, { cfg, feature, meta, fresh: payload?.fresh === true });
    try { result = validateOutput(built, parseJson(text)); } // 4.
    catch (bad) { if (!deps.llm) await dropCached(meta); throw bad; } // a rejected answer is never served from the cache
  } catch (e) {
    if (e.code === 'AI_DISABLED') throw e;
    source = 'fallback'; reason = e.code || 'AI_UNAVAILABLE';
    result = fallbackFor(built, lang);
  }
  await D.audit(ctx, 'ai.assist', { feature, source, ...(reason ? { reason } : {}), items: countOf(result), names: share.names, texts: share.texts }); // 5.
  return finish(built, result, { source, ...(reason ? { reason } : {}), model: meta.model || null, lang, ...(meta.cached ? { cached: true } : {}) });
}
