import { useId, useState, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { popIn } from '../lib/motion.js';
import { tr } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { openIssue } from '../lib/api.js';
import { Drawer, stagger } from './ui.jsx';
import { useApp, errText } from '../state.jsx';
import { suggestionFor } from '@shared/smart.js';
import { KpiProof, ProofItems, ProofIcon, proofWord, requestProofCard } from './ProofPanel.jsx';

const TONE = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' };

// KPI tiles from the shared registry (shared/kpis.js). Hover or keyboard focus shows how the number is made –
// base, the calculation with the real numbers and the work items behind it. "All details" opens everything;
// a click on the tile jumps to the area.
export function KpiTiles({ kpis, onJump, subject }) {
  const { setView } = useApp();
  const [full, setFull] = useState(null); // { id, check } – check: opened through "Nachprüfen"
  const k = full ? kpis.find((x) => x.id === full.id) : null;
  // the deep page: the independent recount from Jira ("Nachweis"), opening this number's card there
  const deep = k ? () => { requestProofCard(k.id); setFull(null); setView('proof'); } : null;
  return (
    <>
      <div className="kpi-grid">
        {kpis.map((x, i) => <KpiTile key={x.id} k={x} i={i} onJump={onJump} onAll={(check) => setFull({ id: x.id, check: check === true })} />)}
      </div>
      <Drawer open={!!k} onClose={() => setFull(null)} title={k ? `${k.label}: ${k.display}` : ''} sub={subject}>
        {k && <Breakdown key={`${k.id}:${full.check}`} k={k} all check={full.check} onDeep={deep} subject={subject} />}
      </Drawer>
    </>
  );
}

// The story behind one number: definition, calculation with the real numbers, inputs, the work items.
// all: the drawer – everything, plus "Nachprüfen" and, where a row is made of more rows (Reife), expandable rows.
function Breakdown({ k, all, onAll, check = false, onDeep, subject }) {
  const items = k.items || [];
  const expandable = all && (k.proof?.rows || []).some((r) => r.children?.rows?.length);
  return (
    <div className="kpi-breakdown">
      <div className="kpi-pop-def">{k.text}</div>
      <div className="kpi-calc"><span>{tr('Rechnung', 'Calculation')}</span><code>{k.calc}</code></div>
      <dl className="kpi-inputs">{(k.inputs || []).map(([a, b]) => <div key={a}><dt>{a}</dt><dd className="num">{b}</dd></div>)}</dl>
      {all && k.proof && <KpiProof k={k} startOpen={check} onDeep={onDeep} subject={subject} />}
      {items.length > 0 && expandable && (
        <div className="kpi-items">
          <div className="label" style={{ margin: '0 0 6px' }}>{k.itemsTitle} · {items.length}</div>
          <div className="faint" style={{ fontSize: 12, margin: '-2px 0 6px' }}>{tr('Zeile aufklappen: Epics und Stories mit T-Shirt Size, Quarter/s, Original Estimate und offener Größe – jeder Key öffnet Jira.', 'Expand a row: epics and stories with T-shirt size, quarters, original estimate and open size – every key opens Jira.')}</div>
          <ProofItems items={items} proof={k.proof} renderFix={(x) => (x.fix?.usage === 'tshirt' ? <SizeFix fix={x.fix} name={x.text} /> : null)} />
        </div>
      )}
      {items.length > 0 && !expandable && (
        <div className="kpi-items">
          <div className="label" style={{ margin: '0 0 6px' }}>{k.itemsTitle} · {items.length}</div>
          <ul>{(all ? items : items.slice(0, 5)).map((x, j) => (
            <li key={j}><i style={{ background: TONE[x.tone] || 'var(--line-strong)' }} />
              <div>{x.key ? <button type="button" className="linkbtn" onClick={(e) => { e.stopPropagation(); openIssue(x.key); }}>{x.text}</button> : <span>{x.text}</span>}<div className="faint">{x.sub}</div>
                {x.fix?.usage === 'tshirt' && <SizeFix fix={x.fix} name={x.text} />}</div>
            </li>
          ))}</ul>
          {!all && items.length > 5 && (onAll ? <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={(e) => { e.stopPropagation(); onAll(); }}>{tr(`+ ${items.length - 5} weitere – alle zeigen`, `+ ${items.length - 5} more – show all`)}</button> : <div className="faint" style={{ fontSize: 12 }}>{tr(`+ ${items.length - 5} weitere`, `+ ${items.length - 5} more`)}</div>)}
        </div>
      )}
    </div>
  );
}

// Fix it right here: set the missing T-shirt size in one click (saved in Jira with your permissions, undoable).
export function SizeFix({ fix, name }) {
  const { config, fill, toast, runUndo, stale, computed, lang } = useApp();
  const [busy, setBusy] = useState(null);
  const sizes = config?.tshirtSizes || [];
  // The smart suggestion (smallest size covering the stories already estimated), marked on its pill.
  const sug = useMemo(() => {
    if (!computed) return null;
    const m = computed.model;
    const issue = fix.issueId ? m.byId.get(fix.issueId) : null;
    const item = issue ? null : m.items.find((p) => p.ref === fix.ref || (fix.issueId && p.id === fix.issueId));
    if (!issue && !item) return null;
    const g = issue ? { id: `${issue.id}:missing:tshirt`, issueId: issue.id, rootRef: issue.rootRef, field: 'tshirt', rule: 'missing:tshirt', fixable: true }
      : { id: `item:${item.ref}:missing:tshirt`, issueId: `item:${item.ref}`, rootRef: item.ref, isItem: true, field: 'tshirt', rule: 'missing:tshirt', fixable: true };
    return suggestionFor(computed, g, lang);
  }, [computed, fix, lang]);
  if (!sizes.length) return null;
  const pick = async (e, key) => {
    e.stopPropagation();
    setBusy(key);
    try {
      const entry = await fill({ ...fix, value: key, label: `T-Shirt Size · ${name}` });
      toast({ text: tr(`T-Shirt Size ${key} gesetzt – ${name}`, `T-shirt size ${key} set – ${name}`), icon: 'check', undo: () => runUndo(entry) });
    } catch (err) { toast({ text: errText(err), error: true }); } finally { setBusy(null); }
  };
  return (
    <div className="size-fix" role="group" aria-label={tr(`T-Shirt Size für ${name} setzen`, `Set T-shirt size for ${name}`)}>
      <span>{tr('Jetzt setzen:', 'Set now:')}</span>
      {sizes.map((sz) => {
        const hint = sug?.value === sz.key;
        return <button key={sz.key} type="button" className={`size-pill${hint ? ' suggested' : ''}`} disabled={!!busy || stale} aria-busy={busy === sz.key} onClick={(e) => pick(e, sz.key)} title={hint ? `${tr('Vorschlag', 'Suggestion')}: ${sug.why}` : `${sz.key} = ${sz.hours} h`}>{hint && <Icon name="sparkle" size={11} />}<b>{sz.key}</b> {sz.hours} h</button>;
      })}
      {sug && <span className="size-why faint">{tr('Vorschlag', 'Suggestion')} {sug.value}: {sug.why}</span>}
    </div>
  );
}

function KpiTile({ k, i, onJump, onAll }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const n = (k.items || []).length;
  // touch has no hover: a tap opens the full details (with "Nachprüfen") instead of a popover; mouse and keyboard as before
  const touch = useRef(false);
  return (
    <motion.div className="kpi-wrap" {...stagger(i, 0.04)}
      onPointerEnter={(e) => { touch.current = e.pointerType !== 'mouse'; if (!touch.current) setOpen(true); }} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}
      onPointerDown={(e) => { touch.current = e.pointerType !== 'mouse'; }}
      onFocus={(e) => { if (!touch.current && e.target.matches?.(':focus-visible')) setOpen(true); }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      <button type="button" className={`kpi ${k.hot ? 'hot' : ''}`} onClick={() => { if (touch.current) { setOpen(false); onAll(); } else onJump?.(k.area); }} aria-describedby={open ? id : undefined}
        aria-label={`${k.label}: ${k.display}. ${k.foot}. ${tr('Rechnung', 'Calculation')}: ${k.calc}`}>
        <span className="kpi-head"><span className="kpi-label">{k.label}</span><span className="kpi-icon" aria-hidden="true"><Icon name={k.icon} size={15} /></span></span>
        <span className="kpi-value num">{k.display}</span>
        <span className="kpi-foot">{k.foot}</span>
      </button>
      {/* enter only – closing unmounts at once (exits stall in the Jira frame) */}
      {open && (
          <motion.div id={id} role="tooltip" className={`kpi-pop ${i % 7 >= 4 ? 'right' : ''}`} {...popIn()}>
            <Breakdown k={k} onAll={() => { setOpen(false); onAll(); }} />
            <div className="kpi-hint">
              <button type="button" className="linkbtn" onClick={(e) => { e.stopPropagation(); setOpen(false); onAll(); }}>{tr('Alle Details', 'All details')}{n ? ` (${n})` : ''} <Icon name="arrowRight" size={12} /></button>
              {k.proof && <button type="button" className="linkbtn" onClick={(e) => { e.stopPropagation(); setOpen(false); onAll(true); }}><ProofIcon size={12} />{proofWord()}</button>}
              <span>{tr('Klick auf die Kachel: zum Bereich', 'Click the tile: go to the area')}</span>
            </div>
          </motion.div>
      )}
    </motion.div>
  );
}

// Legend: the definitions, each with the live calculation for what is on screen.
export function Legend({ open, onClose, title, sub, defs, kpis, subject }) {
  const live = new Map((kpis || []).map((k) => [k.id, k]));
  const general = tr('Kennzahlen', 'Key figures');
  const sections = [...new Set(defs.map((d) => d.section || general))];
  return (
    <Drawer open={open} onClose={onClose} title={title} sub={sub}>
      <div className="legend">
        {sections.map((s) => (
          <section key={s}>
            <h3>{s}</h3>
            <dl>{defs.filter((d) => (d.section || general) === s).map((d) => {
              const k = live.get(d.id);
              return (
                <div key={d.id} className="legend-row">
                  <dt>{d.label}</dt>
                  <dd>{d.text}{k && <div className="legend-live"><span>{subject}</span><code>{k.calc}</code></div>}</dd>
                </div>
              );
            })}</dl>
          </section>
        ))}
      </div>
    </Drawer>
  );
}
