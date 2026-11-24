import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { quartersFrom } from '@shared/dates.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt, ruleName, roleName, usageName } from '../lib/i18n.js';
import { structureChecks } from '@shared/kpis.js';
import { smartSuggestions, suggestionFor } from '@shared/smart.js';
import { SizeFix } from '../components/KpiTiles.jsx';
import { Icon } from '../lib/icons.jsx';
import { openIssue } from '../lib/api.js';
import { exportQuality } from '../lib/books.js';
import { Ring, Empty, Avatar, Segmented, Switch, stagger, spring, Counter, useTip, infoCard } from '../components/ui.jsx';
import ChangePreview from '../components/ChangePreview.jsx';
import { useAiAssist, AiButton, AiPanel } from '../components/AiAssist.jsx';
import { gapPayload } from '@shared/aiPayload.js';
import { applyGap } from '../lib/aiApply.js';
import { useWindowedRows, SpacerDiv, FindNote } from '../lib/virtual.jsx';

const BULK_MAX = 200;
// Runs fn over items with a few calls in flight at once (each Forge call takes ~1–2 s).
async function inParallel(items, fn, width = 4) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const it = items[next++]; await fn(it); } };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
}
// Which issue or space a gap is saved on (portfolio items in issue mode are work items too).
function target(g, model) {
  const ref = g.isItem ? g.rootRef : null;
  const spaceItem = !!ref && ref.startsWith('space:');
  const itemIssueId = g.isItem && !spaceItem ? model.itemByRef.get(g.rootRef)?.id : null;
  return { issueId: spaceItem ? undefined : itemIssueId || g.issueId, ref: spaceItem ? ref : undefined };
}

// How a suggested value reads in the UI.
function showValue(s) {
  if (Array.isArray(s.show)) return s.show.map((q) => fmt.quarter(q)).join(', ');
  return s.date ? fmt.date(s.show) : s.show;
}

