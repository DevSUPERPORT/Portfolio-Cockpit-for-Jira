// "Nachweis": every number with its proof – what it means and which decision it supports, where it comes from
// and who owns that data, and whether it is right: an independent recount straight from Jira, how complete the
// data contract is, and how well past forecasts matched reality.
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { metricCards, DATA_CONTRACT, OWNERS } from '@shared/metricCards.js';
import { projectKpis } from '@shared/kpis.js';
import { capacityPeople, roughUnits } from '@shared/engine.js';
import { useApp } from '../state.jsx';
import { tr, fmt, usageName, ruleName } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { crossCheck, compare, CHECKS } from '../lib/crosscheck.js';
import { forecastAccuracy } from '../lib/accuracy.js';
import { openIssue, call } from '../lib/api.js';
import { Drawer, Empty, Ring, useTip, stagger, spring } from '../components/ui.jsx';
import { KpiProof, takeProofCard } from '../components/ProofPanel.jsx';

const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export default function Proof() {
  const { computed, ds, config, lang } = useApp();
  const cards = useMemo(() => metricCards(lang, config), [lang, config]);
  const contract = useMemo(() => dataContract(computed, ds, config), [computed, ds, config]);
  const [check, setCheck] = useState(null); // { running, done, total, name, result }
  const [acc, setAcc] = useState(null);
  // a KPI drawer's "Nachprüfen" sent the person here: open that number's card at once
  const [card, setCard] = useState(() => { const id = takeProofCard(); return id ? metricCards(lang, config).find((c) => c.id === id) || null : null; });
  const runCheck = async () => {
    setCheck({ running: true, done: 0, total: ds.portfolio.length });
    try {
      const jira = await crossCheck(ds, { onProgress: (d, t, name) => setCheck((c) => ({ ...c, done: d, total: t, name })) });
      setCheck({ running: false, result: compare(computed, jira), at: new Date() });
    } catch (e) { setCheck({ running: false, error: e.message }); }
  };
  const runAcc = async () => {
    setAcc({ running: true, done: 0, total: 0 });
    try { const r = await forecastAccuracy(ds, { onProgress: (d, t) => setAcc((a) => ({ ...a, done: d, total: t })) }); setAcc({ running: false, result: r }); }
    catch (e) { setAcc({ running: false, error: e.message }); }
  };
  const res = check?.result;
  const nCells = res ? res.reduce((a, r) => a + r.cells.length, 0) : 0, nOk = res ? res.reduce((a, r) => a + r.cells.filter((c) => c.match).length, 0) : 0;
  const contractScore = contract.rows.filter((r) => r.rate != null).reduce((a, r, _, xs) => a + r.rate / xs.length, 0);
  const ar = acc?.result;
  return (
    <div className="page">
      <section className="card proof-hero">
        <div className="proof-hero-text">
          <span className="eyebrow">{tr('Nachweis', 'Proof')}</span>
          <h1 className="h1">{tr('Jede Zahl mit Beweis', 'Every number with its proof')}</h1>
          <p className="muted">{tr('Was eine Zahl bedeutet und welche Entscheidung sie stützt, woher sie kommt und wer die Daten pflegt – und ob sie stimmt: unabhängig nachgezählt in Jira, am Datenvertrag gemessen und an der Wirklichkeit geprüft.', 'What a number means and which decision it supports, where it comes from and who maintains the data – and whether it is right: recounted independently in Jira, measured against the data contract and checked against reality.')}</p>
        </div>
        <div className="seals">
          <Seal i={0} icon="check" title={tr('Gegenprobe mit Jira', 'Cross-check with Jira')} onClick={() => go('proof-check')}
            state={check?.running ? 'run' : res ? (nOk === nCells ? 'ok' : 'warn') : check?.error ? 'warn' : 'idle'}
            value={check?.running ? `${check.done} / ${check.total}` : res ? `${nOk} / ${nCells}` : '–'}
            sub={check?.running ? tr(`zähle ${check.name || ''} …`, `counting ${check.name || ''} …`) : res ? (nOk === nCells ? tr('Werte stimmen mit Jira überein', 'values match Jira') : tr(`${nCells - nOk} Abweichungen – unten erklärt`, `${nCells - nOk} differences – explained below`)) : tr('noch nicht geprüft', 'not checked yet')}
            ring={check?.running ? check.done / Math.max(1, check.total) : res ? nOk / Math.max(1, nCells) : 0}
            action={!check?.running && <button type="button" className="btn btn-dark btn-sm" onClick={(e) => { e.stopPropagation(); runCheck(); }}>{res ? tr('Erneut prüfen', 'Check again') : tr('Jetzt prüfen', 'Check now')}</button>} />
          <Seal i={1} icon="shield" title={tr('Datenvertrag', 'Data contract')} onClick={() => go('proof-contract')}
            state={contractScore >= 0.9 ? 'ok' : 'warn'} value={fmt.pct(contractScore)} ring={contractScore}
            sub={contract.worst ? tr(`schwächstes Feld: ${contract.worst.label} (${fmt.pct(contract.worst.rate)})`, `weakest field: ${contract.worst.label} (${fmt.pct(contract.worst.rate)})`) : tr('alle Felder gepflegt', 'all fields maintained')} />
          <Seal i={2} icon="target" title={tr('Treffsicherheit', 'Accuracy')} onClick={() => go('proof-accuracy')}
            state={acc?.running ? 'run' : ar ? (ar.n >= 10 ? 'ok' : 'warn') : 'idle'}
            value={acc?.running ? `${acc.done} / ${acc.total || '…'}` : ar?.n ? `±${fmt.pct(ar.forecast.mape)}` : '–'}
            sub={acc?.running ? tr('lese Jira-Historie …', 'reading Jira history …') : ar ? (ar.n ? tr(`Prognose zur Halbzeit, ${ar.n} Stories`, `forecast at half-time, ${ar.n} stories`) : tr('noch keine auswertbaren Stories', 'no stories to evaluate yet')) : tr('Prognosen gegen Ergebnis', 'forecasts against outcome')}
            ring={acc?.running ? acc.done / Math.max(1, acc.total) : ar?.n ? Math.max(0, 1 - ar.forecast.mape) : 0}
            action={!acc?.running && <button type="button" className="btn btn-sm" onClick={(e) => { e.stopPropagation(); runAcc(); }}>{ar ? tr('Neu rechnen', 'Recompute') : tr('Nachrechnen', 'Compute')}</button>} />
        </div>
      </section>

      <CheckSection check={check} res={res} onRun={runCheck} />

      <section className="card" id="proof-cards">
        <div className="card-head">
          <div>
            <h2 className="card-title"><Icon name="layers" />{tr('Kennzahlen-Karten', 'Metric cards')} <span className="chip num">{cards.length}</span></h2>
            <div className="card-sub" style={{ marginTop: 3 }}>{tr('Je Zahl: welche Entscheidung sie stützt, die Formel, wer die Daten pflegt, Randfälle und wie du sie selbst prüfst.', 'Per number: which decision it supports, the formula, who maintains the data, edge cases and how to check it yourself.')}</div>
          </div>
        </div>
        <div className="mc-grid">
          {cards.map((c, i) => (
            <motion.button key={c.id} type="button" className="mc" {...stagger(i, 0.025)} whileHover={{ y: -2 }} onClick={() => setCard(c)}>
              <span className="mc-top"><span className="mc-ico"><Icon name={c.icon} size={15} /></span><b>{c.label}</b></span>
              <span className="mc-q">{c.question}</span>
              <code className="mc-f">{c.formula}</code>
              <span className="mc-more">{tr('Karte öffnen', 'Open card')} <Icon name="arrowRight" size={12} /></span>
            </motion.button>
          ))}
        </div>
      </section>

      <ContractSection contract={contract} />
      <AccuracySection acc={acc} onRun={runAcc} />
      <HistoryBlock />
      <CardDrawer card={card} onClose={() => setCard(null)} />
    </div>
  );
}

