// Lotse chains in the thread ("Mehrstufiger Auftrag"): the plan as a graph the person edits before anything runs
// (remove, reorder, change a parameter by preset or free text, rephrase the request), the AI's proposal next to Lotse's
// own with the differences (only while AI is on for Lotse), the live graph of the run (planned → running → waiting →
// done / skipped / failed), the set tables, the checkpoint after a write, the note with the AI's checked draft, and the
// result with every artifact. Nothing here writes: answers go to the engine, writes only through the previews.
// Motion: transform / opacity only, enter animations only (no exit animations – they stall in the Jira frame).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { enter, press, tween } from '../../lib/motion.js';
import { useApp, errText } from '../../state.jsx';
import { call } from '../../lib/api.js';
import { tr, fmt, getLang } from '../../lib/i18n.js';
import { Icon } from '../../lib/icons.jsx';
import { aiOn } from '../../lib/aiFlags.js';
import { track } from '../../lib/usage.js';
import { planChain, planProblems, comparePlans, chainOutline, chainSections, splitClauses } from '@shared/lotse/act/index.js';
import { toolOf, outEntity } from '@shared/lotse/act/tools.js';
import { formatQuery, parseQuerySyntax, memberText, METRICS } from '@shared/lotse/act/query.js';
import { buildChainDoc } from '@shared/lotse/act/chain/docs.js';
import { BLOCK_NAMES, BLOCKS_FOR } from '@shared/lotse/act/orchestrate/parse.js';
import { JobResult } from './JobCards.jsx';
import { useTakeFocus } from './ActCards.jsx';
import './chain.css';

const L2 = (p) => (Array.isArray(p) ? tr(p[0], p[1]) : p);
const STATUS = { planned: ['Geplant', 'Planned'], running: ['Läuft', 'Running'], waiting: ['Wartet auf dich', 'Waiting for you'], done: ['Fertig', 'Done'], skipped: ['Übersprungen', 'Skipped'], failed: ['Fehler', 'Failed'] };
const STATUS_ICON = { planned: 'clock', running: 'refresh', waiting: 'target', done: 'check', skipped: 'x', failed: 'alert' };
const OUT_NAME = { 'set:people': ['Menge: Personen', 'Set: people'], 'set:projects': ['Menge: Projekte', 'Set: projects'], 'set:teams': ['Menge: Teams', 'Set: teams'], 'set:stories': ['Menge: Stories', 'Set: stories'], 'set:tickets': ['Menge: Tickets', 'Set: tickets'], set: ['Menge', 'Set'], story: ['Lagebild', 'Story'], doc: ['Dokument', 'Document'], write: ['Änderungen', 'Changes'], view: ['Ansicht', 'View'] };
const VALUE_NAMES = {
  due: ['Fälliges zuerst', 'Due first'], rank: ['Nach Rang', 'By rank'], pdfAll: ['Ein PDF', 'One PDF'], pdfEach: ['PDF je Empfänger', 'PDF per recipient'], text: ['Nur Text', 'Text only'], pdf: ['PDF', 'PDF'],
  colleagues: ['Kolleg:innen', 'Colleagues'], management: ['Management', 'Management'], teamLeads: ['Teamleitungen', 'Team leads'], owners: ['Projekt-Owner', 'Project owners'], board: ['Geschäftsführung', 'Board'],
  friendly: ['Persönlich', 'Friendly'], formal: ['Sachlich', 'Formal'], booking: ['Fehlende Buchungen', 'Missing bookings'], gaps: ['Fehlende Werte', 'Missing values'],
  currentQuarter: ['Laufendes Quartal', 'Current quarter'], nextQuarter: ['Nächstes Quartal', 'Next quarter'], last4Weeks: ['Letzte 4 Wochen', 'Last 4 weeks'],
};
const valueName = (v) => (VALUE_NAMES[v] ? L2(VALUE_NAMES[v]) : String(v));

// ---------- plan helpers (pure) ----------
// ids s1…sN in order; inputs follow their step; a required input that lost its step binds to the nearest earlier set
export function renumber(steps) {
  const map = new Map(steps.map((s, i) => [s.id, `s${i + 1}`]));
  const out = steps.map((s, i) => ({ ...s, id: `s${i + 1}`, input: s.input && map.has(s.input) && +map.get(s.input).slice(1) < i + 1 ? map.get(s.input) : null }));
  out.forEach((s, i) => {
    const t = toolOf(s.tool);
    if (!t?.input?.required || s.input) return;
    for (let j = i - 1; j >= 0; j--) {
      const e = outEntity(toolOf(out[j].tool), out[j].params) || (out[j].tool === 'plan.balance' ? 'people' : null);
      if (e && t.input.accepts.includes(e)) { s.input = out[j].id; break; }
    }
  });
  return out;
}
const problemsBy = (plan, ctx) => { const by = {}; for (const p of planProblems(plan, ctx)) (by[p.step || 'plan'] ||= []).push(p); return by; };
function entitiesIn(text, ctx) {
  const q = String(text || '').toLowerCase();
  const people = Object.values(ctx?.ds?.people || {}).filter((p) => p?.name && (q.includes(p.name.toLowerCase()) || (p.name.split(' ')[0].length >= 3 && new RegExp(`\\b${p.name.split(' ')[0].toLowerCase()}\\b`).test(q)))).map((p) => p.name).slice(0, 20);
  const projects = (ctx?.computed?.model?.items || []).filter((it) => it.name && q.includes(it.name.toLowerCase())).map((it) => ({ name: it.name, rank: it.rank, key: it.key })).slice(0, 20);
  return { people, projects };
}

