// Golden set runner: asks Lotse every golden question (follow-ups with the memory of the questions before) and scores
// routing (skill), parameters and key facts against the independently computed expectations (expect.js).
import { ask, remember, storyFacts } from '../../shared/lotse/index.js';
import { goldenEnv } from './expect.js';
import { goldenQuestions } from './questions.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const accepted = (e) => (Array.isArray(e.skill) ? e.skill : [e.skill]);
const primary = (e) => (Array.isArray(e.skill) ? e.skill[0] : e.skill) ?? '(unknown)';
const fold = (s) => String(s || '').toLowerCase();

function storyText(s) {
  const parts = [s.headline, ...(s.findings || []).map((f) => `${f.text} ${(f.evidence || []).map((e) => `${e.label || ''} ${e.text || ''}`).join(' ')}`), ...(s.kpis || []).map((k) => k.label)];
  const v = s.visual?.data || {};
  for (const x of [...(v.items || []), ...(v.rows || []), ...(v.series || [])]) parts.push(x.label || x.name || '');
  if (v.a?.label) parts.push(v.a.label, v.b?.label);
  for (const list of Object.values(s.entities || {})) for (const x of list || []) parts.push(typeof x === 'string' ? x : x.name || '');
  return fold(parts.join(' | '));
}
function storyNumbers(s) {
  const out = storyFacts(s).numbers.map((x) => Math.abs(x.value));
  // compare visuals (what-if, compare): both sides of every row
  for (const r of s.visual?.data?.rows || []) for (const k of ['a', 'b']) if (Number.isFinite(r[k])) out.push(Math.abs(r[k]));
  return out;
}
export function checkFact(f, story) {
  if (f.names) { const t = storyText(story); const miss = f.names.filter((n) => !t.includes(fold(n))); return { ok: !miss.length, why: miss.length ? `fehlt: ${miss.join(', ')}` : '' }; }
  const want = Math.abs(f.num);
  const tol = f.tol ?? 0.5;
  const nums = storyNumbers(story);
  const ok = nums.some((x) => Math.abs(x - want) <= tol + 1e-9);
  return { ok, why: ok ? '' : `erwartet ${Math.round(want * 10) / 10}, Story hat [${[...new Set(nums.map((x) => Math.round(x * 10) / 10))].slice(0, 14).join(', ')}]` };
}

// ctxDe: lotseCtx('de') (or a big dataset context); the English context is the same with lang 'en'.
export function runGolden(ctxDe) {
  const ctx = { de: ctxDe, en: { ...ctxDe, lang: 'en' } };
  const E = goldenEnv(ctxDe);
  const entries = goldenQuestions(E);
  const rows = [];
  for (const e of entries) {
    const c = ctx[e.lang];
    let memory = {};
    for (const p of e.prev || []) memory = remember(ask(p, c, memory));
    const t0 = performance.now();
    const s = ask(e.q, c, memory);
    const ms = performance.now() - t0;
    const got = s.understood?.skill ?? null;
    const routeOk = accepted(e).includes(got);
    const params = s.understood?.params || {};
    const paramsOk = routeOk && Object.entries(e.params || {}).every(([k, v]) => same(params[k], v));
    const facts = Array.isArray(e.facts) ? e.facts : e.facts?.[got] || [];
    const factRes = routeOk ? facts.map((f) => ({ label: f.label, ...checkFact(f, s) })) : facts.map((f) => ({ label: f.label, ok: false, why: 'falsch zugeordnet' }));
    rows.push({ ...e, got, gotParams: params, routeOk, paramsOk, factRes, ms, headline: s.headline });
  }
  return { E, rows, metrics: goldenMetrics(rows) };
}

