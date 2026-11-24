// "Warum zu viel?" – opened from a red week on the weekly board (boss 2026-11-20: "we need more info in the app, simple
// for users to see the reasoning behind the overbooking, and easy fix actions with Lotse"). Three short steps – where
// the time comes from, what uses it, the same number everywhere – then what Lotse can do about it. Every number comes
// from shared/overWhy.js, i.e. from the board on screen. Accepting only stages a change (like every board move).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { enter } from '../lib/motion.js';
import { explainOver, handOverFor } from '@shared/overWhy.js';
import { roundH } from '@shared/loadFit.js';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { openIssue } from '../lib/api.js';
import { openLotse } from './lotse/open.js';
import { LotseMark } from './lotse/LotseChip.jsx';

const EPS = 0.05;
const H = (h) => fmt.h(roundH(Math.max(0, h || 0)), h > 0 && h < 9.95 ? 1 : 0);
const pctOf = (u) => (u === Infinity ? '∞' : fmt.pct(u));
const dm = (iso) => (iso ? fmt.date(iso, { day: '2-digit', month: '2-digit' }) : '–');

// the picture: time against planned, on one scale; what does not fit is striped
function Balance({ x }) {
  const time = Math.max(0, x.scope === 'project' ? x.time.here : x.scope === 'team' || x.scope === 'people' ? x.time.team : x.avail);
  const busy = 0;
  const scale = Math.max(time, x.load, 1);
  const w = (h) => `${Math.max(0, Math.min(1, h / scale)) * 100}%`;
  const over = Math.max(0, x.over ?? x.load - x.avail);
  const fits = Math.max(0, x.load - over);
  return (
    <div className="ow-balance" aria-hidden="true">
      <div className="ow-bal-row">
        <span className="ow-bal-l">{tr('Zeit', 'Time')}</span>
        <span className="ow-bal-track">
          {busy > EPS && <i className="ow-seg busy" style={{ width: w(busy) }} />}
          <i className="ow-seg time" style={{ left: w(busy), width: w(time - busy) }} />
        </span>
        <span className="ow-bal-v">{H(time)}</span>
      </div>
      <div className="ow-bal-row">
        <span className="ow-bal-l">{tr('Geplant', 'Planned')}</span>
        <span className="ow-bal-track">
          <i className="ow-seg plan" style={{ left: w(busy), width: w(fits) }} />
          {over > EPS && <i className="ow-seg over" style={{ left: w(busy + fits), width: w(over) }} />}
          {over > EPS && <b className="ow-cap" style={{ left: w(fits) }} />}
        </span>
        <span className="ow-bal-v">{H(x.load)}</span>
      </div>
      {x.scope === 'project' && (x.takes.support + x.takes.higher) > EPS && <div className="ow-bal-note faint">{tr(`Zeit = was die Personen nach Support und höher gerankten Projekten (${H(x.takes.support + x.takes.higher)}) noch haben`, `Time = what the people have left after support and higher-ranked projects (${H(x.takes.support + x.takes.higher)})`)}</div>}
      {over > EPS && (x.free || 0) > EPS && x.scope !== 'person' && <div className="ow-bal-note faint">{tr(`${H(x.free)} sind bei anderen im Team noch frei – aber nicht bei denen, die diese Arbeit haben. Lotse kann übergeben.`, `${H(x.free)} are still free with others in the team – but not with the people who have this work. Lotse can hand over.`)}</div>}
    </div>
  );
}

// one person's time for a team: "50 % im Team = 16 h + 16 h von SUPERPORT #2 (dort diese Woche frei) = 32 h"
function TimeLine({ p, teamName }) {
  const parts = [];
  const moves = (p.from || []).concat(p.to || []).some((x) => x.hours > EPS);
  // a full member whose time stays in the team: one chip says it all
  if (p.member && p.share >= 0.999 && !moves) return <span className="ow-line"><span className="ow-eq"><b>{H(p.time)}</b> {tr('für Projekte', 'for projects')}</span></span>;
  if (p.member && p.share < 0.999) parts.push(<span key="s" className="ow-chip">{Math.round(p.share * 100)} % {tr('im Team', 'in the team')} = {H(p.entitled)}</span>);
  else if (p.member) parts.push(<span key="s" className="ow-chip">{H(p.entitled)} {tr('für Projekte', 'for projects')}</span>);
  else parts.push(<span key="s" className="ow-chip muted">{tr('hilft aus – nicht im Team', 'helping out – not in the team')}</span>);
  for (const f of p.from || []) if (f.hours > EPS) parts.push(<span key={`f${f.teamId}`} className="ow-chip ok">+ {H(f.hours)} {f.teamId === '_rest' ? tr('ohne Team-Anteil', 'outside team shares') : tr(`von ${teamName(f.teamId)} (dort diese Woche frei)`, `from ${teamName(f.teamId)} (free there this week)`)}</span>);
  for (const t of p.to || []) if (t.hours > EPS) parts.push(<span key={`t${t.teamId}`} className="ow-chip muted">− {H(t.hours)} {tr(`an ${teamName(t.teamId)} (dort gebraucht)`, `to ${teamName(t.teamId)} (needed there)`)}</span>);
  parts.push(<span key="eq" className="ow-eq">= <b>{H(p.time)}</b></span>);
  return <span className="ow-line">{parts}</span>;
}