// ---------- one parameter ----------
function ParamField({ name, spec, value, onChange, ctx, id }) {
  const label = L2(spec.label);
  const model = ctx?.computed?.model;
  const [qtext, setQtext] = useState(() => (spec.type === 'query' && value ? formatQuery(value) : ''));
  const [qerr, setQerr] = useState(false);
  let field = null;
  if (spec.type === 'enum') field = <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>{!spec.required && <option value="">{tr('Standard', 'Default')}{spec.default ? ` (${valueName(spec.default)})` : ''}</option>}{spec.values.map((v) => <option key={v} value={v}>{valueName(v)}</option>)}</select>;
  else if (spec.type === 'weeks') field = <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value ? +e.target.value : undefined)}><option value="">{tr('Standard', 'Default')}{spec.default ? ` (${spec.default})` : ''}</option>{[1, 2, 3, 4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{tr(`${n} ${n === 1 ? 'Woche' : 'Wochen'}`, `${n} ${n === 1 ? 'week' : 'weeks'}`)}</option>)}</select>;
  else if (spec.type === 'percent' || spec.type === 'number') field = <input id={id} type="number" inputMode="decimal" min={spec.min} max={spec.max} value={value ?? ''} placeholder={spec.default != null ? String(spec.default) : ''} onChange={(e) => onChange(e.target.value === '' ? undefined : +e.target.value)} />;
  else if (spec.type === 'flag') field = <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  else if (spec.type === 'project') field = <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}><option value="">–</option>{(model?.items || []).map((it) => <option key={it.ref} value={it.ref}>{`#${it.rank} ${it.name}`}</option>)}</select>;
  else if (spec.type === 'team') field = <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}><option value="">–</option>{[...(model?.teams?.values?.() || [])].map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>;
  else if (spec.type === 'person') field = <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}><option value="">–</option>{Object.values(ctx?.ds?.people || {}).filter((p) => p?.name).sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>;
  else if (spec.type === 'quarter') field = <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}><option value="">{tr('Laufendes', 'Current')}</option>{(ctx?.computed?.wl?.quarters || []).map((q) => <option key={q} value={q}>{fmt.quarter ? fmt.quarter(q) : q}</option>)}</select>;
  else if (spec.type === 'blocks') {
    const all = spec.values || [];
    const cur = new Set(value || []);
    field = <span className="lc-blocks" role="group" aria-label={label}>{all.map((b) => <label key={b} className={`lc-blk ${cur.has(b) ? 'on' : ''}`}><input type="checkbox" checked={cur.has(b)} onChange={() => { const n = new Set(cur); if (n.has(b)) n.delete(b); else n.add(b); onChange(n.size ? [...n] : undefined); }} />{L2(BLOCK_NAMES[b] || [b, b])}</label>)}</span>;
  } else if (spec.type === 'query') {
    field = <input id={id} value={qtext} aria-invalid={qerr} onChange={(e) => { setQtext(e.target.value); setQerr(false); }} onBlur={() => { const q = parseQuerySyntax(qtext, ctx); if (q) onChange(q); else setQerr(true); }} placeholder="people where load > 100 next 4w" className="mono" />;
  } else if (spec.type === 'text') field = <input id={id} value={value ?? ''} maxLength={spec.max || 200} onChange={(e) => onChange(e.target.value || undefined)} />;
  else return null;
  return (
    <div className={`lc-field ${spec.type === 'blocks' ? 'wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {field}
      {qerr && <span className="lx-err lx-small" role="alert">{tr('So versteht Lotse die Abfrage nicht – z. B. „people where load > 100 next 4w“.', 'Lotse does not understand this query – e.g. "people where load > 100 next 4w".')}</span>}
    </div>
  );
}

// ---------- the plan as a graph (editable before the run; live during it) ----------
function NodeRow({ o, i, n, status, problems, editable, onUp, onDown, onRemove, onEdit, editing, children }) {
  return (
    <motion.li className={`lc-node st-${status || 'planned'} ${problems?.length ? 'has-err' : ''}`} {...enter(i, { y: 6 })} data-step={o.id} data-tool={o.tool}>
      <span className="lc-rail" aria-hidden="true"><span className="lc-n"><Icon name={status && status !== 'planned' ? STATUS_ICON[status] : o.icon} size={13} className={status === 'running' ? 'lx-spin' : ''} /></span>{i < n - 1 && <span className="lc-line" />}</span>
      <div className="lc-body">
        <div className="lc-top">
          <span className="lc-step faint">{tr(`Schritt ${i + 1}`, `Step ${i + 1}`)}</span>
          {status && <span className={`lc-status st-${status}`}>{L2(STATUS[status])}</span>}
          {o.write && <span className="lc-tag write" title={tr('Ändert Daten – erst nach deiner Vorschau', 'Changes data – only after your preview')}><Icon name="edit" size={11} />{tr('schreibt, mit Vorschau', 'writes, with preview')}</span>}
          {o.irreversible && <span className="lc-tag bad"><Icon name="send" size={11} />{tr('nur mit deiner Wahl', 'only if you choose')}</span>}
          {!o.rightOk && <span className="lc-tag bad"><Icon name="lock" size={11} />{tr('Recht fehlt', 'No right')}</span>}
        </div>
        <b className="lc-title">{L2(o.title)}</b>
        {(o.detail || o.input) && <span className="lc-detail">{o.input ? <span className="lc-flow"><Icon name="arrowRight" size={11} />{tr(`mit dem Ergebnis von Schritt ${o.input.slice(1)}`, `with the result of step ${o.input.slice(1)}`)}</span> : null}{o.detail ? <span>{o.detail}</span> : null}</span>}
        {o.out && <span className="lc-out faint">{L2(OUT_NAME[o.out] || OUT_NAME.view)}</span>}
        {problems?.length > 0 && <span className="lx-err lx-small" role="alert">{problems.map((p) => p.message).join(' · ')}</span>}
        {editing && children}
      </div>
      {editable && (
        <span className="lc-tools">
          <button type="button" className="btn btn-ghost btn-icon btn-xs" onClick={onEdit} aria-expanded={!!editing} aria-label={tr(`Schritt ${i + 1} anpassen`, `Adjust step ${i + 1}`)}><Icon name="settings" size={13} /></button>
          <button type="button" className="btn btn-ghost btn-icon btn-xs" onClick={onUp} disabled={i === 0} aria-label={tr(`Schritt ${i + 1} nach oben`, `Move step ${i + 1} up`)}><Icon name="up" size={13} /></button>
          <button type="button" className="btn btn-ghost btn-icon btn-xs" onClick={onDown} disabled={i === n - 1} aria-label={tr(`Schritt ${i + 1} nach unten`, `Move step ${i + 1} down`)}><Icon name="down" size={13} /></button>
          <button type="button" className="btn btn-ghost btn-icon btn-xs" onClick={onRemove} aria-label={tr(`Schritt ${i + 1} entfernen`, `Remove step ${i + 1}`)}><Icon name="trash" size={13} /></button>
        </span>
      )}
    </motion.li>
  );
}
function PlanList({ plan, ctx, compact = false, diff = null }) {
  const outline = useMemo(() => chainOutline(plan, ctx), [plan, ctx]);
  return (
    <ol className={`lc-graph ${compact ? 'compact' : ''}`}>
      {outline.map((o, i) => (
        <li key={o.id} className={`lc-mini ${diff?.has(i) ? 'diff' : ''}`}><span className="lc-mini-n"><Icon name={o.icon} size={12} /></span><span className="grow"><b>{L2(o.title)}</b>{o.detail && <span className="faint"> · {o.detail}</span>}{o.input && <span className="faint"> · {tr(`aus Schritt ${o.input.slice(1)}`, `from step ${o.input.slice(1)}`)}</span>}</span>{o.write && <Icon name="edit" size={11} />}</li>
      ))}
    </ol>
  );
}

// the AI's proposal (only while AI is on for Lotse): the request + the catalogue's schema go out, a JSON plan comes back,
// Lotse checks it against the data and shows both – the person chooses
function useAiPlan(text, ctx, enabled, auto) {
  const [st, setSt] = useState({ phase: 'idle' });
  const asked = useRef(false);
  const ask = async (fresh = false) => {
    if (!enabled || !text) return;
    setSt({ phase: 'loading' });
    try {
      const r = await call('lotse.llm', { mode: 'plan', text, lang: getLang(), entities: entitiesIn(text, ctx), ...(fresh ? { fresh: true } : {}) });
      track('ai:lotse');
      if (r?.source !== 'ai' || !r.plan) { setSt({ phase: 'fallback', reason: r?.reason || 'AI_UNAVAILABLE' }); return; }
      // Lotse's own strict check: unknown tools / params and wrong bindings are dropped and named
      const steps = renumber(r.plan.steps.map((s, i) => ({ id: `s${i + 1}`, ...s })));
      const by = problemsBy({ steps }, ctx);
      const good = renumber(steps.filter((s) => !by[s.id]));
      const dropped = steps.filter((s) => by[s.id]).map((s) => ({ tool: s.tool, why: by[s.id].map((p) => p.message).join(' · ') }));
      setSt({ phase: 'done', plan: { v: 1, text, steps: good, source: 'ai' }, dropped: [...dropped, ...(r.rejected || []).map((x) => ({ tool: x.tool, why: x.reason }))], note: r.plan.note || null, model: r.model || null });
    } catch (e) { setSt({ phase: 'error', e }); }
  };
  useEffect(() => { if (enabled && auto && !asked.current) { asked.current = true; ask(); } }, [enabled, auto]); // eslint-disable-line react-hooks/exhaustive-deps
  return [st, ask];
}
function diffText(d) {
  const t = (s) => L2(toolOf(s?.tool)?.title || ['?', '?']);
  if (d.kind === 'extra') return tr(`KI-Schritt ${d.at + 1}: nur bei der KI – ${t(d.b)}`, `AI step ${d.at + 1}: only in the AI's plan – ${t(d.b)}`);
  if (d.kind === 'missing') return tr(`Schritt ${d.at + 1}: nur bei Lotse – ${t(d.a)}`, `Step ${d.at + 1}: only in Lotse's plan – ${t(d.a)}`);
  if (d.kind === 'tool') return tr(`Schritt ${d.at + 1}: Lotse „${t(d.a)}“, KI „${t(d.b)}“`, `Step ${d.at + 1}: Lotse "${t(d.a)}", AI "${t(d.b)}"`);
  if (d.kind === 'params') return tr(`Schritt ${d.at + 1}: andere Einstellungen`, `Step ${d.at + 1}: different settings`);
  return tr(`Schritt ${d.at + 1}: arbeitet mit einem anderen Ergebnis`, `Step ${d.at + 1}: works on a different result`);
}

export function ChainPlanCard({ step, ctx, active, onAnswer, answered }) {
  const { config } = useApp();
  const lotse = step.chain?.lotse || { steps: [], unresolved: [] };
  const [draft, setDraft] = useState(() => ({ text: step.chain?.text || lotse.text || '', steps: lotse.steps, unresolved: lotse.unresolved || [], source: 'lotse' }));
  const [editing, setEditing] = useState(null);
  const [rephrase, setRephrase] = useState('');
  const [err, setErr] = useState(null);
  const root = useRef(null);
  const fid = useId();
  const ai = aiOn(config, 'lotse');
  const [aiSt, askAi] = useAiPlan(draft.text, ctx, ai && answered === undefined, !lotse.steps.length || (lotse.unresolved || []).length > 0);
  useTakeFocus(root, ['.lc-run:not(:disabled)'], active && answered === undefined, step.id);
  const plan = { v: 1, text: draft.text, steps: draft.steps };
  const by = useMemo(() => (ctx ? problemsBy(plan, ctx) : {}), [draft, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const outline = useMemo(() => (ctx ? chainOutline(plan, ctx) : []), [draft, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const lotseSteps = draft.source === 'ai' ? lotse.steps : draft.steps;
  const cmp = aiSt.phase === 'done' ? comparePlans({ steps: lotseSteps }, aiSt.plan) : null;
  if (answered !== undefined) {
    const n = answered?.plan?.steps?.length || 0;
    return (
      <div className="lx-answered" role="group" aria-label={step.question}>
        <span className="lx-answered-q">{tr('Plan', 'Plan')}</span>
        <span className="lx-answered-a"><Icon name="check" size={12} />{tr(`${n} ${n === 1 ? 'Schritt' : 'Schritte'} · ${answered?.source === 'ai' ? 'KI-Vorschlag, von Lotse geprüft' : answered?.source === 'edited' ? 'angepasst' : 'Lotse-Plan'}`, `${n} ${n === 1 ? 'step' : 'steps'} · ${answered?.source === 'ai' ? 'AI proposal, checked by Lotse' : answered?.source === 'edited' ? 'adjusted' : 'Lotse\'s plan'}`)}</span>
      </div>
    );
  }
  const change = (steps, source = 'edited') => { setDraft((d) => ({ ...d, steps: renumber(steps), source: d.source === 'ai' && source === 'edited' ? 'ai' : source })); setErr(null); };
  const move = (i, k) => { const s = [...draft.steps]; const [x] = s.splice(i, 1); s.splice(i + k, 0, x); change(s); setEditing(null); };
  const remove = (i) => { change(draft.steps.filter((_, j) => j !== i)); setEditing(null); };
  const setParam = (i, name, v) => change(draft.steps.map((s, j) => (j === i ? { ...s, params: Object.fromEntries(Object.entries({ ...s.params, [name]: v }).filter(([, x]) => x !== undefined)) } : s)));
  const replanText = (e) => { e.preventDefault(); const t = rephrase.trim(); if (t.length < 8 || !ctx) return; const p = planChain(t, ctx); setDraft({ text: t, steps: p.steps, unresolved: p.unresolved, source: 'lotse' }); setRephrase(''); setEditing(null); };
  const run = () => {
    if (!draft.steps.length) return;
    try { onAnswer({ option: 'run', plan: { ...plan, unresolved: draft.unresolved }, source: draft.source }); }
    catch (e) { setErr(e?.problems?.map((p) => `${p.step ? tr(`Schritt ${p.step.slice(1)}`, `Step ${p.step.slice(1)}`) + ': ' : ''}${p.message}`).join(' · ') || errText(e)); }
  };
  const hasErr = Object.keys(by).length > 0;
  return (
    <motion.section ref={root} className="lx-card is-act lc-card" aria-label={step.question} data-act="decide" data-chain-plan={draft.steps.length} {...enter(0, { y: 12, scale: 0.985, spring: 'card' })}>
      <span className="lx-kicker"><Icon name="route" size={12} />{tr('Plan · noch läuft nichts', 'Plan · nothing runs yet')}</span>
      <h3 className="lx-title">{draft.steps.length ? tr(`${draft.steps.length} ${draft.steps.length === 1 ? 'Schritt' : 'Schritte'} – prüfen, anpassen, ausführen.`, `${draft.steps.length} ${draft.steps.length === 1 ? 'step' : 'steps'} – check, adjust, run.`) : step.question}</h3>
      {draft.text !== (step.chain?.text || lotse.text || '') && <p className="ls-q">„{draft.text}“</p>}
      {draft.steps.length > 0 && (
        <ol className="lc-nodes" aria-label={tr('Die Schritte', 'The steps')}>
          {outline.map((o, i) => (
            <NodeRow key={`${o.id}:${o.tool}`} o={o} i={i} n={outline.length} problems={by[o.id]} editable editing={editing === i} onEdit={() => setEditing(editing === i ? null : i)} onUp={() => move(i, -1)} onDown={() => move(i, 1)} onRemove={() => remove(i)}>
              <div className="lc-params">
                {Object.entries(toolOf(draft.steps[i].tool)?.params || {}).filter(([, sp]) => sp.type !== 'args').map(([name, sp]) => {
                  const spec = sp.type === 'blocks' && draft.steps[i].input ? { ...sp, values: BLOCKS_FOR[(() => { const src = draft.steps.find((x) => x.id === draft.steps[i].input); const e = src ? outEntity(toolOf(src.tool), src.params) || (src.tool === 'plan.balance' ? 'people' : null) : null; return e === 'teams' ? 'teams' : e === 'projects' ? 'projects' : 'people'; })()] } : sp;
                  return <ParamField key={name} name={name} spec={spec} value={draft.steps[i].params?.[name]} onChange={(v) => setParam(i, name, v)} ctx={ctx} id={`${fid}-${i}-${name}`} />;
                })}
                {Object.values(toolOf(draft.steps[i].tool)?.params || {}).filter((sp) => sp.type !== 'args').length === 0 && <span className="faint lx-small">{tr('Dieser Schritt hat keine Einstellungen.', 'This step has no settings.')}</span>}
              </div>
            </NodeRow>
          ))}
        </ol>
      )}
      {draft.unresolved?.length > 0 && (
        <div className="lc-open" role="status">
          <Icon name="info" size={13} />
          <span>{tr('Nicht als Schritt verstanden:', 'Not understood as a step:')} {draft.unresolved.map((u) => `„${u.text}“`).join(', ')}{ai ? tr(' – die KI schlägt unten etwas vor.', ' – the AI suggests something below.') : tr(' – formuliere den Teil um oder lass ihn weg.', ' – rephrase that part or leave it out.')}</span>
        </div>
      )}
      {ai && (
        <div className="lc-ai" aria-live="polite">
          {aiSt.phase === 'idle' && <button type="button" className="lx-btn" onClick={() => askAi()} data-chain-ai><Icon name="sparkle" size={13} />{tr('KI-Vorschlag holen', 'Get the AI\'s proposal')}</button>}
          {aiSt.phase === 'loading' && <span className="faint lx-small"><Icon name="refresh" size={12} className="lx-spin" /> {tr('Die KI plant mit – Lotse prüft danach jeden Schritt …', 'The AI is planning too – Lotse checks every step afterwards …')}</span>}
          {(aiSt.phase === 'fallback' || aiSt.phase === 'error') && <span className="faint lx-small" role="status"><Icon name="info" size={12} /> {tr('KI gerade nicht verfügbar – Lotse plant allein.', 'AI not available right now – Lotse plans on its own.')}{aiSt.reason === 'AI_QUOTA' ? tr(' (Tageslimit erreicht)', ' (daily limit reached)') : ''}</span>}
          {aiSt.phase === 'done' && (
            <div className="lc-compare" data-chain-compare={cmp?.same ? 'same' : 'differs'}>
              {cmp?.same ? <p className="lc-agree"><Icon name="check" size={13} />{tr('Lotse und KI planen gleich.', 'Lotse and the AI plan the same.')}</p> : (
                <>
                  <div className="lc-cols">
                    <div><span className="lx-kicker">{tr('Lotse-Plan', 'Lotse\'s plan')}</span><PlanList plan={{ steps: lotseSteps }} ctx={ctx} compact diff={new Set((cmp?.diffs || []).filter((d) => d.a).map((d) => lotseSteps.indexOf(d.a)))} /></div>
                    <div><span className="lx-kicker"><Icon name="sparkle" size={11} />{tr('KI-Vorschlag', 'AI proposal')}</span>{aiSt.plan.steps.length ? <PlanList plan={aiSt.plan} ctx={ctx} compact diff={new Set((cmp?.diffs || []).filter((d) => d.b).map((d) => aiSt.plan.steps.indexOf(d.b)))} /> : <p className="faint lx-small">{tr('Kein gültiger Schritt.', 'No valid step.')}</p>}</div>
                  </div>
                  {(cmp?.diffs || []).length > 0 && <ul className="lc-diffs">{cmp.diffs.slice(0, 6).map((d, i) => <li key={i}>{diffText(d)}</li>)}</ul>}
                  {aiSt.dropped.length > 0 && <p className="faint lx-small">{tr(`Lotse hat ${aiSt.dropped.length} KI-${aiSt.dropped.length === 1 ? 'Schritt' : 'Schritte'} verworfen (unbekannt oder unpassend).`, `Lotse dropped ${aiSt.dropped.length} AI ${aiSt.dropped.length === 1 ? 'step' : 'steps'} (unknown or unfit).`)}</p>}
                  <div className="lx-actions">
                    {draft.source === 'ai' ? <button type="button" className="btn btn-sm" onClick={() => setDraft((d) => ({ ...d, steps: lotse.steps, source: 'lotse' }))}>{tr('Zurück zum Lotse-Plan', 'Back to Lotse\'s plan')}</button>
                      : <button type="button" className="btn btn-sm" disabled={!aiSt.plan.steps.length} onClick={() => { setDraft((d) => ({ ...d, steps: aiSt.plan.steps, unresolved: [], source: 'ai' })); setEditing(null); }} data-chain-take-ai><Icon name="sparkle" size={12} />{tr('KI-Vorschlag übernehmen', 'Take the AI\'s proposal')}</button>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
      <form className="lc-rephrase" onSubmit={replanText}>
        <label className="sr" htmlFor={`${fid}-re`}>{tr('Auftrag anders formulieren', 'Rephrase the job')}</label>
        <input id={`${fid}-re`} value={rephrase} onChange={(e) => setRephrase(e.target.value)} maxLength={600} placeholder={tr('Anders formulieren – Lotse plant neu', 'Rephrase – Lotse plans again')} />
        <button type="submit" className="btn btn-sm" disabled={rephrase.trim().length < 8}><Icon name="refresh" size={12} />{tr('Neu planen', 'Plan again')}</button>
      </form>
      {err && <p className="lx-err" role="alert">{err}</p>}
      <div className="lx-actions">
        <span className="faint lx-small grow">{tr('Jede Änderung kommt mit Vorschau; gesendet wird nur, was du ausdrücklich wählst.', 'Every change comes with a preview; nothing is sent unless you explicitly choose it.')}</span>
        <motion.button type="button" className="btn btn-primary btn-sm lx-go lc-run" onClick={run} disabled={!draft.steps.length || hasErr} {...press()} data-chain-run>
          <Icon name="arrowRight" size={14} />{draft.source === 'ai' ? tr('KI-Plan ausführen', 'Run the AI\'s plan') : tr('Plan ausführen', 'Run the plan')}
        </motion.button>
      </div>
    </motion.section>
  );
}

// the live graph at the top of a running chain: one chip per step with its status, the progress, and – after the AI's
// plan was taken – the offer to let Lotse learn the phrasing (admins approve it first)
export function ChainGraph({ state, ctx }) {
  const { config } = useApp();
  const cs = useMemo(() => chainSections(state), [state]);
  const outline = useMemo(() => (cs.plan && ctx ? chainOutline(cs.plan, ctx) : []), [cs.plan, ctx]);
  const [learn, setLearn] = useState('idle');
  if (!cs.plan) return null;
  const done = cs.sections.filter((x) => ['done', 'skipped', 'failed'].includes(x.status)).length;
  const n = cs.sections.length;
  const canLearn = cs.source === 'ai' && aiOn(config, 'lotse');
  const offerLearn = async () => {
    const { clauses } = splitClauses(cs.plan.text || '');
    const list = clauses.length === cs.plan.steps.length ? clauses.map((c, i) => ({ text: c.text, tool: cs.plan.steps[i].tool })) : [];
    if (!list.length) { setLearn('na'); return; }
    setLearn('busy');
    try { const r = await call('lotse.llm', { mode: 'learn', clauses: list }); setLearn(r?.added ? 'done' : 'na'); } catch { setLearn('err'); }
  };
  return (
    <section className="lc-live" aria-label={tr('Fortschritt des Auftrags', 'Progress of the job')} data-chain-progress={`${done}/${n}`}>
      <div className="lc-live-head">
        <span className="lx-kicker"><Icon name="route" size={12} />{tr(`${done} von ${n} Schritten`, `${done} of ${n} steps`)}</span>
        <span className="lc-bar" aria-hidden="true"><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: n ? Math.max(0.04, done / n) : 0 }} transition={tween('gentle')} /></span>
      </div>
      <ol className="lc-chips">
        {cs.sections.map((x, i) => (
          <li key={x.id} className={`lc-chip st-${x.status}`} data-status={x.status} aria-current={x.status === 'waiting' || x.status === 'running' ? 'step' : undefined}>
            <span className="lc-chip-ic" aria-hidden="true"><Icon name={x.status === 'planned' ? outline[i]?.icon || 'layers' : STATUS_ICON[x.status]} size={12} className={x.status === 'running' ? 'lx-spin' : ''} /></span>
            <span className="lc-chip-t"><b>{i + 1}. {L2(outline[i]?.title || ['', ''])}</b><span className="faint">{L2(STATUS[x.status])}{x.applied ? tr(` · ${x.applied} übernommen`, ` · ${x.applied} applied`) : ''}</span></span>
          </li>
        ))}
      </ol>
      {canLearn && learn !== 'na' && (
        <p className="lc-learn faint lx-small">
          <Icon name="sparkle" size={12} />
          {learn === 'done' ? tr('Vorgemerkt – sobald ein Admin zustimmt, versteht Lotse diese Formulierung selbst.', 'Noted – once an admin approves, Lotse understands this phrasing on its own.')
            : learn === 'err' ? tr('Konnte nicht vorgemerkt werden.', 'Could not be noted.')
              : <>{tr('Lotse kann diese Formulierung lernen (ein Admin gibt sie frei).', 'Lotse can learn this phrasing (an admin approves it).')} <button type="button" className="btn btn-xs" onClick={offerLearn} disabled={learn === 'busy'} data-chain-learn>{tr('Lernen lassen', 'Let Lotse learn')}</button></>}
        </p>
      )}
    </section>
  );
}

// the header of a section inside the run
export function SectionHead({ sec, index, ctx }) {
  const o = useMemo(() => (ctx ? chainOutline({ steps: [{ id: sec.id, tool: sec.tool, params: sec.params, input: sec.input }] }, ctx)[0] : null), [sec, ctx]);
  if (!o) return null;
  return (
    <div className={`lc-sec st-${sec.status}`} data-section={sec.id} data-status={sec.status}>
      <span className="lc-sec-n" aria-hidden="true">{index + 1}</span>
      <span className="grow"><b>{L2(o.title)}</b>{sec.input && <span className="faint"> · {tr(`mit dem Ergebnis von Schritt ${sec.input.slice(1)}`, `with the result of step ${sec.input.slice(1)}`)}</span>}</span>
      <span className={`lc-status st-${sec.status}`}>{L2(STATUS[sec.status])}</span>
    </div>
  );
}

// a set a query found: every member with the numbers that qualified it
export function SetTable({ set }) {
  const [all, setAll] = useState(false);
  if (!set?.members?.length) return null;
  const L = getLang();
  const M = METRICS[set.entity];
  const rows = all ? set.members : set.members.slice(0, 8);
  const extra = { people: ['planned', 'overdue'], projects: ['rank', 'daysOverdue'], teams: ['load', 'slaRisk'], stories: ['remaining'], tickets: [] }[set.entity].filter((k) => !set.query.where.some((w) => w.m === k));
  const unit = (k, v) => (v == null ? '–' : typeof v === 'boolean' ? (v ? tr('ja', 'yes') : tr('nein', 'no')) : M[k].unit === '%' ? (v >= 999 ? '–' : `${fmt.n(v)} %`) : M[k].unit === 'h' ? fmt.h(v, 1) : M[k].unit === 'd' ? tr(`${v} T.`, `${v} d`) : fmt.n(v));
  return (
    <div className="lc-set">
      <table className="lx-props">
        <caption className="sr">{L2(set.label)}</caption>
        <thead><tr><th scope="col">{tr('Treffer', 'Match')}</th><th scope="col">{tr('Warum', 'Why')}</th>{extra.map((k) => <th key={k} scope="col" className="num">{L2(M[k].name)}</th>)}</tr></thead>
        <tbody>{rows.map((m) => <tr key={m.id}><td>{m.key ? <span className="mono">{m.key}</span> : null} {m.key ? String(m.name).replace(`${m.key} · `, '') : m.name}</td><td>{memberText(fmt, L, set.query, m)}</td>{extra.map((k) => <td key={k} className="num">{unit(k, m.values[k])}</td>)}</tr>)}</tbody>
      </table>
      {set.members.length > 8 && <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAll(!all)}>{all ? tr('Weniger', 'Less') : tr(`Alle ${set.members.length} zeigen`, `Show all ${set.members.length}`)}</button>}
    </div>
  );
}

// the checkpoint after a step that wrote: what happened, then on with the fresh numbers – or stop
export function GateCard({ step, state, onAnswer, active }) {
  const root = useRef(null);
  useTakeFocus(root, ['.lx-go:not(:disabled)'], active, step.id);
  const sec = chainSections(state).sections.find((x) => x.id === step.meta?.section);
  const n = sec?.writes ? state.steps.filter((x) => x.meta?.section === sec.id && x.kind === 'command' && x.status === 'applied').reduce((a, x) => a + (x.result?.applied || 0), 0) : 0;
  const skipped = sec && sec.writes && !sec.applied;
  return (
    <motion.section ref={root} className={`lx-card ${skipped ? 'is-info' : 'is-ok'} lc-gate`} aria-label={step.question} data-act="decide" data-gate={step.id} {...enter(0, { y: 10, d: 'base' })}>
      <div className="lc-gate-row">
        <span className={`lx-sum-ic ${skipped ? 'info' : 'ok'}`} aria-hidden="true"><Icon name={skipped ? 'info' : 'check'} size={16} /></span>
        <div className="grow">
          <h3 className="lx-title">{skipped ? tr(`Schritt ${sec.id.slice(1)} nicht übernommen – nichts geändert.`, `Step ${sec.id.slice(1)} not applied – nothing changed.`) : tr(`Schritt ${sec?.id.slice(1)} ist übernommen${n ? ` (${fmt.n(n)} ${n === 1 ? 'Vorgang' : 'Vorgänge'})` : ''}.`, `Step ${sec?.id.slice(1)} is applied${n ? ` (${fmt.n(n)} work ${n === 1 ? 'item' : 'items'})` : ''}.`)}</h3>
          <p className="lx-summary">{tr(`Weiter: ${step.nextTitle} – Lotse rechnet mit dem neuen Stand.`, `Next: ${step.nextTitle} – Lotse works with the new numbers.`)}</p>
        </div>
      </div>
      <div className="lx-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAnswer('stop')}>{tr('Hier aufhören', 'Stop here')}</button>
        <motion.button type="button" className="btn btn-primary btn-sm lx-go" onClick={() => onAnswer('continue')} {...press()} data-gate-go><Icon name="arrowRight" size={14} />{step.options?.[0]?.label}</motion.button>
      </div>
    </motion.section>
  );
}

// a text for the document (an opening line, the summary for the owner): Lotse's own, an own one, or the AI's draft –
// the AI writes from the verified story only and the engine cross-checks every number before it is used
export function NoteCard({ step, onAnswer, answered, active }) {
  const { config } = useApp();
  const [text, setText] = useState('');
  const [ai, setAi] = useState(null); // { phase, r }
  const [isAi, setIsAi] = useState(false);
  const [err, setErr] = useState(null);
  const root = useRef(null);
  const tid = useId();
  useTakeFocus(root, ['.lx-go:not(:disabled)'], active && answered === undefined, step.id);
  if (answered !== undefined) {
    const c = step.check;
    return (
      <div className="lx-answered" role="group" aria-label={step.question}>
        <span className="lx-answered-q">{step.question}</span>
        <span className="lx-answered-a"><Icon name="check" size={12} />{answered?.ai ? (c && !c.ok ? tr('KI-Text wich ab – Lotses Text verwendet', 'AI text differed – Lotse\'s text used') : tr('KI-Text, von Lotse geprüft', 'AI text, checked by Lotse')) : answered?.text ? tr('Eigener Text', 'Own text') : step.options?.find((o) => o.id === (answered?.option || answered))?.label}</span>
        {c && !c.ok && <span className="lc-wrong">{c.wrong.map((w) => `„${w.text}“${w.expected != null ? tr(` (belegt: ${w.expected})`, ` (proven: ${w.expected})`) : ''}`).join(' · ')}</span>}
      </div>
    );
  }
  const canAi = aiOn(config, 'lotse') && step.assist?.story;
  const draft = async () => {
    setAi({ phase: 'loading' }); setErr(null);
    try {
      const r = await call('lotse.llm', { mode: 'write', kind: step.assist.kind, story: step.assist.story, to: step.assist.to || null, max: step.assist.max || 600, lang: getLang() });
      track('ai:lotse');
      if (r?.source !== 'ai' || !r.text) { setAi({ phase: 'fallback', r }); return; }
      // as strict as the engine: every claim must stand in the story, else Lotse's text stays
      if ((r.crossCheck?.claims || []).some((c) => c.verified !== true)) { setAi({ phase: 'differs', r }); return; }
      setText(r.text); setIsAi(true); setAi({ phase: 'done', r });
    } catch (e) { setAi({ phase: 'fallback', e }); }
  };
  const send = (v) => { setErr(null); try { onAnswer(v); } catch (e) { setErr(errText(e)); } };
  const wrong = ai?.phase === 'differs' ? (ai.r.crossCheck?.claims || []).filter((c) => c.verified !== true) : [];
  return (
    <motion.section ref={root} className="lx-card lx-decide is-act lc-note" aria-label={step.question} data-act="decide" data-step={step.id} {...enter(0, { y: 12, scale: 0.985, spring: 'card' })}>
      <span className="lx-kicker"><Icon name="edit" size={12} />{tr('Text', 'Text')}</span>
      <h3 className="lx-title">{step.question}</h3>
      {step.draft && <pre className="lj-msg-text lc-draft" tabIndex={0}>{step.draft}</pre>}
      <label className="lx-free-label" htmlFor={tid}>{tr('Eigener Text (optional)', 'Own text (optional)')}{isAi && <span className="lc-tag ai"><Icon name="sparkle" size={11} />{tr('KI-Text, von Lotse geprüft', 'AI text, checked by Lotse')}</span>}</label>
      <textarea id={tid} className="lc-text" rows={step.assist?.kind === 'intro' ? 2 : 5} maxLength={step.freeText?.max || 280} value={text} onChange={(e) => { setText(e.target.value); setErr(null); }} placeholder={step.freeText?.placeholder || ''} />
      {canAi && (
        <div className="lc-ai">
          {(!ai || ai.phase === 'fallback' || ai.phase === 'differs') && <button type="button" className="lx-btn" onClick={draft} data-note-ai><Icon name="sparkle" size={13} />{tr('KI-Entwurf aus den belegten Zahlen', 'AI draft from the proven numbers')}</button>}
          {ai?.phase === 'loading' && <span className="faint lx-small"><Icon name="refresh" size={12} className="lx-spin" /> {tr('Die KI schreibt – Lotse prüft danach jede Zahl …', 'The AI is writing – Lotse checks every number afterwards …')}</span>}
          {ai?.phase === 'fallback' && <span className="faint lx-small" role="status">{tr('KI gerade nicht verfügbar – Lotses Text steht.', 'AI not available right now – Lotse\'s text stands.')}</span>}
          {ai?.phase === 'differs' && <span className="lc-wrong" role="status"><Icon name="alert" size={12} />{tr('Die KI nannte Zahlen, die nicht belegt sind – Lotses Text bleibt:', 'The AI named numbers that are not proven – Lotse\'s text stays:')} {wrong.slice(0, 4).map((c) => `„${c.text}“`).join(', ')}</span>}
        </div>
      )}
      {err && <p className="lx-err" role="alert">{err}</p>}
      <div className="lx-actions">
        <button type="button" className="btn btn-sm" onClick={() => send(step.options[0].id)}>{step.options[0].label}</button>
        <motion.button type="button" className="btn btn-primary btn-sm lx-go" disabled={!text.trim()} onClick={() => send({ option: step.options[1].id, text: text.trim(), ai: isAi })} {...press()}>
          <Icon name="check" size={14} />{tr('Diesen Text verwenden', 'Use this text')}
        </motion.button>
      </div>
    </motion.section>
  );
}

// the chain's result: per step what it produced – sets, documents (download again), texts to copy, writes
function ChainDocFile({ spec, ctx }) {
  const doc = useMemo(() => { try { return ctx ? buildChainDoc(ctx, spec) : null; } catch { return null; } }, [spec, ctx]);
  const [busy, setBusy] = useState(false);
  if (!doc) return null;
  const dl = async () => { setBusy(true); try { const m = await import('../../lib/jobPdf.js'); await m.downloadJobPdf(doc); } finally { setBusy(false); } };
  return (
    <div className="lj-file">
      <span className="lj-file-ic" aria-hidden="true"><Icon name="pdf" size={18} /></span>
      <span className="grow"><b>{doc.title}</b><span className="faint lx-small">{tr(`${fmt.n(doc.proof.length)} Belege`, `${fmt.n(doc.proof.length)} proofs`)}</span></span>
      <motion.button type="button" className="btn btn-primary btn-sm" onClick={dl} disabled={busy} {...press()}><Icon name={busy ? 'refresh' : 'download'} size={13} className={busy ? 'lx-spin' : ''} />{tr('PDF herunterladen', 'Download PDF')}</motion.button>
    </div>
  );
}
function MessageBox({ m }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(m.text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } };
  return (
    <div className="lj-msgs">
      <header className="lj-msgs-head"><b>{m.to || tr('Text', 'Text')}</b><span className="faint lx-small grow">{m.subject}{m.ai ? tr(' · KI-Text, von Lotse geprüft', ' · AI text, checked by Lotse') : ''}</span><button type="button" className="btn btn-sm" onClick={copy}><Icon name={copied ? 'check' : 'layers'} size={13} />{copied ? tr('Kopiert', 'Copied') : tr('Kopieren', 'Copy')}</button></header>
      <pre className="lj-msg-text" tabIndex={0}>{m.text}</pre>
    </div>
  );
}
export function ChainResult({ state, ctx }) {
  const cs = useMemo(() => chainSections(state), [state]);
  const outline = useMemo(() => (cs.plan && ctx ? chainOutline(cs.plan, ctx) : []), [cs.plan, ctx]);
  if (!cs.plan) return null;
  return (
    <div className="lc-result" data-chain-result={cs.sections.length}>
      <ol className="lc-res-list">
        {cs.sections.map((x, i) => {
          const o = x.out || {};
          const pdfDone = x.steps.some((y) => y.kind === 'command' && y.status === 'applied' && (y.command === 'doc.pdf' || y.command === 'doc.chain'));
          return (
            <li key={x.id} className={`st-${x.status}`}>
              <div className="lc-res-head"><span className={`lc-status st-${x.status}`}><Icon name={STATUS_ICON[x.status]} size={11} />{L2(STATUS[x.status])}</span><b>{i + 1}. {L2(outline[i]?.title || ['', ''])}</b></div>
              {o.set && <span className="faint lx-small">{tr(`${fmt.n(o.set.total)} Treffer von ${fmt.n(o.set.checked)} geprüft`, `${fmt.n(o.set.total)} matches of ${fmt.n(o.set.checked)} checked`)}</span>}
              {x.writes > 0 && <span className="faint lx-small">{x.applied ? tr(`${fmt.n(x.applied)} von ${fmt.n(x.writes)} Änderungsschritten übernommen`, `${fmt.n(x.applied)} of ${fmt.n(x.writes)} change steps applied`) : tr('nicht übernommen', 'not applied')}</span>}
              {x.note && <span className="faint lx-small">{x.note.length > 200 ? `${x.note.slice(0, 200)}…` : x.note}</span>}
              {o.doc?.job && pdfDone && <JobResult job={o.doc.job} ctx={ctx} />}
              {o.doc?.job && o.doc.job.format === 'text' && <JobResult job={o.doc.job} ctx={ctx} />}
              {o.doc?.chain && pdfDone && <ChainDocFile spec={o.doc.chain} ctx={ctx} />}
              {o.doc?.text && <MessageBox m={{ to: '', subject: L2(o.doc.chain?.set?.label || ['', '']), text: o.doc.text }} />}
              {o.message && <MessageBox m={o.message} />}
              {o.check && !o.check.ok && <span className="lc-wrong"><Icon name="alert" size={12} />{tr('Der KI-Text nannte unbelegte Zahlen – Lotses Text wurde verwendet.', 'The AI text named unproven numbers – Lotse\'s text was used.')}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
void useEffect;