function Seal({ i, icon, title, value, sub, state, ring, action, onClick }) {
  const color = state === 'ok' ? 'var(--ok)' : state === 'warn' ? 'var(--accent)' : 'var(--ink)';
  return (
    // the seal's main area jumps to its section; its action is a separate, sibling button (no button inside a button)
    <motion.div className={`seal ${state}`} {...stagger(i, 0.06)}>
      <button type="button" className="seal-link" onClick={onClick} aria-label={`${title}: ${value} – ${sub}`}>
        <Ring value={ring} size={58} stroke={5} color={color}><Icon name={state === 'ok' ? 'check' : state === 'warn' ? 'alert' : icon} size={18} /></Ring>
        <span className="seal-body">
          <span className="seal-title">{title}</span>
          <b className="seal-value num">{value}</b>
          <span className="seal-sub">{sub}</span>
        </span>
      </button>
      {action && <div className="seal-act">{action}</div>}
    </motion.div>
  );
}

function CheckSection({ check, res, onRun }) {
  const { computed } = useApp();
  const tip = useTip();
  const name = (ref) => computed.model.itemByRef.get(ref)?.name || ref;
  const show = (v, unit) => (v == null ? '–' : unit === 'h' ? fmt.h(v) : String(v));
  return (
    <section className="card" id="proof-check">
      <div className="card-head">
        <div>
          <h2 className="card-title"><Icon name="check" />{tr('Gegenprobe mit Jira', 'Cross-check with Jira')}</h2>
          <div className="card-sub" style={{ marginTop: 3, maxWidth: 860 }}>{tr('Zählt die Kernzahlen jedes Projekts direkt in Jira nach – mit eigener Abfrage und eigener Summe, ohne den Rechenkern des Cockpits. Stimmen beide überein, ist die Zahl richtig; sonst stehen beide Werte nebeneinander. Lesend, mit deinen Rechten.', 'Recounts each project\'s core numbers directly in Jira – with its own query and its own sum, without the cockpit\'s engine. If both agree the number is right; otherwise both values are shown side by side. Read-only, with your permissions.')}</div>
        </div>
        {!check?.running && <button type="button" className="btn btn-dark btn-sm" onClick={onRun}><Icon name="refresh" size={13} />{res ? tr('Erneut prüfen', 'Check again') : tr('Jetzt prüfen', 'Check now')}</button>}
      </div>
      {check?.running && <div className="card-pad"><div className="bulk-track"><motion.div className="bulk-fill" animate={{ width: `${(check.done / Math.max(1, check.total)) * 100}%` }} transition={spring} /></div><div className="faint" style={{ marginTop: 8, fontSize: 12.5 }}>{tr(`Projekt ${Math.min(check.done + 1, check.total)} von ${check.total}: ${check.name || ''}`, `Project ${Math.min(check.done + 1, check.total)} of ${check.total}: ${check.name || ''}`)}</div></div>}
      {check?.error && <div className="card-pad"><div className="callout accent"><Icon name="alert" />{check.error}</div></div>}
      {!check && <Empty icon="check" title={tr('Noch nicht geprüft', 'Not checked yet')} action={<button type="button" className="btn btn-dark" onClick={onRun}>{tr('Gegenprobe starten', 'Start the cross-check')}</button>}>{tr('Dauert je Projekt ein bis zwei Sekunden.', 'Takes a second or two per project.')}</Empty>}
      {res && (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Gegenprobe, mit Pfeiltasten scrollbar', 'Cross-check, scrollable with arrow keys')}>
          <table className="table proof-table">
            <thead><tr><th>{tr('Projekt', 'Project')}</th>{CHECKS.map((c) => <th key={c.key} className="num">{tr(c.label[0], c.label[1])}</th>)}<th>{tr('Ergebnis', 'Result')}</th></tr></thead>
            <tbody>
              {res.map((r, k) => (
                <motion.tr key={r.ref} {...stagger(k, 0.03)}>
                  <td><b style={{ fontWeight: 560 }}>{name(r.ref)}</b></td>
                  {r.cells.length ? r.cells.map((c) => {
                    const unit = CHECKS.find((x) => x.key === c.key).unit;
                    return <td key={c.key} className="num">{c.match
                      ? <span className="pc ok" {...tip(<div>{tr('Cockpit und Jira', 'Cockpit and Jira')}: {show(c.app, unit)}</div>)}><Icon name="check" size={12} />{show(c.app, unit)}</span>
                      : <span className="pc bad" {...tip(<div>{tr('Cockpit', 'Cockpit')} {show(c.app, unit)} · Jira {show(c.jira, unit)}</div>)}>{show(c.app, unit)} <span className="faint">≠ {show(c.jira, unit)}</span></span>}</td>;
                  }) : <td colSpan={CHECKS.length} className="faint">{r.error}</td>}
                  <td>{r.ok ? <span className="chip chip-ok"><Icon name="check" size={12} />{tr('stimmt', 'matches')}</span> : <span className="chip chip-accent">{tr('prüfen', 'review')}</span>}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res && <div className="faint" style={{ fontSize: 12, padding: '10px 20px 14px' }}>{tr('Stories = Vorgangstypen der Ebene „Schätzung“ unter dem Projekt (bis 6 Ebenen tief). Stunden = Jira-Summen der Story inklusive Sub-tasks; Remaining nur offener Stories. Blocked = offene Stories und Sub-tasks im konfigurierten Status. Toleranz: 0,5 h.', 'Stories = issue types of the "estimate" level below the project (up to 6 levels deep). Hours = Jira totals of the story including sub-tasks; remaining only of open stories. Blocked = open stories and sub-tasks in the configured status. Tolerance: 0.5 h.')}</div>}
    </section>
  );
}

// How completely the data contract is kept: per field and level, the share of work items that carry the value.
function dataContract(computed, ds, config) {
  const { model } = computed;
  const open = (i) => (i.status?.cat ?? i.statusCat) !== 'done';
  const items = model.items.filter((p) => (p.statusCat ?? 'new') !== 'done');
  const rough = items.flatMap((p) => roughUnits(model, p));
  const stories = (ds.issues || []).filter((i) => i.role === 'estimate');
  const openStories = stories.filter(open);
  const rhythm = config.rules?.healthRhythmDays || 7;
  const people = [...capacityPeople(model).values()];
  const rate = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null);
  const val = {
    'owner|project': [items, (p) => !!p.owner],
    'health|project': [items, (p) => p.health?.at && (Date.now() - Date.parse(p.health.at)) / 864e5 <= rhythm],
    'tshirt|rough': [rough, (u) => !!u.tshirt],
    'targetQuarters|rough': [rough, (u) => (u.quarters || []).length > 0],
    'team|rough': [rough, (u) => !!u.team],
    'team|estimate': [openStories, (s) => !!s.team],
    'originalEstimate|estimate': [stories, (s) => s.oe > 0],
    'startDate|estimate': [openStories, (s) => !!s.start],
    'dueDate|estimate': [openStories, (s) => !!s.due],
    'remaining|estimate': [openStories.filter((s) => s.oe > 0 && s.ts > 0), (s) => s.re > 0],
    'worklog|estimate': [stories.filter((s) => !open(s)), (s) => s.ts > 0],
    'capacity|person': [people, (p) => !p.derived],
  };
  const levelName = { project: tr('Projekt', 'Project'), rough: 'Epic', estimate: 'Story', person: tr('Person', 'Person') };
  const why = {
    'remaining|estimate': tr('offene Stories mit Buchungen, deren Remaining > 0 ist', 'open stories with bookings whose remaining > 0'),
    'worklog|estimate': tr('erledigte Stories mit Time Spent', 'done stories with time spent'),
    'capacity|person': tr('Personen mit gepflegter Kapazität (statt 40 h angenommen)', 'people with maintained capacity (instead of an assumed 40 h)'),
    'health|project': tr(`Health jünger als ${rhythm} Tage`, `health younger than ${rhythm} days`),
  };
  const rows = DATA_CONTRACT.map(([field, label, level, owner, when]) => {
    const k = `${field}|${level}`;
    const v = val[k];
    const n = v ? v[0].length : 0;
    return { k, field, label: Array.isArray(label) ? tr(label[0], label[1]) : label, level: levelName[level] || level, owner: tr(OWNERS[owner][0], OWNERS[owner][1]), when: tr(when[0], when[1]), n, rate: v ? rate(v[0], v[1]) : null, why: why[k] || null };
  });
  const scored = rows.filter((r) => r.rate != null && r.n > 0);
  return { rows, worst: scored.length ? scored.reduce((a, b) => (b.rate < a.rate ? b : a)) : null };
}

function ContractSection({ contract }) {
  return (
    <section className="card" id="proof-contract">
      <div className="card-head">
        <div>
          <h2 className="card-title"><Icon name="shield" />{tr('Datenvertrag', 'Data contract')}</h2>
          <div className="card-sub" style={{ marginTop: 3, maxWidth: 860 }}>{tr('Wer welches Feld wann pflegt – und wie gut das gerade klappt. Die meisten „falschen Zahlen“ sind fehlende Daten: hier sieht man, wo.', 'Who maintains which field when – and how well that works right now. Most "wrong numbers" are missing data: this shows where.')}</div>
        </div>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Datenvertrag, mit Pfeiltasten scrollbar', 'Data contract, scrollable with arrow keys')}>
        <table className="table">
          <thead><tr><th>{tr('Feld', 'Field')}</th><th>{tr('Ebene', 'Level')}</th><th>{tr('Verantwortlich', 'Owner')}</th><th>{tr('Wann', 'When')}</th><th style={{ minWidth: 200 }}>{tr('Erfüllt', 'Kept')}</th></tr></thead>
          <tbody>
            {contract.rows.map((r, k) => (
              <motion.tr key={r.k} {...stagger(k, 0.02)}>
                <td><b style={{ fontWeight: 560 }}>{r.label}</b>{r.why && <div className="faint" style={{ fontSize: 11.5 }}>{r.why}</div>}</td>
                <td>{r.level}</td><td>{r.owner}</td><td className="muted">{r.when}</td>
                <td>{r.rate == null ? <span className="faint">{tr('immer vorhanden', 'always present')}</span> : r.n === 0 ? <span className="faint">{tr('nichts zu prüfen', 'nothing to check')}</span> : (
                  <div className="ct-bar"><div className="ct-track"><motion.span initial={{ width: 0 }} animate={{ width: `${r.rate * 100}%` }} transition={{ duration: 0.8, delay: k * 0.03, ease: [0.16, 1, 0.3, 1] }} style={{ background: r.rate >= 0.9 ? 'var(--ok)' : r.rate >= 0.7 ? 'var(--warn)' : 'var(--accent)' }} /></div><b className="num">{fmt.pct(r.rate)}</b><span className="faint num">{tr(`von ${r.n}`, `of ${r.n}`)}</span></div>
                )}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AccuracySection({ acc, onRun }) {
  const { computed } = useApp();
  const tip = useTip();
  const r = acc?.result;
  const pctS = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.round(Math.abs(v) * 100)} %`;
  const W = 640, H = 120, X = (e) => W / 2 + Math.max(-1, Math.min(1, e)) * (W / 2 - 16);
  return (
    <section className="card" id="proof-accuracy">
      <div className="card-head">
        <div>
          <h2 className="card-title"><Icon name="target" />{tr('Treffsicherheit der Prognose', 'Forecast accuracy')}</h2>
          <div className="card-sub" style={{ marginTop: 3, maxWidth: 860 }}>{tr('Für erledigte Stories aus der Jira-Historie nachgerechnet: Was hätte die Prognose (Time Spent + Remaining) zur Halbzeit gesagt – und was hat die Story am Ende gekostet? Daneben der Plan (Original Estimate). Nichts wird geschätzt: Stories ohne Historie fallen heraus.', 'Recomputed for finished stories from the Jira history: what would the forecast (time spent + remaining) have said at half-time – and what did the story cost in the end? Next to it the plan (original estimate). Nothing is guessed: stories without history are left out.')}</div>
        </div>
        {!acc?.running && <button type="button" className="btn btn-sm" onClick={onRun}><Icon name="refresh" size={13} />{r ? tr('Neu rechnen', 'Recompute') : tr('Nachrechnen', 'Compute')}</button>}
      </div>
      {!acc && <Empty icon="target" title={tr('Noch nicht nachgerechnet', 'Not computed yet')} action={<button type="button" className="btn btn-dark" onClick={onRun}>{tr('Prognosen nachrechnen', 'Recompute forecasts')}</button>}>{tr('Liest die Historie von bis zu 120 erledigten Stories.', 'Reads the history of up to 120 finished stories.')}</Empty>}
      {acc?.running && <div className="card-pad"><div className="bulk-track"><motion.div className="bulk-fill" animate={{ width: `${(acc.done / Math.max(1, acc.total)) * 100}%` }} transition={spring} /></div></div>}
      {acc?.error && <div className="card-pad"><div className="callout accent"><Icon name="alert" />{acc.error}</div></div>}
      {r && (r.n === 0 ? (
        <Empty icon="info" title={tr('Noch keine auswertbaren Stories', 'No stories to evaluate yet')}>{tr(`${r.candidates} erledigte Stories mit Original Estimate und Buchungen gefunden; keine hat genug Historie (Buchungen über mehrere Tage und Remaining-Änderungen). Die Auswertung wächst mit jeder erledigten Story.`, `${r.candidates} finished stories with an original estimate and bookings found; none has enough history (bookings over several days and remaining changes). The evaluation grows with every finished story.`)}</Empty>
      ) : (
        <div className="card-pad stack" style={{ gap: 16 }}>
          <div className="acc-duel">
            <div className="acc-side"><span className="eyebrow">{tr('Plan (Original Estimate)', 'Plan (original estimate)')}</span><b className="num">±{fmt.pct(r.plan.mape)}</b><span className="faint">{tr('im Median daneben', 'off in the median')} · {tr('Tendenz', 'bias')} {pctS(r.plan.bias)}</span></div>
            <div className="acc-vs">vs.</div>
            <div className="acc-side hl"><span className="eyebrow">{tr('Prognose zur Halbzeit', 'Forecast at half-time')}</span><b className="num">±{fmt.pct(r.forecast.mape)}</b><span className="faint">{tr('im Median daneben', 'off in the median')} · {tr('Tendenz', 'bias')} {pctS(r.forecast.bias)}</span></div>
          </div>
          <div className={`callout ${r.n < 10 ? 'accent' : ''}`}><Icon name={r.n < 10 ? 'alert' : 'info'} />{r.n < 10
            ? tr(`Erst ${r.n} Stories auswertbar – zu wenige für eine belastbare Aussage. Die Zahl wird mit jeder erledigten Story aussagekräftiger.`, `Only ${r.n} stories can be evaluated – too few for a reliable statement. The number gets more meaningful with every finished story.`)
            : tr(`In ${r.forecastBetter} von ${r.n} Stories lag die Prognose zur Halbzeit näher am Ergebnis als der Plan. Negative Tendenz = unterschätzt.`, `In ${r.forecastBetter} of ${r.n} stories the half-time forecast was closer to the outcome than the plan. Negative bias = underestimated.`)}</div>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={tr('Abweichung je Story: Plan oben, Prognose unten; Mitte = genau getroffen', 'Deviation per story: plan at the top, forecast below; centre = exact')}>
            <line x1={W / 2} x2={W / 2} y1={8} y2={H - 18} stroke="var(--line-strong)" strokeDasharray="3 3" />
            <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">{tr('genau', 'exact')}</text>
            <text x={16} y={H - 4} fontSize="10.5" fill="var(--ink-3)">−100 %</text>
            <text x={W - 16} y={H - 4} textAnchor="end" fontSize="10.5" fill="var(--ink-3)">+100 %</text>
            <text x={4} y={30} fontSize="10.5" fill="var(--ink-2)">Plan</text>
            <text x={4} y={72} fontSize="10.5" fill="var(--ink-2)">{tr('Prognose', 'Forecast')}</text>
            {r.rows.map((s) => (
              <g key={s.id}>
                <circle cx={X(s.errPlan)} cy={34} r={5} fill="var(--ink-3)" opacity="0.55" {...tip(<div><b>{s.key}</b> · Plan {fmt.h(s.oe)} · {tr('Ergebnis', 'outcome')} {fmt.h(s.final)} ({pctS(s.errPlan)})</div>)} />
                <circle cx={X(s.errForecast)} cy={76} r={5} fill="var(--accent)" opacity="0.75" {...tip(<div><b>{s.key}</b> · {tr('Prognose am', 'forecast on')} {fmt.date(s.mid)}: {fmt.h(s.spent)} + {fmt.h(s.re)} = {fmt.h(s.forecast)} · {tr('Ergebnis', 'outcome')} {fmt.h(s.final)} ({pctS(s.errForecast)})</div>)} />
              </g>
            ))}
          </svg>
          <div className="table-scroll"><table className="table">
            <thead><tr><th>Story</th><th className="num">Plan</th><th className="num">{tr('Prognose zur Halbzeit', 'Forecast at half-time')}</th><th className="num">{tr('Ergebnis', 'Outcome')}</th></tr></thead>
            <tbody>{[...r.rows].sort((a, b) => Math.abs(b.errForecast) - Math.abs(a.errForecast)).slice(0, 8).map((s) => (
              <tr key={s.id}><td><button type="button" className="tkey" onClick={() => openIssue(s.key)}>{s.key}</button> {s.summary}<div className="faint" style={{ fontSize: 11.5 }}>{computed.model.itemByRef.get(s.rootRef)?.name}</div></td>
                <td className="num">{fmt.h(s.oe)} <span className="faint">{pctS(s.errPlan)}</span></td><td className="num">{fmt.h(s.forecast)} <span className="faint">{pctS(s.errForecast)}</span></td><td className="num"><b>{fmt.h(s.final)}</b></td></tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}
    </section>
  );
}

// The cockpit's own daily record: how each project's forecast (time spent + remaining) moved over the days.
// A forecast that keeps jumping is the earliest sign of an unreliable estimate. Report group only (recorded as the app).
function HistoryBlock() {
  const { roles, computed } = useApp();
  const tip = useTip();
  const [hist, setHist] = useState(null);
  useEffect(() => { if (roles.viewReport) call('history.get').then(setHist).catch(() => setHist({})); }, [roles.viewReport]);
  if (!roles.viewReport || !hist) return null;
  const days = Object.keys(hist).sort();
  const refs = [...computed.model.items].sort((a, b) => a.rank - b.rank).filter((p) => days.some((d) => hist[d][p.ref]));
  return (
    <section className="card" id="proof-history">
      <div className="card-head">
        <div>
          <h2 className="card-title"><Icon name="history" />{tr('Aufzeichnung der Prognosen', 'Forecast record')}</h2>
          <div className="card-sub" style={{ marginTop: 3, maxWidth: 860 }}>{days.length
            ? tr(`Das Cockpit hält jeden Tag die Kernzahlen jedes Projekts fest – seit ${fmt.date(days[0])}, ${days.length} ${days.length === 1 ? 'Tag' : 'Tage'}. Daraus wird sichtbar, wie stabil eine Prognose ist und ob die Warnungen recht behalten.`, `The cockpit records each project's core numbers every day – since ${fmt.date(days[0])}, ${days.length} ${days.length === 1 ? 'day' : 'days'}. This shows how stable a forecast is and whether the warnings turn out right.`)
            : tr('Die Aufzeichnung startet mit dem nächsten täglichen Lauf.', 'Recording starts with the next daily run.')}</div>
        </div>
      </div>
      {days.length < 2 ? (
        <div className="card-pad"><div className="callout"><Icon name="info" />{tr('Ab dem zweiten aufgezeichneten Tag erscheint hier je Projekt der Verlauf der Prognose.', 'From the second recorded day, each project\'s forecast history appears here.')}</div></div>
      ) : (
        <div className="hist-grid">
          {refs.map((p) => {
            const pts = days.map((d) => hist[d][p.ref]).map((v) => (v ? { fc: v[1] + v[2], oe: v[0] } : null));
            const vals = pts.filter(Boolean);
            const lo = Math.min(...vals.map((v) => Math.min(v.fc, v.oe))), hi = Math.max(...vals.map((v) => Math.max(v.fc, v.oe)), lo + 1);
            const W = 220, Hh = 54, x = (k) => (k / Math.max(1, days.length - 1)) * (W - 8) + 4, y = (v) => Hh - 6 - ((v - lo) / (hi - lo)) * (Hh - 12);
            const line = (key) => pts.map((v, k) => (v ? `${x(k)},${y(v[key])}` : null)).filter(Boolean).join(' ');
            const fcs = vals.map((v) => v.fc);
            const swing = fcs.length ? (Math.max(...fcs) - Math.min(...fcs)) / Math.max(1, fcs[fcs.length - 1]) : 0;
            return (
              <div key={p.ref} className="hist-card">
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><b>{p.rank}. {p.name}</b><span className={`chip ${swing > 0.15 ? 'chip-accent' : 'chip-outline'}`} style={{ height: 22 }} {...tip(<div>{tr('Schwankung der Prognose im aufgezeichneten Zeitraum (höchste − niedrigste) ÷ aktuelle Prognose', 'Swing of the forecast over the recorded period (highest − lowest) ÷ current forecast')}</div>)}>±{fmt.pct(swing)}</span></div>
                <svg viewBox={`0 0 ${W} ${Hh}`} width="100%" height={Hh} role="img" aria-label={tr(`Prognose und Original Estimate von ${p.name} über ${days.length} Tage`, `Forecast and original estimate of ${p.name} over ${days.length} days`)}>
                  <polyline points={line('oe')} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="3 3" />
                  <polyline points={line('fc')} fill="none" stroke="var(--accent)" strokeWidth="2" />
                </svg>
                <div className="faint" style={{ fontSize: 11.5 }}>{tr('Prognose', 'Forecast')} {fmt.h(fcs[fcs.length - 1] || 0)} · <span style={{ borderBottom: '1.5px dashed var(--ink-3)' }}>Original Estimate</span> {fmt.h(vals[vals.length - 1]?.oe || 0)}</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CardDrawer({ card, onClose }) {
  const { computed, lang, ds } = useApp();
  const ranked = useMemo(() => [...ds.portfolio].sort((a, b) => a.rank - b.rank), [ds.portfolio]);
  const [ref, setRef] = useState(null);
  const [copied, setCopied] = useState(false);
  const pref = ref || ranked[0]?.ref;
  const live = useMemo(() => {
    if (!card || card.area !== 'project' || !pref) return null;
    return projectKpis({ computed, ref: pref, lang, fmt, people: ds.people || {}, usageName, ruleName }).find((k) => k.id === card.id) || null;
  }, [card, pref, computed, lang, ds.people]);
  return (
    <Drawer open={!!card} onClose={onClose} title={card?.label} sub={card?.question}>
      {card && (
        <div className="stack mc-detail" style={{ gap: 18 }}>
          <div><div className="eyebrow">{tr('Entscheidung', 'Decision')}</div><p style={{ margin: '4px 0 0' }}>{card.question}</p><p className="faint" style={{ margin: '2px 0 0', fontSize: 12.5 }}>{tr('Entscheidet', 'Decided by')}: {card.decider}</p></div>
          <div><div className="eyebrow">{tr('Formel', 'Formula')}</div><code className="mc-f big">{card.formula}</code></div>
          {card.area === 'project' && (
            <div>
              <div className="eyebrow row" style={{ justifyContent: 'space-between' }}>{tr('Live mit echten Zahlen', 'Live with real numbers')}
                <select className="select select-sm" value={pref || ''} onChange={(e) => setRef(e.target.value)} aria-label={tr('Projekt', 'Project')}>{ranked.map((p) => <option key={p.ref} value={p.ref}>{p.rank}. {p.name}</option>)}</select>
              </div>
              {/* enter only – no exit animations (they stall in the Jira frame) */}
              {live && <motion.div key={pref} className="mc-live" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                <b className="num">{live.display}</b><span>{live.foot}</span><code>{live.calc}</code>
                {(live.inputs || []).length > 0 && <div className="tt-grid" style={{ marginTop: 6 }}>{live.inputs.flatMap(([k, v]) => [<span key={`k${k}`}>{k}</span>, <span key={`v${k}`} className="num">{v}</span>])}</div>}
              </motion.div>}
              {live?.proof && <div style={{ marginTop: 10 }}><KpiProof key={`${pref}:${card.id}`} k={live} startOpen subject={ranked.find((p) => p.ref === pref)?.name} /></div>}
            </div>
          )}
          <div><div className="eyebrow">{tr('Quellen und wer sie pflegt', 'Sources and who maintains them')}</div>
            <ul className="mc-list">{card.sources.map(([f, o]) => <li key={f}><b>{f}</b><span className="faint">{o}</span></li>)}</ul></div>
          <div><div className="eyebrow">{tr('Randfälle', 'Edge cases')}</div><ul className="mc-list">{card.edges.map((e) => <li key={e}>{e}</li>)}</ul></div>
          <div><div className="eyebrow">{tr('Schwellen', 'Thresholds')}</div><p style={{ margin: '4px 0 0' }}>{card.thresholds}</p></div>
          <div><div className="eyebrow">{tr('Selbst prüfen – ohne diese App', 'Check it yourself – without this app')}</div>
            <div className="mc-verify"><code>{card.verify}</code><button type="button" className="btn btn-xs" onClick={() => { navigator.clipboard?.writeText(card.verify).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? tr('Kopiert', 'Copied') : tr('Kopieren', 'Copy')}</button></div></div>
        </div>
      )}
    </Drawer>
  );
}