// "dieselbe Zahl überall": the person's own week next to this one
const personSentence = (p) => {
  const o = p.person;
  if (!(o.avail > EPS)) return tr(`${H(o.load)} geplant, keine Zeit in dieser Woche`, `${H(o.load)} planned, no time this week`);
  return o.over > EPS
    ? tr(`${H(o.load)} geplant bei ${H(o.avail)} Zeit → ${H(o.over)} zu viel (${pctOf(o.util)})`, `${H(o.load)} planned on ${H(o.avail)} of time → ${H(o.over)} too much (${pctOf(o.util)})`)
    : tr(`${H(o.load)} geplant bei ${H(o.avail)} Zeit → passt (${pctOf(o.util)})`, `${H(o.load)} planned on ${H(o.avail)} of time → fits (${pctOf(o.util)})`);
};

export function OverWhy({ target, board, model, suggestions, canEdit, teamName, sugLabel, onAccept, onHandOver, onClose }) {
  const ref = useRef(null);
  const { rect } = target;
  const [pos, setPos] = useState({ left: rect.left, top: rect.bottom + 6, visibility: 'hidden' });
  const x = useMemo(() => explainOver({ board, model, rowId: target.rowId, foot: target.foot, wi: target.wi }), [board, model, target]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left));
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
    setPos({ left, top });
  }, [rect, x]);
  useEffect(() => { ref.current?.querySelector('button')?.focus(); }, []);
  useEffect(() => {
    const h = (e) => { if (!ref.current?.contains(e.target)) onClose(false); };
    window.addEventListener('pointerdown', h, true);
    return () => window.removeEventListener('pointerdown', h, true);
  }, [onClose]);

  // what Lotse can do: the red-week advice for these tasks / this person, a hand-over, the team shares, the estimate
  const fixes = useMemo(() => {
    if (!x) return [];
    const wk = x.week.from;
    const tasks = x.takes?.tasks || [];
    const ids = new Set(tasks.map((t) => t.id));
    const out = [];
    const sug = suggestions.filter((s) => (x.scope === 'person' ? s.personId === x.personId : x.scope === 'project' ? ids.has(s.taskId) : true) && (s.conflictWeeks || []).includes(wk))
      .sort((a, b) => a.pastProjectDue - b.pastProjectDue);
    for (const s of sug.slice(0, x.scope === 'team' || x.scope === 'people' ? 3 : 2)) out.push({ kind: 'sug', id: `s:${s.id}`, s });
    if (canEdit) {
      // the biggest tasks of people who are over this week: someone of the team with room takes it
      const overPeople = new Set((x.scope === 'person' ? [{ id: x.personId, person: { over: x.load - x.avail } }] : x.people).filter((p) => x.scope === 'person' || (p.overHere ?? p.person?.over) > EPS).map((p) => p.id));
      for (const t of tasks.filter((k) => k.assignee && overPeople.has(k.assignee) && !k.hidden).slice(0, 3)) {
        const to = handOverFor(board, t.id);
        if (to) { out.push({ kind: 'hand', id: `h:${t.id}`, t, to }); break; }
      }
    }
    // split people whose time this week comes partly from (or goes to) another team: the shares do not match the work
    const split = (x.people || []).filter((p) => p.member && p.share > 0 && p.share < 0.999 && (p.borrowed > EPS || p.person.over > EPS));
    if (x.scope === 'person' && (x.teams || []).filter((b) => b.teamId !== '_rest' && b.share > 0).length > 1) split.push({ id: x.personId, name: x.name });
    for (const p of split.slice(0, 1)) out.push({ kind: 'shares', id: `l:${p.id}`, p });
    const big = tasks[0];
    if (big && !big.hidden && x.fit.kind === 'over') out.push({ kind: 'jira', id: `j:${big.id}`, t: big });
    return out;
  }, [x, suggestions, canEdit, board]);

  if (!x) return null;
  const id = 'ow-title';
  const over = Math.max(0, x.over ?? x.load - x.avail);
  const noTime = !(x.avail > EPS) && x.load > EPS && !(over > EPS && over < x.load - EPS);
  const title = noTime ? tr('Warum keine Zeit?', 'Why no time?') : over > EPS ? tr(`Warum ${H(over)} zu viel?`, `Why ${H(over)} too much?`) : tr('Wie diese Zahl entsteht', 'How this number comes about');
  const where = `${x.name ? `${x.name} · ` : ''}${fmt.week(x.week.from)} · ${dm(x.week.from)} – ${dm(x.week.to)}`;
  const steps = [];

  if (x.scope === 'person') {
    const t = x.time;
    steps.push({
      title: tr('Woher die Zeit kommt', 'Where the time comes from'),
      body: <span className="ow-line">
        <span className="ow-chip">{H(t.nominal)} {tr('Woche', 'week')}</span>
        {t.off > EPS && <span className="ow-chip muted">− {H(t.off)} {tr('abwesend / Feiertag', 'absent / holiday')}</span>}
        {t.daily > EPS && <span className="ow-chip muted">− {H(t.daily)} {tr('Tagesgeschäft & Intern', 'daily business & internal')}{t.dailyPct ? ` (${t.dailyPct} %)` : ''}</span>}
        <span className="ow-eq">= <b>{H(t.avail)}</b> {tr('Zeit für Projekte', 'time for projects')}</span>
      </span>,
      note: t.derived ? tr('Wochenstunden sind Standardwerte – unter Teams › Kapazitäten pflegen änderbar.', 'Weekly hours are default values – change them under Teams › Maintain capacities.') : null,
    });
    steps.push({
      title: tr('Was sie braucht', 'What uses it'),
      items: [
        ...(x.takes.support > EPS ? [{ k: 'sup', text: 'Support', sub: H(x.takes.support) }] : []),
        ...x.takes.tasks.slice(0, 5).map((k) => ({ k: k.id, key: k.key, text: k.summary, sub: `${H(k.hours)}${k.len > 1 ? ` · ${tr('Teil', 'part')} ${k.idx}/${k.len}` : ''}${k.oe ? ` · ${tr('gesamt', 'total')} ${H(k.oe)}` : ''}`, tone: 'plan' })),
        ...(x.takes.other > EPS ? [{ k: 'oth', text: x.takes.otherKind === 'projects' ? tr('andere Projekte', 'other projects') : tr('Arbeit für andere Teams', 'work for other teams'), sub: H(x.takes.other) }] : []),
      ],
      extra: x.teams.length > 1 ? <span className="ow-line">{x.teams.map((b) => <span key={b.teamId} className={`ow-chip ${b.over > EPS ? 'bad' : ''}`}>{b.teamId === '_rest' ? tr('ohne Team', 'no team') : teamName(b.teamId)}{b.share > 0 && b.share < 0.999 ? ` ${Math.round(b.share * 100)} %` : ''}: {H(b.load)}</span>)}</span> : null,
    });
    steps.push({
      title: tr('Dieselbe Zahl überall', 'The same number everywhere'),
      tone: over > EPS || noTime ? 'bad' : 'ok',
      text: noTime ? tr(`${H(x.load)} geplant, aber in dieser Woche keine Zeit – diese Stunden müssen in eine andere Woche oder zu einer anderen Person.`, `${H(x.load)} planned, but no time this week – these hours need another week or another person.`)
        : over > EPS ? tr(`${H(x.load)} geplant bei ${H(x.avail)} Zeit: ${H(over)} passen nicht hinein (${pctOf(x.load / x.avail)}). Projekte-Ansicht, Teams und Meine Arbeit zeigen für diese Woche dieselbe Zahl.`, `${H(x.load)} planned on ${H(x.avail)} of time: ${H(over)} do not fit (${pctOf(x.load / x.avail)}). The Projects view, Teams and My work show the same number for this week.`)
          : tr(`${H(x.load)} geplant bei ${H(x.avail)} Zeit – passt.`, `${H(x.load)} planned on ${H(x.avail)} of time – fits.`),
    });
  } else {
    // a project of a team or a whole team: per person their part of the team's time
    steps.push({
      title: tr('Woher die Zeit kommt', 'Where the time comes from'),
      people: x.people.filter((p) => (p.member && (p.time > EPS || p.here > EPS || p.entitled > EPS)) || (!p.member && (p.time > EPS || p.teamLoad > EPS))),
      hidden: x.hidden,
      note: x.scope === 'people' ? tr('Jede Person mit ihrer ganzen Woche – nach Abwesenheit, Feiertagen, Tagesgeschäft und Intern; so wie in ihrer Zeile.', 'Each person with their whole week – after absence, holidays, daily business and internal work; as in their row.')
        : x.people.some((p) => p.from?.length) ? tr('Wer nur zum Teil im Team ist, bringt seinen Anteil mit – und dazu, was seine anderen Teams in dieser Woche nicht brauchen. Wer aus einem anderen Team aushilft, bringt nur Zeit mit, die sein Team in dieser Woche nicht braucht.', 'Someone only partly in the team brings their share – plus what their other teams do not need this week. Someone helping from another team brings only time their own team does not need this week.') : null,
    });
    if (x.scope === 'project') {
      steps.push({
        title: tr('Was sie braucht', 'What uses it'),
        items: [
          ...(x.takes.support > EPS ? [{ k: 'sup', text: 'Support', sub: H(x.takes.support) }] : []),
          ...(x.takes.higher > EPS ? [{ k: 'hi', text: tr('Projekte mit höherem Rang', 'higher-ranked projects'), sub: H(x.takes.higher) }] : []),
          ...x.takes.tasks.slice(0, 5).map((k) => ({ k: k.id, key: k.key, text: k.summary, sub: `${H(k.hours)}${k.len > 1 ? ` · ${tr('Teil', 'part')} ${k.idx}/${k.len}` : ''}${k.assigneeName ? ` · ${k.assigneeName}` : k.assignee ? '' : ` · ${tr('nicht zugewiesen', 'unassigned')}`}`, tone: 'plan' })),
        ],
      });
    } else if (x.scope === 'people') {
      steps.push({
        title: tr('Was sie braucht', 'What uses it'),
        items: [
          { k: 'm', text: tr('Arbeit der Personen oben – ihre ganze Woche, auch für andere Teams (Tasks + Support)', 'Work of the people above – their whole week, also for other teams (tasks + support)'), sub: H(x.takes.members) },
          ...(x.takes.unassigned > EPS ? [{ k: 'u', text: tr('Tasks ohne Assignee (nutzen, was frei ist)', 'Tasks without assignee (use what is free)'), sub: H(x.takes.unassigned) }] : []),
        ],
      });
    } else {
      steps.push({
        title: tr('Was sie braucht', 'What uses it'),
        items: [
          { k: 'm', text: tr('Arbeit der Teammitglieder für das Team (Tasks + Support)', 'Team members\' work for the team (tasks + support)'), sub: H(x.takes.members) },
          ...(x.takes.outside > EPS ? [{ k: 'o', text: tr('Arbeit von Personen außerhalb des Teams', 'work by people outside the team'), sub: H(x.takes.outside) }] : []),
        ],
      });
    }
    const named = x.people.filter((p) => p.here > EPS || (x.scope === 'team' && p.teamLoad > EPS));
    const hereSentence = (p) => (p.before == null ? personSentence(p)
      : p.overHere > EPS ? tr(`${H(p.here)} hier, ${H(p.before)} übrig nach Support und höher gerankten Projekten → ${H(p.overHere)} zu viel · die ganze Woche: ${personSentence(p)}`, `${H(p.here)} here, ${H(p.before)} left after support and higher-ranked projects → ${H(p.overHere)} too much · the whole week: ${personSentence(p)}`)
        : tr(`${H(p.here)} hier, ${H(p.before)} übrig → passt · die ganze Woche: ${personSentence(p)}`, `${H(p.here)} here, ${H(p.before)} left → fits · the whole week: ${personSentence(p)}`));
    const outside = x.scope === 'team' && x.takes.outside > EPS;
    steps.push({
      title: outside ? tr('Und bei den Personen', 'And for the people') : tr('Dieselbe Zahl überall', 'The same number everywhere'),
      tone: over > EPS || noTime ? 'bad' : 'ok',
      text: outside
        ? tr(`${H(x.takes.outside)} davon sind Arbeit von Personen außerhalb des Teams – sie zählt als Arbeit des Teams, ihre Zeit gehört aber anderen Teams. Die eigenen Wochen der Teammitglieder:`, `${H(x.takes.outside)} of it is work by people outside the team – it counts as the team's work, but their time belongs to other teams. The team members' own weeks:`)
        : over > EPS || noTime
        ? tr(`${H(x.load)} geplant bei ${H(x.avail)} Zeit – ${noTime ? 'keine Zeit' : `${H(over)} zu viel`}. So steht es auch bei den Personen:`, `${H(x.load)} planned on ${H(x.avail)} of time – ${noTime ? 'no time' : `${H(over)} too much`}. The people's own weeks say the same:`)
        : tr(`${H(x.load)} geplant bei ${H(x.avail)} Zeit – passt.`, `${H(x.load)} planned on ${H(x.avail)} of time – fits.`),
      list: [
        ...named.slice(0, 5).map((p) => ({ k: p.id, text: p.name || tr('Person', 'Person'), sub: x.scope === 'project' ? hereSentence(p) : personSentence(p), tone: (x.scope === 'project' ? p.overHere ?? p.person.over : p.person.over) > EPS ? 'bad' : 'ok' })),
        ...(x.scope === 'project' && x.takes.unassigned > EPS ? [{ k: '_u', text: tr('nicht zugewiesen', 'unassigned'), sub: x.takes.unassignedOver > EPS ? tr(`${H(x.takes.unassigned)} – im Team ist dafür nur noch Platz für ${H(x.takes.unassigned - x.takes.unassignedOver)}`, `${H(x.takes.unassigned)} – the team only has room for ${H(x.takes.unassigned - x.takes.unassignedOver)}`) : tr(`${H(x.takes.unassigned)} – passt in die freie Zeit des Teams`, `${H(x.takes.unassigned)} – fits the team's free time`), tone: x.takes.unassignedOver > EPS ? 'bad' : 'ok' }] : []),
      ],
    });
  }

  return createPortal(
    <motion.div ref={ref} className="wb-why ow" role="dialog" aria-labelledby={id} style={pos} data-over-why={x.scope}
      {...enter(0, { y: -4, scale: 0.985 })}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); } }}>
      <div className="wb-why-head">
        <span className={`wb-why-glyph ow-glyph ${over > EPS || noTime ? 'bad' : ''}`} aria-hidden="true"><Icon name={over > EPS || noTime ? 'alert' : 'gauge'} size={14} /></span>
        <div><b id={id}>{title}</b><span className="wb-key">{where}</span></div>
        <button type="button" className="btn btn-xs btn-ghost btn-icon" style={{ width: 26 }} aria-label={tr('Schließen', 'Close')} onClick={() => onClose(true)}><Icon name="x" size={13} /></button>
      </div>
      <Balance x={x} />
      <ol className="wb-why-steps">
        {steps.map((s, i) => (
          <li key={i} className={s.tone ? `t-${s.tone}` : ''}>
            <span className="wb-why-n" aria-hidden="true">{i + 1}</span>
            <div>
              <b>{s.title}</b>
              {s.text && <p>{s.text}</p>}
              {s.body}
              {s.people && (
                <ul className="ow-people">
                  {s.people.map((p) => <li key={p.id}><span className="ow-name">{p.name || tr('Person', 'Person')}</span><TimeLine p={p} teamName={teamName} /></li>)}
                  {s.hidden && s.hidden.time > EPS && <li><span className="ow-name">{tr(`Weitere Personen (${s.hidden.count})`, `Other people (${s.hidden.count})`)}</span><span className="ow-line"><span className="ow-eq">= <b>{H(s.hidden.time)}</b></span></span></li>}
                  {!s.people.length && !(s.hidden?.time > EPS) && <li className="faint">{tr('Niemand im Team hat in dieser Woche Zeit.', 'Nobody in the team has time this week.')}</li>}
                </ul>
              )}
              {s.items && <ul>{s.items.map((it) => <li key={it.k}><i className={`t-${it.tone === 'plan' ? 'bad' : 'ok'}`} /><span>{it.key ? <button type="button" className="tkey" onClick={() => openIssue(it.key)} title={tr('In Jira öffnen', 'Open in Jira')}>{it.key}</button> : null} {it.text}</span><em>{it.sub}</em></li>)}</ul>}
              {s.extra}
              {s.list && s.list.length > 0 && <ul className="ow-plist">{s.list.map((it) => <li key={it.k}><i className={`t-${it.tone}`} /><span>{it.text}</span><em>{it.sub}</em></li>)}</ul>}
              {s.note && <p className="faint ow-note">{s.note}</p>}
            </div>
          </li>
        ))}
      </ol>
      {fixes.length > 0 && (
        <div className="ow-fixes" data-over-fixes>
          <div className="ow-fixes-head"><LotseMark size={14} /><b>{tr('Lotse schlägt vor', 'Lotse suggests')}</b></div>
          <ul>
            {fixes.map((f) => (
              <li key={f.id} data-over-fix={f.kind}>
                {f.kind === 'sug' && <>
                  <span>{sugLabel(f.s)}{f.s.pastProjectDue ? <span className="due-warn"><Icon name="alert" size={11} />{tr(`Nach Projekt-Due ${dm(f.s.projectDue)}`, `After project due ${dm(f.s.projectDue)}`)}</span> : null}</span>
                  {canEdit && <button type="button" className={`btn btn-xs ${f.s.pastProjectDue ? '' : 'btn-primary'}`} onClick={() => { onAccept(f.s); onClose(false); }}><Icon name="check" size={12} />{f.s.pastProjectDue ? tr('Trotzdem', 'Anyway') : tr('Übernehmen', 'Accept')}</button>}
                </>}
                {f.kind === 'hand' && <>
                  <span>{tr(`${f.t.key} an ${f.to.name} geben – hat in ${f.to.weeks.length === 1 ? fmt.week(f.to.weeks[0]) : `${fmt.week(f.to.weeks[0])}–${String(fmt.week(f.to.weeks.at(-1))).replace(/^\D+/, '')}`} Platz (danach ${pctOf(f.to.peak)})`, `Give ${f.t.key} to ${f.to.name} – has room in ${f.to.weeks.length === 1 ? fmt.week(f.to.weeks[0]) : `${fmt.week(f.to.weeks[0])}–${String(fmt.week(f.to.weeks.at(-1))).replace(/^\D+/, '')}`} (then ${pctOf(f.to.peak)})`)}</span>
                  <button type="button" className="btn btn-xs" onClick={() => { onHandOver(f.t, f.to); onClose(false); }}><Icon name="user" size={12} />{tr('Übergeben', 'Hand over')}</button>
                </>}
                {f.kind === 'shares' && <>
                  <span>{tr(`Team-Anteile von ${f.p.name || 'der Person'} an die echte Arbeit anpassen – Lotse prüft alle Teams und zeigt vorher eine Vorschau`, `Fit ${f.p.name || 'the person'}'s team shares to the real work – Lotse checks every team and shows a preview first`)}</span>
                  <button type="button" className="btn btn-xs" data-over-lotse onClick={() => { onClose(false); openLotse({ act: { kind: 'workflow', workflow: 'splitResolve', params: { person: f.p.id } } }); }}><LotseMark size={12} />Lotse</button>
                </>}
                {f.kind === 'jira' && <>
                  <span>{tr(`Stimmt die Schätzung? ${f.t.key} hat ${H(f.t.oe)} Original Estimate`, `Is the estimate right? ${f.t.key} has ${H(f.t.oe)} original estimate`)}</span>
                  <button type="button" className="btn btn-xs btn-ghost" onClick={() => openIssue(f.t.key)}><Icon name="external" size={12} />{tr('In Jira', 'In Jira')}</button>
                </>}
              </li>
            ))}
          </ul>
          <span className="faint ow-fixes-foot">{tr('Nur vorgemerkt – erst „In Jira übernehmen“ schreibt es.', 'Only staged – written only with "Apply to Jira".')}</span>
        </div>
      )}
    </motion.div>, document.body);
}

// the small "Warum?" link inside a red cell head
export function WhyOverButton({ onOpen, label }) {
  return (
    <button type="button" className="ow-open" data-why-over onClick={(e) => { e.stopPropagation(); onOpen(e.currentTarget.closest('.wb-head') || e.currentTarget); }}
      aria-label={label || tr('Warum zu viel? Rechnung und Vorschläge zeigen', 'Why too much? Show the calculation and suggestions')}>
      {tr('Warum?', 'Why?')}<Icon name="arrowRight" size={10} />
    </button>
  );
}