export function goldenMetrics(rows) {
  const r = (a, b) => (b ? a / b : 1);
  const inDomain = rows.filter((x) => x.skill !== null && x.skill !== 'guard');
  const routed = rows.filter((x) => x.routeOk);
  const facts = rows.flatMap((x) => x.factRes);
  const factsRouted = routed.flatMap((x) => x.factRes);
  const withParams = routed.filter((x) => x.params && Object.keys(x.params).length);
  const confusion = {};
  for (const x of rows) { const a = primary(x), g = x.routeOk ? a : x.got ?? '(unknown)'; ((confusion[a] ||= {})[g] = (confusion[a][g] || 0) + 1); }
  const by = (key) => Object.fromEntries([...new Set(rows.map((x) => x[key]))].map((k) => { const xs = rows.filter((x) => x[key] === k); return [k, { n: xs.length, routing: r(xs.filter((x) => x.routeOk).length, xs.length) }]; }));
  const tagged = (t) => { const xs = rows.filter((x) => (x.tags || []).includes(t)); return { n: xs.length, routing: r(xs.filter((x) => x.routeOk).length, xs.length) }; };
  const ms = rows.map((x) => x.ms).sort((a, b) => a - b);
  return {
    n: rows.length, de: rows.filter((x) => x.lang === 'de').length, en: rows.filter((x) => x.lang === 'en').length,
    routing: r(routed.length, rows.length),
    params: r(withParams.filter((x) => x.paramsOk).length, withParams.length),
    facts: { checked: facts.length, ok: facts.filter((f) => f.ok).length, accuracy: r(facts.filter((f) => f.ok).length, facts.length), routedAccuracy: r(factsRouted.filter((f) => f.ok).length, factsRouted.length) },
    unknownRate: r(inDomain.filter((x) => x.got === null).length, inDomain.length),
    falseUnknown: inDomain.filter((x) => x.got === null).map((x) => x.q),
    confusion, byPersona: by('persona'), byLang: by('lang'),
    tags: { followup: tagged('followup'), typo: tagged('typo'), whatif: tagged('whatif'), synonym: tagged('synonym') },
    latency: { p50: ms[Math.floor(ms.length * 0.5)] || 0, p95: ms[Math.floor(ms.length * 0.95)] || 0, max: ms[ms.length - 1] || 0 },
  };
}

// A readable report (printed by the test, so the numbers can be raised over time).
export function goldenReport({ rows, metrics: m }) {
  const pct = (x) => `${(x * 100).toFixed(1)} %`;
  const L = [];
  L.push(`Lotse golden set: ${m.n} questions (${m.de} DE / ${m.en} EN)`);
  L.push(`  routing accuracy ${pct(m.routing)} · parameter accuracy ${pct(m.params)} · fact accuracy ${pct(m.facts.accuracy)} (${m.facts.ok}/${m.facts.checked}; on correctly routed ${pct(m.facts.routedAccuracy)}) · unknown rate ${pct(m.unknownRate)}`);
  L.push(`  latency per ask p50 ${m.latency.p50.toFixed(1)} ms · p95 ${m.latency.p95.toFixed(1)} ms · max ${m.latency.max.toFixed(1)} ms`);
  L.push(`  by persona: ${Object.entries(m.byPersona).map(([k, v]) => `${k} ${pct(v.routing)} (${v.n})`).join(' · ')}`);
  L.push(`  by tag: ${Object.entries(m.tags).map(([k, v]) => `${k} ${pct(v.routing)} (${v.n})`).join(' · ')}`);
  L.push('  confusion (expected → got: count):');
  for (const [a, g] of Object.entries(m.confusion).sort()) {
    const tot = Object.values(g).reduce((s, x) => s + x, 0);
    L.push(`    ${a.padEnd(18)} ${String(g[a] || 0).padStart(3)}/${String(tot).padEnd(3)} ${Object.entries(g).filter(([k]) => k !== a).map(([k, v]) => `→ ${k} ${v}`).join(', ')}`);
  }
  const misses = rows.filter((x) => !x.routeOk);
  if (misses.length) { L.push(`  routing misses (${misses.length}):`); for (const x of misses) L.push(`    [${x.id}] ${x.q}  expected ${[].concat(x.skill).join('|')} got ${x.got}`); }
  const pm = rows.filter((x) => x.routeOk && !x.paramsOk);
  if (pm.length) { L.push(`  parameter misses (${pm.length}):`); for (const x of pm) L.push(`    [${x.id}] ${x.q}  expected ${JSON.stringify(x.params)} got ${JSON.stringify(x.gotParams)}`); }
  const fm = rows.filter((x) => x.routeOk).flatMap((x) => x.factRes.filter((f) => !f.ok).map((f) => `    [${x.id}] ${x.q} – ${f.label}: ${f.why}`));
  if (fm.length) { L.push(`  fact misses (${fm.length}):`); L.push(...fm); }
  return L.join('\n');
}

// Jobs → workflows (understand only: a workflow is started, never applied, by the golden test).
export function runJobs(ctxDe, understand, goldenJobs) {
  const ctx = { de: ctxDe, en: { ...ctxDe, lang: 'en' } };
  const rows = goldenJobs(goldenEnv(ctxDe)).map((e) => {
    const u = understand(e.q, ctx[e.lang], {});
    const got = u.kind === 'workflow' ? u.workflow : u.skill ? `skill:${u.skill}` : null;
    const ok = got === e.workflow;
    return { ...e, got, ok, paramsOk: ok && Object.entries(e.params).every(([k, v]) => same(u.params?.[k], v)) };
  });
  const r = (a, b) => (b ? a / b : 1);
  return { rows, routing: r(rows.filter((x) => x.ok).length, rows.length), params: r(rows.filter((x) => x.paramsOk).length, rows.filter((x) => x.ok).length) };
}
