// "Nachprüfen" for what Lotse and the AI produce – the same mark and label as the KPI drawer (ProofPanel.jsx):
//   StoryProof  – every number of a Lotse story with its source (key figure / evidence / chart), the self-check that every
//                 number in the text stands in the data, and the work items it names opened in Jira (JQL);
//   AiProof     – for an AI suggestion: Lotse's cross-check state in one line ("Lotse hat geprüft: stimmt / weicht ab")
//                 and the work items the suggestion relies on, as links;
//   changedKeys – the work items a Lotse workflow actually wrote, for "In Jira ansehen (N)" after apply.
// Pure reading – nothing here writes. Motion: enter only, transform / opacity.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { storyFacts } from '@shared/lotse/story.js';
import { selfCheck } from '@shared/lotse/crosscheck.js';
import { enter } from '../lib/motion.js';
import { tr } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { openIssue } from '../lib/api.js';
import { track } from '../lib/usage.js';
import { ProofIcon, proofWord, JiraKeysButton } from './ProofPanel.jsx';
import { fmtUnit, splitUnit, evValue, kindName } from './lotse/visuals.jsx';
import './proof.css';

const KEY = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;
const isKey = (k) => typeof k === 'string' && KEY.test(k);
const kpiText = (k) => { const [n, u] = splitUnit(k.unit, k.value); return `${n}${u ? ` ${u}` : ''}`; };

// every number of a story, grouped by where it stands – the same sources storyFacts() verifies text against
export function storySources(s) {
  const kpis = (s.kpis || []).map((k) => ({ label: k.label, value: kpiText(k), hint: k.hint || null }));
  // evidence per finding: which statement is backed by which figures
  const evidence = (s.findings || []).map((f) => ({
    text: f.text,
    rows: (f.evidence || []).map((e) => ({ label: e.label && e.label !== e.key ? e.label : '', key: isKey(e.key) ? e.key : null, ref: e.ref || null, value: evValue(e) })).filter((e) => e.value != null || e.key || e.ref),
  })).filter((g) => g.rows.length);
  const v = s.visual || {}, d = v.data || {};
  const u = fmtUnit(d.unit || 'n');
  let visual = [];
  switch (v.kind) {
    case 'bars': case 'donut': visual = (d.items || []).map((x) => ({ label: x.label, key: isKey(x.key) ? x.key : null, value: u(x.value) })); if (v.kind === 'donut' && d.total != null) visual.push({ label: tr('Summe', 'Total'), value: u(d.total) }); break;
    case 'waterline': visual = (d.items || []).map((x) => ({ label: x.label, key: isKey(x.key) ? x.key : null, value: `${fmtUnit('h')(x.value)} · Σ ${fmtUnit('h')(x.cum)}` })); if (d.capacity != null) visual.push({ label: tr('Kapazität', 'Capacity'), value: fmtUnit('h')(d.capacity) }); break;
    case 'columns': case 'line': visual = (d.series || []).map((x) => ({ label: x.name, value: `Σ ${u((x.values || []).reduce((a, y) => a + (y || 0), 0))} · ${(x.values || []).map((y) => (y == null ? '–' : u(y))).join(' / ')}` })); break;
    case 'heat': visual = (d.rows || []).map((r) => ({ label: r.label, key: isKey(r.key) ? r.key : null, value: (r.values || []).map((y) => (y == null ? '–' : u(y))).join(' / ') })); break;
    case 'compare': visual = (d.rows || []).map((r) => { const f = fmtUnit(r.unit || 'n'); return { label: r.label, value: `${r.a == null ? '–' : f(r.a)} → ${r.b == null ? '–' : f(r.b)}` }; }); break;
    case 'gantt': visual = (d.rows || []).map((r) => ({ label: r.label, key: isKey(r.key) ? r.key : null, value: `${fmtUnit('date')(r.start)} – ${fmtUnit('date')(r.end)}` })); break;
    case 'timeline': visual = (d.events || []).map((e) => ({ label: e.label, key: isKey(e.key) ? e.key : null, value: fmtUnit('date')(e.date) })); break;
    default: break;
  }
  return { kpis, evidence, visual: visual.slice(0, 24), visualKind: v.kind };
}
export function storyKeys(s) {
  try { return [...storyFacts(s, { derived: false }).keys]; } catch { return []; }
}

