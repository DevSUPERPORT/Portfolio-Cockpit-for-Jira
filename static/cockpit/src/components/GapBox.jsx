// "Fehlende Werte" (UC-13): everyone sees the gaps they are responsible for where they already work –
// in Meine Arbeit (mine), Teams (the team's) and Projekte (the project's) – and fills them in place.
// There is no separate data-quality tab any more; the rows and fixers are the ones from Quality.jsx.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '../state.jsx';
import { tr, roleName, ruleName } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { Empty, Switch, useTip, infoCard } from './ui.jsx';
import { GapRow } from '../views/Quality.jsx';

const PREVIEW = 8;

// Which gaps belong where. scope: { mine: accountId } | { team: teamId } | { project: ref }
export function gapsFor(computed, scope) {
  const { dq, model } = computed;
  return dq.gaps.filter((g) => {
    if (scope.project) return g.rootRef === scope.project;
    if (scope.mine) return g.responsible?.id === scope.mine;
    if (scope.team) {
      const i = g.issueId ? model.byId.get(g.issueId) : null;
      return !!i && (i.team?.id || i.teamId) === scope.team;
    }
    return false;
  }).sort((a, b) => Number(b.urgent) - Number(a.urgent) || String(a.key || '').localeCompare(String(b.key || '')));
}

export default function GapBox({ scope, title, hint, emptyText, hideEmpty = false }) {
  const { computed, config } = useApp();
  const tip = useTip();
  const [fixed, setFixed] = useState(() => new Set());
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const [rule, setRule] = useState('all');
  const [all, setAll] = useState(false);
  const list = useMemo(() => gapsFor(computed, scope), [computed, scope]);
  const pending = list.filter((g) => !fixed.has(g.id));
  // long lists: one chip per kind of missing value (with its count), most frequent first
  const rules = useMemo(() => {
    const m = new Map();
    for (const g of pending) m.set(g.rule, (m.get(g.rule) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [list, fixed]); // eslint-disable-line react-hooks/exhaustive-deps
  const ruleOn = rule !== 'all' && rules.some(([r]) => r === rule) ? rule : 'all';
  const open = pending.filter((g) => (!onlyUrgent || g.urgent) && (ruleOn === 'all' || g.rule === ruleOn));
  const urgent = pending.filter((g) => g.urgent).length;
  const shown = all ? open.slice(0, 120) : open.slice(0, PREVIEW);
  if (hideEmpty && !list.length) return null;
  const levelName = (k) => (k === 'portfolio' ? tr('Projekt', 'Project') : (config.levels || []).find((l) => l.key === k)?.name || roleName(k));
  const mark = (id, on) => setFixed((f) => { const n = new Set(f); if (on) n.add(id); else n.delete(id); return n; });
  return (
    <section className="card gapbox" data-gaps={open.length}>
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="card-title" {...tip(infoCard({ title: tr('Fehlende Werte', 'Missing values'), text: hint || tr('Werte, ohne die Planung und Prognose nicht belastbar sind. Nur Pflichtfelder aus der Konfiguration werden geprüft. Dringend = Start oder Due Date in den nächsten Wochen.', 'Values without which planning and forecasts are not reliable. Only required fields from the configuration are checked. Urgent = start or due date within the next weeks.') }))}>
            <Icon name="shield" />{title || tr('Fehlende Werte', 'Missing values')}
            <motion.span key={pending.length} className={`chip num ${pending.length ? 'chip-accent' : 'chip-ok'}`} initial={{ scale: 0.7 }} animate={{ scale: 1 }}>{pending.length}</motion.span>
          </h2>
          {pending.length > 0 && <div className="card-sub" style={{ marginTop: 3 }}>{urgent > 0 ? tr(`${urgent} davon dringend – dringende stehen oben.`, `${urgent} of them urgent – urgent ones come first.`) : tr('Nichts davon dringend.', 'None of them urgent.')}</div>}
        </div>
        {urgent > 0 && urgent < pending.length && <Switch on={onlyUrgent} onChange={setOnlyUrgent} label={tr(`Nur dringende (${urgent})`, `Urgent only (${urgent})`)} />}
      </div>
      {rules.length > 1 && (
        <div className="list-filter" role="group" aria-label={tr('Nach fehlendem Wert filtern', 'Filter by missing value')}>
          <button type="button" className="list-chip" aria-pressed={ruleOn === 'all'} onClick={() => setRule('all')}>{tr('Alle', 'All')} <b className="num">{pending.length}</b></button>
          {rules.map(([r, n]) => <button key={r} type="button" className="list-chip" aria-pressed={ruleOn === r} onClick={() => setRule(r)}>{ruleName(r)} <b className="num">{n}</b></button>)}
        </div>
      )}
      {open.length === 0 ? (
        <Empty icon="check" title={emptyText || tr('Alles ausgefüllt', 'Everything filled in')}>{tr('Hier fehlt nichts – die Zahlen stehen auf solidem Fundament.', 'Nothing missing here – the numbers rest on a solid foundation.')}</Empty>
      ) : (
        <>
          <div className="gapbox-list" role="list" aria-label={title || tr('Fehlende Werte', 'Missing values')}>
          {shown.map((g, i) => (
            <GapRow key={g.id} g={g} i={i} still listItem levelName={levelName} model={computed.model}
              onFixed={() => mark(g.id, true)} onUnfix={() => mark(g.id, false)} />
          ))}
          </div>
          {open.length > PREVIEW && (
            <button className="gapbox-more" onClick={() => setAll((a) => !a)} aria-expanded={all}>
              {all ? tr('Weniger zeigen', 'Show fewer') : tr(`Alle ${open.length} zeigen`, `Show all ${open.length}`)}
              <motion.span style={{ display: 'grid' }} animate={{ rotate: all ? 180 : 0 }}><Icon name="chevronDown" size={13} /></motion.span>
            </button>
          )}
          {all && open.length > 120 && <div className="gapbox-note faint">{tr(`Die ersten 120 von ${open.length} – filtere nach Art, um den Rest zu sehen.`, `The first 120 of ${open.length} – filter by kind to see the rest.`)}</div>}
        </>
      )}
    </section>
  );
}