// Smart suggestions (shared/smart.js): rule-based, from data already in Jira, each with its reason.
// Nothing is applied without a click; one undo reverts a whole batch.
function SmartSuggestions({ fixed, onFixed, onUnfixed }) {
  const { computed, lang, fill, pushUndo, toast, runUndo, stale } = useApp();
  const all = useMemo(() => smartSuggestions(computed, { lang }), [computed, lang]);
  const list = all.filter((s) => !fixed.has(s.id));
  const [busy, setBusy] = useState(null); // 'all' | suggestion id
  const [preview, setPreview] = useState(null); // bulk: show exactly what will change before anything is written
  const [showAll, setShowAll] = useState(false);
  if (!all.length) return null;
  const apply = async (items) => {
    setBusy(items.length > 1 ? 'all' : items[0].id);
    const ok = [], failed = [];
    const width = items.some((x) => target(x.gap, computed.model).ref) ? 1 : 4;
    await inParallel(items, async (x) => {
      try { ok.push({ x, undo: await fill({ ...target(x.gap, computed.model), usage: x.usage, value: x.value, collectUndo: true }) }); }
      catch (e) { failed.push({ x, e }); }
    }, width);
    setBusy(null);
    if (ok.length) {
      onFixed(ok.map((o) => o.x.id));
      const label = ok.length === 1 ? tr(`Vorschlag übernommen – ${ok[0].x.gap.key || ok[0].x.gap.summary}`, `Suggestion applied – ${ok[0].x.gap.key || ok[0].x.gap.summary}`) : tr(`${ok.length} Vorschläge übernommen`, `${ok.length} suggestions applied`);
      const entry = pushUndo(label, async () => {
        const stuck = [];
        await inParallel(ok, async (o) => { try { await o.undo(); onUnfixed([o.x.id]); } catch (e) { stuck.push(e); } }, width);
        if (stuck.length) throw Object.assign(new Error(tr(`${stuck.length} von ${ok.length} ließen sich nicht zurücksetzen`, `${stuck.length} of ${ok.length} could not be reverted`)), { code: 'PARTIAL' });
      }, ok.map((o) => o.undo.key));
      toast({ text: failed.length ? tr(`${label} – ${failed.length} nicht möglich: ${errText(failed[0].e)}`, `${label} – ${failed.length} not possible: ${errText(failed[0].e)}`) : `${label} · ${tr('in Jira gespeichert', 'saved in Jira')}`, icon: 'sparkle', undo: () => runUndo(entry) });
    } else if (failed.length) toast({ text: errText(failed[0].e), error: true });
  };
  const shown = showAll ? list : list.slice(0, 6);
  return (
    <section className="card smart">
      <ChangePreview open={!!preview} list={preview || []} busy={busy === 'all'} onClose={() => setPreview(null)} onConfirm={async () => { await apply(preview); setPreview(null); }} />
      <div className="card-head">
        <h2 className="card-title"><Icon name="sparkle" />{tr('Smarte Vorschläge', 'Smart suggestions')} <span className="chip num">{list.length}</span></h2>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="card-sub">{tr('Aus euren Jira-Daten abgeleitet · keine KI · jede Übernahme lässt sich rückgängig machen', 'Derived from your Jira data · no AI · every change can be undone')}</span>
          {list.length > 1 && <button className="btn btn-dark btn-sm" disabled={!!busy || stale} onClick={() => setPreview(list.slice(0, BULK_MAX))}>{tr(`Alle ${Math.min(list.length, BULK_MAX)} prüfen & übernehmen`, `Review & apply all ${Math.min(list.length, BULK_MAX)}`)}</button>}
        </div>
      </div>
      {list.length === 0 ? <Empty icon="check" title={tr('Alle Vorschläge übernommen', 'All suggestions applied')}>{tr('Rückgängig geht jederzeit über den Verlauf oben rechts.', 'You can undo any time from the history at the top right.')}</Empty> : (
        <ul className="smart-list">
          <AnimatePresence initial={false}>
            {shown.map((x, i) => (
              <motion.li key={x.id} className="smart-row" data-usage={x.usage} {...stagger(i, 0.03)} exit={{ opacity: 0, height: 0, transition: { duration: 0.25 } }}>
                <div className="smart-main">
                  <div className="row" style={{ gap: 8, minWidth: 0 }}>
                    {x.gap.key && <button className="tkey" onClick={() => openIssue(x.gap.key)}>{x.gap.key}</button>}
                    <span className="smart-sum">{x.gap.summary}</span>
                  </div>
                  <div className="smart-why"><b>{usageName(x.usage)}</b> = <span className="smart-val">{showValue(x)}</span> <span className="faint">– {x.why}</span></div>
                </div>
                <button className="btn btn-sm" disabled={!!busy || stale} onClick={() => apply([x])}>{busy === x.id ? '…' : tr('Übernehmen', 'Apply')}</button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {list.length > 6 && <button className="btn btn-ghost btn-sm smart-more" onClick={() => setShowAll(!showAll)}>{showAll ? tr('Weniger zeigen', 'Show less') : tr(`Alle ${list.length} zeigen`, `Show all ${list.length}`)}</button>}
    </section>
  );
}

// The company's Jira structure rules, checked live against the data (shared/kpis.js structureChecks).
function StructureRules() {
  const { computed, ds, lang } = useApp();
  const checks = useMemo(() => structureChecks({ computed, ds, lang, fmt, usageName }), [computed, ds, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(null);
  const okN = checks.filter((c) => c.ok).length;
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title"><Icon name="layers" />{tr('Regeln der Jira-Struktur', 'Jira structure rules')}</h2>
        <span className="card-sub">{tr(`${okN} von ${checks.length} eingehalten · live aus euren Daten geprüft`, `${okN} of ${checks.length} followed · checked live against your data`)}</span>
      </div>
      <ul className="rules">
        {checks.map((c, i) => (
          <motion.li key={c.id} {...stagger(i, 0.04)} className={c.ok ? 'ok' : 'warn'}>
            <span className="rule-icon" aria-hidden="true"><Icon name={c.ok ? 'check' : 'alert'} size={14} /></span>
            <div className="rule-main">
              <div className="rule-title">{c.title}</div>
              <div className="rule-text">{c.rule}</div>
              {!c.ok && open === c.id && (
                <ul className="rule-items">
                  {c.items.slice(0, 12).map((x, k) => (
                    <li key={k}><button className="linkbtn" onClick={() => x.key && openIssue(x.key)}>{x.text}</button> <span className="faint">· {x.sub}</span>
                      {x.fix?.usage === 'tshirt' && <SizeFix fix={x.fix} name={x.text} />}</li>
                  ))}
                  {c.items.length > 12 && <li className="faint">{tr(`+ ${c.items.length - 12} weitere`, `+ ${c.items.length - 12} more`)}</li>}
                </ul>
              )}
            </div>
            <div className="rule-side">
              {c.ok ? <span className="chip chip-ok">{tr('eingehalten', 'followed')}</span>
                : <button className="chip chip-accent" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>{tr(`${c.count} von ${c.total}`, `${c.count} of ${c.total}`)} <Icon name="chevronDown" size={12} /></button>}
            </div>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}

export default function Quality() {
  const { computed, ds, config } = useApp();
  const { dq, model } = computed;
  const [rule, setRule] = useState(null);
  const [onlyUrgent, setOnlyUrgent] = useState(true);
  const [scope, setScope] = useState('all');
  const [fixed, setFixed] = useState(() => new Set());
  const [picked, setPicked] = useState(() => new Set());
  const levelName = (k) => (k === 'portfolio' ? tr('Projekt', 'Project') : (config.levels || []).find((l) => l.key === k)?.name || roleName(k));
  const gaps = dq.gaps.filter((g) => (!rule || g.rule === rule) && (!onlyUrgent || g.urgent || rule) && (scope === 'all' || g.rootRef === scope) && !fixed.has(g.id));
  const urgent = dq.gaps.filter((g) => g.urgent).length;
  const ranked = useMemo(() => [...ds.portfolio].sort((a, b) => a.rank - b.rank), [ds.portfolio]);
  const b = dq.basis;
  // Bulk mode: one rule, one fixable field – pick rows (or all) and set one value for all of them.
  const bulkField = rule && gaps.length > 1 && gaps.every((g) => g.fixable && g.field === gaps[0].field) ? gaps[0].field : null;
  const pickedGaps = bulkField ? gaps.filter((g) => picked.has(g.id)) : [];
  const togglePick = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = bulkField && gaps.slice(0, BULK_MAX).every((g) => picked.has(g.id));
  const markFixed = (ids, on) => setFixed((f) => { const n = new Set(f); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  // more than 80 gaps (bulk: 200): all of them, rendered near the viewport only (lib/virtual.jsx) instead of the first 80
  const listed = bulkField ? gaps.slice(0, BULK_MAX) : gaps;
  const win = useWindowedRows(listed.length, { estimate: 66, min: bulkField ? BULK_MAX : 80 });
  const app = useApp();
  const exportGaps = () => exportQuality(app, gaps, levelName).catch((e) => app.toast({ text: e.message, error: true }));
  return (
    <div className="page">
      <section className="card" style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 28, padding: '22px 26px', alignItems: 'center' }}>
        <Ring value={dq.score} size={124} stroke={10} color={dq.score >= 0.85 ? 'var(--ok)' : dq.score >= 0.65 ? 'var(--warn)' : 'var(--accent)'}>
          <div style={{ textAlign: 'center', lineHeight: 1.1 }}><div style={{ fontSize: 26, fontWeight: 560, letterSpacing: '-0.03em' }}><Counter value={dq.score} format={(v) => fmt.pct(v)} /></div><div className="faint" style={{ fontSize: 11, fontWeight: 500 }}>{tr('vollständig', 'complete')}</div></div>
        </Ring>
        <div className="stack" style={{ gap: 14 }}>
          <div>
            <h1 className="h1">{tr('Datenqualität', 'Data quality')}</h1>
            <div className="muted" style={{ marginTop: 4 }}>{tr('Nur Pflichtfelder werden gemeldet; optionale Felder sind sichtbar, aber nicht als Lücke gezählt.', 'Only required fields are flagged; optional fields are shown but not counted as gaps.')}</div>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="chip" title={fmt.pct(b.stories ? b.estimated / b.stories : 0)}>{tr(`${b.estimated} von ${b.stories} Stories geschätzt`, `${b.estimated} of ${b.stories} stories estimated`)}</span>
            <span className="chip">{fmt.pct(b.stories ? b.scheduled / b.stories : 0)} {tr('terminiert', 'scheduled')}</span>
            <span className="chip">{fmt.pct(b.stories ? b.teamed / b.stories : 0)} {tr('mit Team', 'with team')}</span>
            <span className={`chip ${urgent ? 'chip-accent' : 'chip-ok'}`}><Icon name="zap" size={12} />{urgent} {tr('dringend (≤ 4 Wochen)', 'urgent (≤ 4 weeks)')}</span>
          </div>
        </div>
      </section>

      <SmartSuggestions fixed={fixed} onFixed={(ids) => markFixed(ids, true)} onUnfixed={(ids) => markFixed(ids, false)} />

      <StructureRules />

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2 className="card-title"><Icon name="layers" />{tr('Vollständigkeit je Ebene', 'Completeness per level')}</h2></div>
          <div className="stack" style={{ padding: '16px 20px 20px', gap: 14 }}>
            {dq.levels.map((l, i) => (
              <motion.div key={l.levelKey} {...stagger(i, 0.05)}>
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}><b style={{ fontWeight: 540 }}>{levelName(l.levelKey)}</b><span className="muted num">{l.complete} / {l.total} · <b style={{ color: 'var(--ink)' }}>{fmt.pct(l.pct)}</b></span></div>
                <div style={{ height: 10, borderRadius: 5, background: 'var(--sunken)', overflow: 'hidden' }}>
                  <motion.div initial={{ width: 0 }} animate={{ width: `${l.pct * 100}%` }} transition={{ duration: 1, delay: 0.1 + i * 0.06, ease: [0.16, 1, 0.3, 1] }} style={{ height: '100%', borderRadius: 5, background: l.pct >= 0.85 ? 'var(--ok)' : l.pct >= 0.65 ? 'var(--warn)' : 'var(--accent)' }} />
                </div>
              </motion.div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2 className="card-title"><Icon name="filter" />{tr('Prüfregeln', 'Check rules')}</h2>{rule && <button className="btn btn-ghost btn-xs" onClick={() => setRule(null)}><Icon name="x" size={12} />{tr('Filter lösen', 'Clear filter')}</button>}</div>
          <div style={{ maxHeight: 330, overflow: 'auto' }}>
            {dq.rules.length === 0 && <Empty icon="check" title={tr('Keine Lücken', 'No gaps')} />}
            {dq.rules.map((r, i) => (
              <motion.button key={r.rule} {...stagger(i, 0.03)} onClick={() => setRule(rule === r.rule ? null : r.rule)} className="action" style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto', alignItems: 'center', background: rule === r.rule ? 'var(--accent-soft)' : undefined }}>
                <span className="action-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{r.severity === 'hint' && <span className="chip chip-info" style={{ height: 18, fontSize: 10.5 }}>{tr('Hinweis', 'Hint')}</span>}{ruleName(r.rule)}</span>
                <span className="chip num">{r.count}</span>
                <span className={`chip num ${r.urgent ? 'chip-accent' : 'chip-outline'}`} title={tr('dringend', 'urgent')}><Icon name="zap" size={11} />{r.urgent}</span>
              </motion.button>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title"><Icon name="zap" />{rule ? ruleName(rule) : onlyUrgent ? tr('Dringende Lücken', 'Urgent gaps') : tr('Alle Lücken', 'All gaps')} <span className="chip num">{gaps.length}</span></h2>
          <div className="row wrap">
            <select className="select select-sm" value={scope} onChange={(e) => setScope(e.target.value)} aria-label={tr('Projekt', 'Project')}><option value="all">{tr('Alle Projekte', 'All projects')}</option>{ranked.map((p) => <option key={p.ref} value={p.ref}>{p.rank}. {p.name}</option>)}</select>
            {!rule && <Switch on={onlyUrgent} onChange={setOnlyUrgent} label={tr('Nur dringende', 'Urgent only')} />}
            <button className="btn btn-sm" onClick={exportGaps} title={tr('Diese Auswahl als Excel herunterladen', 'Download this selection as Excel')}><Icon name="download" size={13} />Excel</button>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {bulkField && (
            <motion.div key="bulk" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
              <BulkBar field={bulkField} gaps={pickedGaps} allPicked={allPicked} total={Math.min(gaps.length, BULK_MAX)}
                onPickAll={() => setPicked(allPicked ? new Set() : new Set(gaps.slice(0, BULK_MAX).map((g) => g.id)))}
                onFixed={(ids) => { markFixed(ids, true); setPicked(new Set()); }} onUnfixed={(ids) => markFixed(ids, false)} />
            </motion.div>
          )}
        </AnimatePresence>
        {gaps.length === 0 ? <Empty icon="check" title={tr('Keine offenen Lücken in dieser Auswahl', 'No open gaps in this selection')}>{tr('Stark – die Planung steht auf solidem Fundament.', 'Nice – planning rests on a solid foundation.')}</Empty> : (
          win.on ? (
            <div>
              <div ref={win.ref}>
                <SpacerDiv height={win.before} />
                {listed.slice(win.start, win.end).map((g, k) => <GapRow key={g.id} g={g} i={win.start + k < 40 ? win.start + k : 0} still levelName={levelName} pickable={!!bulkField} picked={picked.has(g.id)} onPick={() => togglePick(g.id)} onFixed={() => setFixed((s) => new Set(s).add(g.id))} onUnfix={() => setFixed((s) => { const n = new Set(s); n.delete(g.id); return n; })} model={model} />)}
                <SpacerDiv height={win.after} />
              </div>
              <FindNote count={listed.length} />
            </div>
          ) : <div>
            <AnimatePresence initial={false}>
              {gaps.slice(0, bulkField ? BULK_MAX : 80).map((g, i) => <GapRow key={g.id} g={g} i={i} levelName={levelName} pickable={!!bulkField} picked={picked.has(g.id)} onPick={() => togglePick(g.id)} onFixed={() => setFixed((s) => new Set(s).add(g.id))} onUnfix={() => setFixed((s) => { const n = new Set(s); n.delete(g.id); return n; })} model={model} />)}
            </AnimatePresence>
            {gaps.length > (bulkField ? BULK_MAX : 80) && <div className="muted" style={{ padding: 14, textAlign: 'center', fontSize: 12.5 }}>{tr(`+ ${gaps.length - (bulkField ? BULK_MAX : 80)} weitere – Filter nutzen`, `+ ${gaps.length - (bulkField ? BULK_MAX : 80)} more – use the filters`)}</div>}
          </div>
        )}
      </section>
    </div>
  );
}

export function GapRow({ g, i, levelName, onFixed, onUnfix, model, pickable, picked, onPick, still = false, listItem = false }) {
  const [done, setDone] = useState(false);
  const [preset, setPreset] = useState(null); // a suggestion put into the field – saved only with "Setzen"

  const { computed, lang, fill, toast, runUndo } = useApp();
  // KI-Assistent: a value for this gap from similar work items – applied through the same fill (and undo) as by hand
  const ai = useAiAssist({ feature: 'gaps', build: () => gapPayload(computed, g, lang) });
  const aiFill = async (r) => {
    const entry = await applyGap({ fill, target: target(g, computed.model), gap: g, result: r, onUndone: () => { setDone(false); onUnfix(); } });
    if (!entry) return;
    setDone(true); setTimeout(onFixed, 1100);
    toast({ text: r.source === 'lotse' ? tr(`${g.key || ''} in Jira gespeichert (Lotse-Vorschlag)`, `${g.key || ''} saved in Jira (Lotse suggestion)`) : tr(`${g.key || ''} in Jira gespeichert (KI-Vorschlag)`, `${g.key || ''} saved in Jira (AI suggestion)`), icon: 'sparkle', undo: () => runUndo(entry) });
  };
  const proj = model.itemByRef.get(g.rootRef);
  return (
    <motion.div layout={!still} className={listItem ? 'gap-row' : undefined} role={listItem ? 'listitem' : undefined} data-gap-key={g.key || ''} data-gap-field={g.field} data-gap-rule={g.rule} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.02, 0.4) } }} exit={{ opacity: 0, height: 0, transition: { duration: 0.3 } }}
      style={{ ...(listItem ? {} : { display: 'grid', gridTemplateColumns: `${pickable ? '28px ' : ''}minmax(0, 1.4fr) minmax(0, 1fr) minmax(280px, 1.2fr)`, gap: 16, alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--line-soft)', overflow: 'hidden' }), background: done ? 'var(--ok-soft)' : picked ? 'var(--accent-soft)' : undefined, transition: 'background .3s' }}>
      {pickable && <input type="checkbox" className="pick" checked={picked} onChange={onPick} aria-label={`${tr('Auswählen', 'Select')}: ${g.key || g.summary}`} />}
      <div className="gap-what" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {g.urgent && <span className="chip chip-accent" style={{ height: 20, fontSize: 10.5 }}><Icon name="zap" size={10} />{tr('dringend', 'urgent')}</span>}
          <b style={{ fontWeight: 560 }}>{ruleName(g.rule)}</b>
        </div>
        <div className="row muted" style={{ gap: 8, fontSize: 12.5, marginTop: 3, minWidth: 0 }}>
          {!g.isItem && <button className="tkey" onClick={() => openIssue(g.key)}>{g.key}</button>}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.summary}</span>
        </div>
      </div>
      <div className="muted gap-meta" style={{ fontSize: 12.5, minWidth: 0 }}>
        <div className="gap-meta-l">{levelName(g.levelKey)} · {proj?.name}</div>
        <div className="row" style={{ gap: 6, marginTop: 3 }}>{g.responsible && !g.responsible.anon ? <><Avatar user={g.responsible} size={18} />{g.responsible.name}</> : <span className="faint">{tr('Kein Verantwortlicher', 'No owner')}</span>}</div>
      </div>
      <div className="gap-act" style={{ justifySelf: 'end', minWidth: 0 }}>
        <>
          {done ? (
            <motion.span key="ok" className="chip chip-ok" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring}><Icon name="check" size={13} />{tr('In Jira gespeichert', 'Saved in Jira')}</motion.span>
          ) : g.fixable ? (
            <motion.div key="fix" exit={{ opacity: 0, scale: 0.95 }} className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {AI_USAGES.includes(g.field) && <AiButton ai={ai} compact label={tr('Wert', 'value')} />}
              <SuggestButton g={g} onPick={(v) => setPreset({ v, n: Date.now() })} onUnfix={() => { setDone(false); onUnfix(); }} onDone={() => { setDone(true); setTimeout(onFixed, 1100); }} />
              <Fixer g={g} preset={preset} onUnfix={() => { setDone(false); onUnfix(); }} onDone={() => { setDone(true); setTimeout(onFixed, 1100); }} />
            </motion.div>
          ) : (
            <button className="btn btn-sm" onClick={() => openIssue(g.isItem ? proj?.key : g.key)} disabled={g.isItem && proj?.kind !== 'issue'}><Icon name="external" size={13} />{tr('In Jira öffnen', 'Open in Jira')}</button>
          )}
        </>
      </div>
      {ai.open && !done && (
        <div className="gap-ai">
          <AiPanel ai={ai} title={`${ruleName(g.rule)} · ${g.key || g.summary || ''}`} render={(r, nm) => <AiGapValue r={r} nm={nm} model={computed.model} />}
            onApply={aiFill} canApply={(r) => r.suggestion?.value != null && r.suggestion.usage === g.field} applyLabel={tr('Wert übernehmen', 'Use value')} />
        </div>
      )}
    </motion.div>
  );
}
const AI_USAGES = ['originalEstimate', 'team', 'tshirt', 'startDate', 'dueDate', 'targetQuarters'];
function AiGapValue({ r, nm, model }) {
  const s = r.suggestion;
  if (!s) return <div className="faint" style={{ fontSize: 12.5 }}>{r.why || tr('Kein belastbarer Vorschlag – bitte von Hand ergänzen.', 'No sound suggestion – please fill in by hand.')}</div>;
  const v = s.value;
  const show = s.usage === 'team' ? model.teams.get(v)?.name || v : s.usage === 'originalEstimate' ? fmt.h(v, v % 1 ? 1 : 0) : s.usage === 'startDate' || s.usage === 'dueDate' ? fmt.date(v) : Array.isArray(v) ? v.map((q) => fmt.quarter(q)).join(', ') : v;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><span className="ai-value"><Icon name="sparkle" size={13} />{show}</span>{r.why && <span className="muted" style={{ fontSize: 12.5 }}>{nm.text(r.why)}</span>}</div>
      {r.basedOn?.length > 0 && <span className="ai-based">{tr('Grundlage', 'Based on')}: {r.basedOn.map((k, i) => <span key={k}>{i ? ', ' : ''}{/^[A-Z][A-Z0-9_]*-\d+$/.test(k) ? <button type="button" className="linkbtn mono" title={tr(`${k} in Jira öffnen`, `Open ${k} in Jira`)} onClick={() => openIssue(k)}>{k}</button> : k}</span>)}</span>}
    </div>
  );
}

// One click on the suggested value (with its reason as tooltip); the same fill and undo as a manual edit.
export function SuggestButton({ g, onDone, onUnfix, onPick }) {
  const { computed, lang, fill, toast, runUndo, stale } = useApp();
  const tip = useTip();
  const sug = useMemo(() => suggestionFor(computed, g, lang), [computed, g, lang]);
  const [busy, setBusy] = useState(false);
  if (!sug) return null;
  // tester 2026-11-19: the card names the work item, today's values and what would change
  const issue = g.issueId ? computed.model.byId.get(g.issueId) : null;
  const card = infoCard({
    title: `${tr('Vorschlag', 'Suggestion')}: ${showValue(sug)}`, sub: `${g.key ? `${g.key} · ` : ''}${g.summary || ''}`, text: sug.why,
    inputs: [
      ...(issue ? [['Start', issue.start ? fmt.date(issue.start, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–'], ['Due', issue.due ? fmt.date(issue.due, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–']] : []),
      [tr('Wird zu', 'Becomes'), `${usageName(g.field)}: ${showValue(sug)}`],
    ],
    hint: onPick ? tr('Klick setzt den Wert ins Feld daneben – gespeichert wird erst mit „Setzen“.', 'Click puts the value into the field next to it – it is saved only with "Set".') : tr('Klick speichert den Wert in Jira (rückgängig über den Verlauf).', 'Click saves the value in Jira (undo via the history).'),
  });
  const apply = async () => {
    if (onPick) { onPick(sug.value); return; }
    setBusy(true);
    try {
      const entry = await fill({ ...target(g, computed.model), usage: g.field, value: sug.value, onUndone: onUnfix, label: tr(`Vorschlag übernommen – ${g.key || g.summary}`, `Suggestion applied – ${g.key || g.summary}`) });
      onDone();
      toast({ text: tr(`${g.key || ''} in Jira gespeichert`, `${g.key || ''} saved in Jira`), icon: 'sparkle', undo: () => runUndo(entry) });
    } catch (e) { toast({ text: errText(e), error: true }); } finally { setBusy(false); }
  };
  return (
    <button className="btn btn-sm smart-pill" disabled={busy || stale} onClick={apply} aria-label={`${onPick ? tr('Vorschlag ins Feld setzen', 'Put the suggestion into the field') : tr('Vorschlag übernehmen', 'Apply suggestion')}: ${showValue(sug)} – ${sug.why}`}
      {...tip(card)}>
      <Icon name="sparkle" size={13} />{busy ? '…' : showValue(sug)}
    </button>
  );
}

export function Fixer({ g, onDone, onUnfix, preset = null }) {
  const { fill, ds, config, toast, computed, runUndo } = useApp();
  const [v, setV] = useState(g.field === 'targetQuarters' ? [] : '');
  const [hint, setHint] = useState(false);
  useEffect(() => { if (preset) { setV(preset.v); setHint(true); } }, [preset]);
  // dates in the right order: a due date not before the start, a start not after the due date
  const issue = g.issueId ? computed.model.byId.get(g.issueId) : null;
  const wrongOrder = (g.field === 'dueDate' && v && issue?.start && v < issue.start) ? tr(`Due liegt vor dem Start (${fmt.date(issue.start, { day: '2-digit', month: '2-digit', year: 'numeric' })})`, `Due is before the start (${fmt.date(issue.start, { day: '2-digit', month: '2-digit', year: 'numeric' })})`)
    : (g.field === 'startDate' && v && issue?.due && v > issue.due) ? tr(`Start liegt nach dem Due (${fmt.date(issue.due, { day: '2-digit', month: '2-digit', year: 'numeric' })})`, `Start is after the due date (${fmt.date(issue.due, { day: '2-digit', month: '2-digit', year: 'numeric' })})`) : null;
  const presetNote = hint && <span className="fix-preset-note" role="status">{tr('Vorschlag eingesetzt – mit „Setzen“ speichern', 'Suggestion filled in – save with "Set"')}</span>;
  const [busy, setBusy] = useState(false);
  const ref = g.isItem ? g.rootRef : null;
  const spaceItem = ref && ref.startsWith('space:');
  // Issue-mode portfolio items are Jira work items: fill them by their issue id.
  const itemIssueId = g.isItem && !spaceItem ? computed.model.itemByRef.get(g.rootRef)?.id : null;
  const save = async (value) => {
    setBusy(true);
    try {
      const teamName = g.field === 'team' ? ds.teams.find((t) => t.id === value)?.name : undefined;
      const entry = await fill({ issueId: spaceItem ? undefined : itemIssueId || g.issueId, ref: spaceItem ? ref : undefined, usage: g.field, value, teamName, onUndone: onUnfix });
      onDone();
      toast({ text: tr(`${g.key || ""} in Jira gespeichert`, `${g.key || ""} saved in Jira`), icon: "check", undo: () => runUndo(entry) });
    } catch (e) { toast({ text: errText(e), error: true }); } finally { setBusy(false); }
  };
  const field = g.field;
  if (field === 'team') return (
    <div className="row" style={{ gap: 6 }}>
      <select className={`select select-sm ${hint ? 'fix-preset' : ''}`} value={v} onChange={(e) => { setV(e.target.value); setHint(false); }} aria-label="Team"><option value="">{tr('Team wählen …', 'Choose team …')}</option>{ds.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <button className="btn btn-dark btn-sm" disabled={!v || busy} onClick={() => save(v)}>{busy ? '…' : tr('Setzen', 'Set')}</button>
    </div>
  );
  if (field === 'originalEstimate') return (
    <div className="row" style={{ gap: 6 }}>
      <div className="input-wrap"><input className={`input input-sm num ${hint ? 'fix-preset' : ''}`} type="number" min={0.5} step={0.5} style={{ width: 90, paddingLeft: 10 }} value={v} onChange={(e) => { setV(e.target.value); setHint(false); }} placeholder="h" aria-label={tr('Stunden', 'Hours')} /></div>
      <span className="muted">h</span>
      <button className="btn btn-dark btn-sm" disabled={!(+v > 0) || busy} onClick={() => save(+v)}>{busy ? '…' : tr('Setzen', 'Set')}</button>
    </div>
  );
  if (field === 'tshirt') return (
    <div className="row" style={{ gap: 4 }}>
      {(config.tshirtSizes || []).map((t) => (
        <motion.button key={t.key} whileTap={{ scale: 0.9 }} className={`btn btn-xs ${hint && v === t.key ? 'fix-preset' : ''}`} disabled={busy} title={fmt.h(t.hours)} onClick={() => save(t.key)} style={{ minWidth: 34 }}>{t.key}</motion.button>
      ))}
    </div>
  );
  if (field === 'startDate' || field === 'dueDate') return (
    <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
      <div className="row" style={{ gap: 6 }}>
        <input type="date" className={`input input-sm ${hint ? 'fix-preset' : ''}`} value={v} onChange={(e) => { setV(e.target.value); setHint(false); }} aria-label={usageName(field)} aria-invalid={!!wrongOrder}
          min={field === 'dueDate' && issue?.start ? issue.start : undefined} max={field === 'startDate' && issue?.due ? issue.due : undefined} />
        <button className="btn btn-dark btn-sm" disabled={!v || busy || !!wrongOrder} onClick={() => save(v)}>{busy ? '…' : tr('Setzen', 'Set')}</button>
      </div>
      {wrongOrder ? <span className="fix-wrong" role="alert">{wrongOrder}</span> : presetNote}
    </div>
  );
  if (field === 'targetQuarters') {
    const qs = quartersFrom(computed.model.curQ, 6);
    return (
      <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {qs.map((q) => <button key={q} className={`chip ${v.includes(q) ? 'chip-accent' : 'chip-outline'}`} onClick={() => setV((x) => (x.includes(q) ? x.filter((y) => y !== q) : [...x, q]))} aria-pressed={v.includes(q)}>{fmt.quarter(q)}</button>)}
        <button className="btn btn-dark btn-xs" disabled={!v.length || busy} onClick={() => save(v)}>{busy ? '…' : tr('Setzen', 'Set')}</button>
      </div>
    );
  }
  return null;
}

// One value for many gaps. Each item is saved (and permission-checked) on its own; the result shows
// what worked and what did not, and a single undo reverts every saved item.
function BulkBar({ field, gaps, allPicked, total, onPickAll, onFixed, onUnfixed }) {
  const { fill, ds, config, computed, toast, pushUndo, runUndo } = useApp();
  const [v, setV] = useState(field === 'targetQuarters' ? [] : '');
  const [run, setRun] = useState(null); // { done, total, failed: [{ g, e }] }
  const valid = field === 'originalEstimate' ? +v > 0 : field === 'targetQuarters' ? v.length > 0 : !!v;
  const apply = async () => {
    const value = field === 'originalEstimate' ? +v : v;
    const items = gaps.slice(0, BULK_MAX);
    const ok = [], failed = [];
    setRun({ done: 0, total: items.length, failed });
    // Space-mode items share one storage record, so they are written one after another.
    const width = items.some((g) => target(g, computed.model).ref) ? 1 : 4;
    await inParallel(items, async (g) => {
      try {
        const undo = await fill({ ...target(g, computed.model), usage: field, value, collectUndo: true });
        ok.push({ g, undo });
      } catch (e) { failed.push({ g, e }); }
      setRun({ done: ok.length + failed.length, total: items.length, failed: [...failed] });
    }, width);
    const ids = ok.map((x) => x.g.id);
    onFixed(ids);
    if (ok.length) {
      const entry = pushUndo(tr(`${ok.length} Lücken ergänzt`, `${ok.length} gaps filled`), async () => {
        const undone = [], stuck = [];
        await inParallel(ok, async (x) => { try { await x.undo(); undone.push(x.g.id); } catch (e) { stuck.push(e); } }, width);
        onUnfixed(undone);
        if (stuck.length) throw Object.assign(new Error(tr(`${stuck.length} von ${ok.length} ließen sich nicht zurücksetzen`, `${stuck.length} of ${ok.length} could not be reverted`)), { code: 'PARTIAL' });
      }, ok.map((x) => x.undo.key));
      toast({ text: failed.length ? tr(`${ok.length} gespeichert, ${failed.length} nicht möglich`, `${ok.length} saved, ${failed.length} not possible`) : tr(`${ok.length} in Jira gespeichert`, `${ok.length} saved in Jira`), icon: 'check', error: !!failed.length && !ok.length, undo: () => runUndo(entry) });
    } else if (failed.length) toast({ text: tr('Keine Änderung gespeichert', 'No change saved'), error: true });
    setTimeout(() => setRun((r) => (r && r.failed.length ? r : null)), 1200);
  };
  const busy = run && run.done < run.total;
  return (
    <div className="bulkbar">
      <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" className="pick" checked={!!allPicked} onChange={onPickAll} disabled={busy} />
        <span>{gaps.length ? tr(`${gaps.length} ausgewählt`, `${gaps.length} selected`) : tr(`Alle ${total} auswählen`, `Select all ${total}`)}</span>
      </label>
      <div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <BulkValue field={field} v={v} setV={setV} ds={ds} config={config} model={computed.model} disabled={busy} />
        <button className="btn btn-dark btn-sm" disabled={!gaps.length || !valid || busy} onClick={apply}>
          {busy ? `${run.done} / ${run.total}` : tr(`Für ${gaps.length || '…'} setzen`, `Set for ${gaps.length || '…'}`)}
        </button>
      </div>
      {run && (
        <div className="bulk-progress" style={{ gridColumn: '1 / -1' }}>
          <div className="bulk-track"><motion.div className="bulk-fill" animate={{ width: `${(run.done / Math.max(1, run.total)) * 100}%` }} transition={spring} /></div>
          {run.failed.length > 0 && !busy && (
            <div className="stack" style={{ gap: 4, marginTop: 8, fontSize: 12.5 }}>
              <b style={{ color: 'var(--bad)' }}>{tr(`${run.failed.length} nicht gespeichert:`, `${run.failed.length} not saved:`)}</b>
              {run.failed.slice(0, 6).map(({ g, e }) => <span key={g.id} className="muted">{g.key || g.summary} – {errText(e)}</span>)}
              <button className="btn btn-ghost btn-xs" style={{ alignSelf: 'flex-start' }} onClick={() => setRun(null)}>{tr('Schließen', 'Dismiss')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BulkValue({ field, v, setV, ds, config, model, disabled }) {
  if (field === 'team') return <select className="select select-sm" value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} aria-label="Team"><option value="">{tr('Team wählen …', 'Choose team …')}</option>{ds.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>;
  if (field === 'originalEstimate') return <span className="row" style={{ gap: 6 }}><input className="input input-sm num" type="number" min={0.5} step={0.5} style={{ width: 90 }} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} placeholder="h" aria-label={tr('Stunden je Vorgang', 'Hours per work item')} /><span className="muted">h</span></span>;
  if (field === 'tshirt') return <select className="select select-sm" value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} aria-label="T-Shirt"><option value="">{tr('Größe wählen …', 'Choose size …')}</option>{(config.tshirtSizes || []).map((t) => <option key={t.key} value={t.key}>{t.key} · {fmt.h(t.hours)}</option>)}</select>;
  if (field === 'startDate' || field === 'dueDate') return <input type="date" className="input input-sm" value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} aria-label={field === 'startDate' ? tr('Startdatum', 'Start date') : tr('Fälligkeitsdatum', 'Due date')} />;
  if (field === 'targetQuarters') return <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{quartersFrom(model.curQ, 6).map((q) => <button key={q} type="button" disabled={disabled} className={`chip ${v.includes(q) ? 'chip-accent' : 'chip-outline'}`} onClick={() => setV((x) => (x.includes(q) ? x.filter((y) => y !== q) : [...x, q]))} aria-pressed={v.includes(q)}>{fmt.quarter(q)}</button>)}</span>;
  return null;
}