function SourceList({ title, rows, onGo, sub }) {
  if (!rows.length) return null;
  return (
    <div>
      {title && <h4>{title}</h4>}
      {sub && <p className="pf-src-sub">{sub}</p>}
      <ul>{rows.map((r, i) => (
        <li key={i}>
          {r.key ? <button type="button" className="tkey" onClick={() => openIssue(r.key)} title={tr(`${r.key} in Jira öffnen`, `Open ${r.key} in Jira`)}>{r.key}</button>
            : r.ref && onGo ? <button type="button" className="linkbtn pf-src-l" onClick={() => onGo(r)}>{r.label}</button> : null}
          {!(r.ref && onGo && !r.key) && <span className="pf-src-l">{r.label}{r.hint ? <span className="faint"> · {r.hint}</span> : null}</span>}
          {r.value != null && <span className="num">{r.value}</span>}
        </li>
      ))}</ul>
    </div>
  );
}

// The toggle for a story card's footer and the panel it opens (rendered by the caller below the footer).
export function StoryProofButton({ open, onToggle }) {
  return (
    <button type="button" className="pf-inline" aria-expanded={open} onClick={() => { onToggle(); if (!open) track('proof:story'); }} data-proof-story>
      <ProofIcon size={13} />{proofWord()}
    </button>
  );
}
export function StoryProof({ story, onGo }) {
  const src = useMemo(() => storySources(story), [story]);
  const keys = useMemo(() => storyKeys(story), [story]);
  const bad = useMemo(() => { try { return selfCheck(story); } catch { return []; } }, [story]);
  return (
    <motion.section className="pf-story" aria-label={tr('Nachprüfen: jede Zahl mit Quelle', 'Check it yourself: every number with its source')} {...enter(0, { y: -4, d: 'quick' })}>
      <div className="pf-story-head">
        <ProofIcon size={14} />
        <b>{tr('Jede Zahl mit ihrer Quelle', 'Every number with its source')}</b>
        {bad.length === 0
          ? <span className="pf-badge ok"><Icon name="check" size={11} />{tr('Text deckt sich mit den Daten', 'Text matches the data')}</span>
          : <span className="pf-badge bad"><Icon name="alert" size={11} />{tr(`${bad.length} ${bad.length === 1 ? "Angabe" : "Angaben"} nicht belegt`, `${bad.length} ${bad.length === 1 ? "claim" : "claims"} not backed`)}</span>}
      </div>
      {bad.length > 0 && <ul className="pf-checks">{bad.slice(0, 6).map((b, i) => <li key={i} className="bad"><Icon name="alert" size={12} /><span>„{b.claim}“ <span className="faint">{b.expected ? tr(`geprüft: ${b.expected}`, `verified: ${b.expected}`) : tr('steht so nicht in den Daten', 'not in the data')}</span></span></li>)}</ul>}
      <div className="pf-src">
        <SourceList title={tr('Kennzahlen', 'Key figures')} rows={src.kpis} />
        {src.evidence.map((g, i) => <SourceList key={i} title={i === 0 ? tr('Belege je Aussage', 'Evidence per statement') : null} sub={g.text} rows={g.rows} onGo={onGo} />)}
        <SourceList title={`${tr('Diagramm', 'Chart')}${src.visualKind ? ` · ${kindName(src.visualKind)}` : ''}`} rows={src.visual} />
      </div>
      <p className="pf-note faint">{tr('Lotse rechnet nach festen Regeln aus euren Jira-Daten, ohne KI. Jede Zahl im Text oben steht hier mit ihrer Quelle; Keys öffnen den Vorgang in Jira.', 'Lotse computes with fixed rules from your Jira data, without AI. Every number in the text above stands here with its source; keys open the work item in Jira.')}</p>
      {keys.length > 0 && <div className="pf-actions"><JiraKeysButton keys={keys} /></div>}
    </motion.section>
  );
}

