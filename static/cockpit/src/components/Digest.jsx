import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { enter, layoutT, tween } from '../lib/motion.js';
import { digestDiff, digestSummary } from '@shared/digest.js';
import { useApp } from '../state.jsx';
import { tr, fmt, healthName } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';

const WL = () => ({ ok: tr('besetzbar', 'staffable'), partial: tr('teilweise', 'partly staffable'), no: tr('nicht besetzbar', 'not staffable') });
const KIND_ICON = { rank: 'ranking', health: 'heart', waterline: 'waves', due: 'calendar', progress: 'gauge', done: 'check' };

function describe(c) {
  const wl = WL();
  switch (c.kind) {
    case 'rank': return tr(`Rang ${c.from} → ${c.to}`, `Rank ${c.from} → ${c.to}`);
    case 'health': return `${c.from ? healthName(c.from) : tr('kein Update', 'no update')} → ${healthName(c.to)}`;
    case 'waterline': return `${wl[c.from]} → ${wl[c.to]}`;
    case 'due': return `${tr('Termin', 'Due')} ${c.from ? fmt.date(c.from) : '–'} → ${c.to ? fmt.date(c.to) : tr('offen', 'none')}`;
    case 'progress': return `${tr('Fortschritt', 'Progress')} ${fmt.pct(c.from)} → ${fmt.pct(c.to)}`;
    case 'done': return tr('abgeschlossen', 'completed');
    default: return '';
  }
}

// "Since your last visit": what changed in the portfolio, worst news first. Rows jump to the project.
export default function Digest() {
  const { digest, ackDigest, ds, computed, setView } = useApp();
  const [all, setAll] = useState(false);
  const diff = useMemo(() => (digest && computed ? digestDiff(digest, digestSummary(ds, computed)) : null), [digest, ds, computed]);
  const items = computed?.model.itemByRef;
  const groups = useMemo(() => {
    if (!diff) return [];
    const by = new Map();
    for (const c of diff.changes) { if (!by.has(c.ref)) by.set(c.ref, []); by.get(c.ref).push(c); }
    return [...by.entries()].filter(([ref]) => items?.get(ref));
  }, [diff, items]);
  const show = diff && (groups.length > 0 || diff.added.length > 0 || diff.removed > 0);
  const shown = all ? groups : groups.slice(0, 5);
  const worse = groups.filter(([, cs]) => cs.some((c) => c.worse)).length;
  return (
    // enter only (exits stall in the Jira frame): "Got it" unmounts the card at once
    show ? (
        <motion.section key="digest" className="card digest" data-tour="digest" aria-label={tr('Seit deinem letzten Besuch', 'Since your last visit')}
          {...enter(0, { y: -8, d: 'gentle' })}>
          <div className="card-head">
            <div>
              <h2 className="card-title"><Icon name="history" />{tr('Seit deinem letzten Besuch', 'Since your last visit')}<span className="muted" style={{ fontWeight: 450, fontSize: 12.5 }}>· {fmt.ago(diff.at)}</span></h2>
              <div className="card-sub row wrap" style={{ gap: 6, marginTop: 4 }}>
                <span className="chip num">{groups.length} {tr('Projekte geändert', 'projects changed')}</span>
                {worse > 0 && <span className="chip chip-accent num"><Icon name="alert" size={11} />{worse} {tr('mit schlechteren Werten', 'got worse')}</span>}
                {diff.added.length > 0 && <span className="chip chip-ok num"><Icon name="plus" size={11} />{diff.added.length} {tr('neu im Portfolio', 'new in portfolio')}</span>}
                {diff.removed > 0 && <span className="chip chip-outline num">{diff.removed} {tr('nicht mehr enthalten', 'no longer included')}</span>}
              </div>
            </div>
            <button className="btn btn-sm" onClick={ackDigest}><Icon name="check" size={13} />{tr('Gesehen', 'Got it')}</button>
          </div>
          {groups.length > 0 && (
            <div>
              {shown.map(([ref, cs], i) => {
                  const p = items.get(ref);
                  return (
                    <motion.button key={ref} layout="position" transition={layoutT('card')} className="digest-row" onClick={() => setView('project', { ref })}
                      {...enter(i, { y: 0, x: -6 })}>
                      <span className="digest-name"><span className="faint num">{p.rank}.</span> {p.name}</span>
                      <span className="row wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        {cs.map((c) => (
                          <span key={c.kind} className={`chip ${c.worse ? 'chip-bad' : c.kind === 'done' ? 'chip-ok' : 'chip-outline'}`}>
                            <Icon name={c.kind === 'rank' ? (c.worse ? 'down' : 'up') : KIND_ICON[c.kind]} size={11} />{describe(c)}
                          </span>
                        ))}
                      </span>
                    </motion.button>
                  );
                })}
              {groups.length > 5 && (
                <button className="btn btn-ghost btn-sm digest-more" onClick={() => setAll((x) => !x)} aria-expanded={all}>
                  {all ? tr('Weniger anzeigen', 'Show less') : tr(`Alle ${groups.length} anzeigen`, `Show all ${groups.length}`)}
                  <motion.span animate={{ rotate: all ? 180 : 0 }} transition={tween('base')} style={{ display: 'grid' }}><Icon name="chevronDown" size={14} /></motion.span>
                </button>
              )}
            </div>
          )}
        </motion.section>
    ) : null
  );
}