// ---------- AI suggestions: the keys they rely on and Lotse's check ----------
// keys named by key/issueKey anywhere in a result (picks, items, comments, suggestion) – at most 4 levels deep
export function keysIn(x, out = new Set(), depth = 0) {
  if (!x || depth > 4) return out;
  if (Array.isArray(x)) { for (const y of x.slice(0, 400)) keysIn(y, out, depth + 1); return out; }
  if (typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      if ((k === 'key' || k === 'issueKey') && isKey(v)) out.add(v);
      else if (v && typeof v === 'object' && k !== 'usedFacts' && k !== 'handles') keysIn(v, out, depth + 1);
    }
  }
  return out;
}
// state: 'agrees' | 'differs' | 'unverifiable' | 'lotse' (Lotse alone) | null
export function AiProof({ lotse, r, cmp, check, aiOn }) {
  const [open, setOpen] = useState(false);
  const keys = useMemo(() => {
    const s = new Set();
    if (lotse?.story) for (const k of storyKeys(lotse.story)) s.add(k);
    keysIn(lotse?.result, s); keysIn(r, s);
    for (const it of cmp?.items || []) if (isKey(it.key)) s.add(it.key);
    return [...s];
  }, [lotse, r, cmp]);
  const v = check?.verdict || (cmp ? (cmp.verdict === 'same' ? 'agrees' : cmp.verdict === 'partial' || cmp.verdict === 'differ' || cmp.verdict === 'differs' ? 'differs' : 'unverifiable') : null);
  const wrong = check ? (check.claims || []).filter((c) => c.verified === false).length : cmp ? cmp.total - cmp.same : 0;
  const state = !aiOn ? 'lotse' : !r ? null : v;
  if (!state && !keys.length) return null;
  const line = {
    agrees: [tr('Lotse hat geprüft: stimmt', 'Checked by Lotse: matches'), 'ok', 'check'],
    differs: [tr(`Lotse hat geprüft: weicht ab (${wrong})`, `Checked by Lotse: differs (${wrong})`), 'bad', 'alert'],
    unverifiable: [tr('Lotse hat geprüft: nichts Prüfbares', 'Checked by Lotse: nothing checkable'), 'neutral', 'info'],
    lotse: [tr('Lotse: nach festen Regeln aus euren Daten', 'Lotse: fixed rules on your data'), 'ok', 'check'],
  }[state];
  return (
    <div className="pf-ai" data-proof-ai={state || ''}>
      <ProofIcon size={13} />
      {line && <span className={`pf-ai-state ${line[1]}`}><Icon name={line[2]} size={12} />{line[0]}</span>}
      {keys.length > 0 && <button type="button" className="pf-inline" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) track('proof:ai'); }}>{proofWord()} · {tr(`${keys.length} ${keys.length === 1 ? 'Vorgang' : 'Vorgänge'}`, `${keys.length} work ${keys.length === 1 ? 'item' : 'items'}`)}</button>}
      {open && keys.length > 0 && (
        <motion.div className="pf-ai-keys pf-keys" {...enter(0, { y: -3, d: 'quick' })}>
          <span className="faint">{tr('Darauf beruht der Vorschlag:', 'The suggestion relies on:')}</span>
          {keys.slice(0, 40).map((k) => <button key={k} type="button" className="tkey" onClick={() => openIssue(k)} title={tr(`${k} in Jira öffnen`, `Open ${k} in Jira`)}>{k}</button>)}
          {keys.length > 40 && <span className="faint">+{keys.length - 40}</span>}
          <JiraKeysButton keys={keys} />
        </motion.div>
      )}
    </div>
  );
}

// ---------- workflows: the work items that were actually written ----------
// From each applied command step: the keys of its confirmed preview changes plus the work items its parameters name
// (issue ids resolved through the model, project refs to the project key); failed items (errors) are left out.
export function changedKeys(state, model, tickets = []) {
  if (!state || !model) return [];
  const out = new Set();
  const ticketKey = new Map((tickets || []).map((t) => [String(t.id), t.key]));
  const keyOfId = (id) => (id == null ? null : model.byId?.get(String(id))?.key || ticketKey.get(String(id)) || null);
  const keyOfRef = (ref) => (ref ? model.itemByRef?.get(ref)?.key || null : null);
  const walk = (x, d = 0) => {
    if (!x || d > 4) return;
    if (Array.isArray(x)) { for (const y of x.slice(0, 500)) walk(y, d + 1); return; }
    if (typeof x !== 'object') return;
    for (const [k, v] of Object.entries(x)) {
      if ((k === 'issueId' || k === 'issue' || k === 'ticket' || k === 'taskId') && (typeof v === 'string' || typeof v === 'number')) { const kk = keyOfId(v); if (kk) out.add(kk); }
      else if (k === 'key' && isKey(v)) out.add(v);
      else if (k === 'ref' && typeof v === 'string') { const kk = keyOfRef(v); if (kk) out.add(kk); }
      else if (v && typeof v === 'object') walk(v, d + 1);
    }
  };
  for (const x of state.steps || []) {
    if (x.kind !== 'command' || x.status !== 'applied' || x.result?.open || x.result?.navigate) continue;
    const pv = (state.steps || []).find((p) => p.kind === 'preview' && (p.covers || []).includes(x.id))?.items?.find((i) => i.stepId === x.id)?.preview;
    for (const c of pv?.changes || []) { if (isKey(c.key)) out.add(c.key); else if (c.id) { const kk = keyOfId(c.id); if (kk) out.add(kk); } }
    walk(x.params);
    for (const e of x.result?.errors || []) { const kk = isKey(e.key) ? e.key : keyOfId(e.key); if (kk) out.delete(kk); }
  }
  return [...out];
}
