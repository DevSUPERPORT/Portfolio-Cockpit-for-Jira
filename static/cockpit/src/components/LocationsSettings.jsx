// Admin › "Standorte und Feiertage" (UC-09): named locations, each with a holiday calendar, its working days, public
// holidays that do not apply (click a chip to deselect it) and company days off (company shutdown, bridge day …).
// Props: value (config.locations, may be undefined), onChange(next list), peopleCount ({ [id]: n } or (id) => n,
// optional), people (capacity.people, optional – counts the people and offers "Standorte anlegen" while the list is empty).
// The list is passed on raw while typing; the server cleans it with validLocations on save.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { enter, tween } from '../lib/motion.js';
import { LOCATIONS, calendarChoices } from '@shared/holidays.js';
import { upcomingDays, migrateLocations, locationId, countByLocation, DEFAULT_WORKDAYS, MAX_LOCATIONS, MAX_OWN_DAYS } from '@shared/locations.js';
import { todayIdx, isoOf } from '@shared/dates.js';
import { tr, fmt, getLang } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { useTip, infoCard } from './ui.jsx';

const WD = [[1, 'Mo', 'Mon'], [2, 'Di', 'Tue'], [3, 'Mi', 'Wed'], [4, 'Do', 'Thu'], [5, 'Fr', 'Fri'], [6, 'Sa', 'Sat'], [7, 'So', 'Sun']];

export default function LocationsSettings({ value, onChange, peopleCount, people }) {
  const tip = useTip();
  const list = Array.isArray(value) ? value : [];
  const [open, setOpen] = useState(null);
  const [newName, setNewName] = useState('');
  const today = todayIdx();
  const counts = useMemo(() => (people ? countByLocation(list, people) : null), [list, people]);
  const usedBy = (id) => (typeof peopleCount === 'function' ? peopleCount(id) : peopleCount?.[id] ?? counts?.[id] ?? 0) || 0;
  const setLoc = (id, patch) => onChange(list.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const add = () => {
    const name = newName.trim();
    if (!name || list.length >= MAX_LOCATIONS) return;
    const id = locationId(name, list);
    onChange([...list, { id, name, calendar: 'DE', workdays: [...DEFAULT_WORKDAYS], off: [], own: [] }]);
    setNewName('');
    setOpen(id);
  };
  const migrated = useMemo(() => (people && !list.length ? migrateLocations(people) : []), [people, list.length]);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="muted" style={{ fontSize: 13 }}>
        {tr('Je Person wird unter Teams › Kapazitäten pflegen ein Standort gewählt. Hier legst du fest, welcher Feiertagskalender und welche Arbeitstage dort gelten. Feiertage und Firmentage ziehen Kapazität automatisch ab.',
          'Each person gets a location under Teams › Maintain capacities. Here you set which holiday calendar and which working days apply there. Public holidays and company days off reduce capacity automatically.')}
      </div>

      {!list.length && (
        <div className="callout">
          <Icon name="globe" />
          <span className="grow">
            {tr('Noch keine Standorte – es gelten die Feiertagskalender direkt an den Personen, Montag bis Freitag.', 'No locations yet – the holiday calendars set on the people apply, Monday to Friday.')}
            {migrated.length > 0 && <> {' '}<button type="button" className="linkbtn" onClick={() => { onChange(migrated); setOpen(null); }}
              {...tip(infoCard({ title: tr('Standorte anlegen', 'Create locations'), text: tr('Legt je Feiertagskalender, den Personen heute nutzen, einen Standort an. Die Personen gehören automatisch dazu.', 'Creates one location per holiday calendar people use today. The people belong to it automatically.'), items: migrated.map((l) => ({ text: l.name, sub: LOCATIONS[l.calendar], tone: 'ok' })), itemsTitle: tr('Neue Standorte', 'New locations') }))}>
              {tr(`${migrated.length} Standorte anlegen`, `Create ${migrated.length} locations`)}</button></>}
          </span>
        </div>
      )}

      {list.map((l, i) => (
        <LocationCard key={l.id} loc={l} index={i} today={today} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)}
          people={usedBy(l.id)} onChange={(patch) => setLoc(l.id, patch)} onRemove={() => { onChange(list.filter((x) => x.id !== l.id)); if (open === l.id) setOpen(null); }} />
      ))}

      <div className="row wrap" style={{ gap: 8 }}>
        <div className="input-wrap" style={{ width: 240 }}>
          <Icon name="plus" size={14} />
          <input className="input input-sm" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder={tr('Neuer Standort, z. B. Hamburg', 'New location, e.g. Hamburg')} aria-label={tr('Name des neuen Standorts', 'Name of the new location')} />
        </div>
        <button type="button" className="btn btn-sm" disabled={!newName.trim() || list.length >= MAX_LOCATIONS} onClick={add}><Icon name="plus" />{tr('Standort hinzufügen', 'Add location')}</button>
      </div>
    </div>
  );
}

function LocationCard({ loc, index, today, open, onToggle, people, onChange, onRemove }) {
  const tip = useTip();
  const lang = getLang();
  const [d, setD] = useState('');
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);
  const workdays = loc.workdays?.length ? loc.workdays : DEFAULT_WORKDAYS;
  const days = useMemo(() => upcomingDays({ ...loc, workdays }, today, today + 365, lang), [loc, workdays, today, lang]);
  const effective = days.filter((x) => !x.deselected && x.weekday);
  const nHol = effective.filter((x) => x.kind === 'holiday').length, nOwn = effective.filter((x) => x.kind === 'own').length;
  const off = new Set(loc.off || []);
  const toggleDay = (n) => {
    const has = workdays.includes(n);
    if (has && workdays.length <= 1) return;
    onChange({ workdays: has ? workdays.filter((x) => x !== n) : [...workdays, n].sort((a, b) => a - b) });
  };
  const toggleHoliday = (iso) => onChange({ off: off.has(iso) ? [...off].filter((x) => x !== iso) : [...off, iso].sort() });
  const own = loc.own || [];
  const canAdd = /^\d{4}-\d{2}-\d{2}$/.test(d) && !own.some((o) => o.d === d) && own.length < MAX_OWN_DAYS;
  const addOwn = () => {
    if (!canAdd) return;
    onChange({ own: [...own, { d, name: name.trim() || tr('Betriebsruhe', 'Company shutdown') }].sort((a, b) => a.d.localeCompare(b.d)) });
    setD(''); setName('');
  };

  return (
    <motion.div className="card" {...enter(index, { y: 6, d: 'gentle' })} style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
      <div className="row wrap" style={{ gap: 10, padding: '12px 14px', alignItems: 'center' }}>
        <input className="input input-sm" style={{ width: 150, fontWeight: 560 }} value={loc.name} maxLength={60} onChange={(e) => onChange({ name: e.target.value })} aria-label={tr('Name des Standorts', 'Location name')} />
        <select className="select select-sm" style={{ maxWidth: 240 }} value={loc.calendar || 'NONE'} onChange={(e) => onChange({ calendar: e.target.value, off: [] })} aria-label={tr('Feiertagskalender', 'Holiday calendar')}
          {...tip(infoCard({ title: tr('Feiertagskalender', 'Holiday calendar'), text: tr('Die landesweiten gesetzlichen Feiertage des Landes – jedes Land, ohne Bundesländer oder Regionen. Feiertage nach dem Mondkalender (z. B. Zuckerfest, chinesisches Neujahr) werden berechnet und können um einen Tag abweichen – dann unten abwählen und als Firmentag eintragen. Beim Wechsel werden abgewählte Feiertage zurückgesetzt; Firmentage bleiben. Regionaler Feiertag (Bundesland, Kanton, Stadt)? Unten als Firmentag eintragen.', 'The nationwide public holidays of the country – every country, no states or regions. Lunar-calendar holidays (e.g. Eid, Lunar New Year) are computed and can differ by a day – then deselect it below and add it as a company day. Switching resets deselected holidays; company days stay. A regional holiday (state, canton, city)? Add it below as a company day.') }))}>
          {calendarChoices(loc.calendar).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="row" role="group" aria-label={tr('Arbeitstage', 'Working days')} style={{ gap: 3 }}
          {...tip(infoCard({ title: tr('Arbeitstage', 'Working days'), text: tr(`Die Wochenstunden verteilen sich auf ${workdays.length} Arbeitstage. Ein Feiertag zählt nur, wenn er auf einen Arbeitstag fällt.`, `Weekly hours are spread over ${workdays.length} working days. A holiday only counts when it falls on a working day.`) }))}>
          {WD.map(([n, de, en]) => {
            const on = workdays.includes(n);
            return (
              <button key={n} type="button" aria-pressed={on} onClick={() => toggleDay(n)}
                style={{ minWidth: 30, padding: '0 7px', height: 26, borderRadius: 8, border: `1px solid ${on ? 'transparent' : 'var(--line)'}`, background: on ? 'var(--ink)' : 'var(--surface)', color: on ? 'var(--ink-inv)' : 'var(--ink-2)', fontSize: 11.5, fontWeight: 560, transition: 'background-color .18s, color .18s' }}>
                {tr(de, en)}
              </button>
            );
          })}
        </div>
        <span className="grow" />
        <span className="chip num" {...tip(infoCard({ title: tr('Freie Tage in 12 Monaten', 'Days off in 12 months'), text: tr('Feiertage und Firmentage, die auf einen Arbeitstag fallen – sie ziehen Kapazität ab.', 'Public holidays and company days off on a working day – they reduce capacity.'), items: effective.slice(0, 12).map((x) => ({ text: `${fmt.date(x.iso, { weekday: 'short', day: '2-digit', month: 'short' })} · ${x.name || tr('Feiertag', 'Holiday')}`, tone: x.kind === 'own' ? 'warn' : 'ok' })) }))}>
          <Icon name="calendar" size={12} />{tr(`${nHol} Feiertage`, `${nHol} holidays`)}{nOwn ? ` · ${tr(`${nOwn} Firmentage`, `${nOwn} company days`)}` : ''}
        </span>
        <span className="chip num" {...tip(infoCard({ title: tr('Personen', 'People'), text: tr('So viele Personen haben diesen Standort (Teams › Kapazitäten pflegen).', 'This many people have this location (Teams › Maintain capacities).') }))}>
          <Icon name="users" size={12} />{people}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle} aria-expanded={open} aria-label={open ? tr('Feiertage zuklappen', 'Collapse holidays') : tr('Feiertage aufklappen', 'Expand holidays')}>
          <motion.span style={{ display: 'inline-flex' }} animate={{ rotate: open ? 180 : 0 }} transition={tween('base')}><Icon name="chevronDown" size={14} /></motion.span>
        </button>
        <button type="button" className={`btn btn-sm ${confirm ? 'btn-danger' : 'btn-ghost btn-icon'}`} onClick={() => { if (confirm || !people) onRemove(); else { setConfirm(true); setTimeout(() => setConfirm(false), 3500); } }}
          aria-label={tr('Standort entfernen', 'Remove location')}
          {...(people ? tip(infoCard({ title: tr('Standort entfernen', 'Remove location'), text: tr(`${people} Personen nutzen ihn – gib ihnen danach unter Teams › Kapazitäten pflegen einen neuen Standort.`, `${people} people use it – give them a new location under Teams › Maintain capacities afterwards.`) })) : {})}>
          {confirm ? tr('Wirklich entfernen?', 'Really remove?') : <Icon name="trash" size={14} />}
        </button>
      </div>

      {open && (
        <motion.div {...enter(0, { y: -4 })} style={{ padding: '4px 14px 14px', borderTop: '1px solid var(--line-soft)' }}>
          <span className="label" style={{ marginTop: 10 }}>{tr('Kommende Feiertage – anklicken, um einen abzuwählen', 'Coming holidays – click to deselect one')}</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {days.filter((x) => x.kind === 'holiday').length === 0 && <span className="faint" style={{ fontSize: 12.5 }}>{tr('Keine Feiertage in diesem Kalender.', 'No holidays in this calendar.')}</span>}
            {days.filter((x) => x.kind === 'holiday').map((x) => (
              <button key={x.iso} type="button" className="chip" aria-pressed={!x.deselected} onClick={() => toggleHoliday(x.iso)}
                style={{ cursor: 'pointer', opacity: x.deselected ? 0.55 : x.weekday ? 1 : 0.75, textDecoration: x.deselected ? 'line-through' : 'none', background: x.deselected ? 'transparent' : undefined, borderColor: x.deselected ? 'var(--line)' : undefined, transition: 'opacity .18s, background-color .18s' }}
                {...tip(infoCard({ title: x.name || tr('Feiertag', 'Holiday'), sub: fmt.date(x.iso, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }), text: x.deselected ? tr('Abgewählt: gilt an diesem Standort als normaler Arbeitstag. Klicken, um ihn wieder zu übernehmen.', 'Deselected: a normal working day at this location. Click to take it back.') : x.weekday ? tr('Zieht Kapazität ab. Klicken, um ihn für diesen Standort abzuwählen.', 'Reduces capacity. Click to deselect it for this location.') : tr('Fällt auf einen freien Tag – zieht nichts ab.', 'Falls on a day off – deducts nothing.') }))}>
                <span className="num faint">{fmt.date(x.iso, { day: '2-digit', month: '2-digit' })}</span>{x.name}
              </button>
            ))}
          </div>

          <span className="label" style={{ marginTop: 14 }}>{tr('Firmentage', 'Company days off')}</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {own.length === 0 && <span className="faint" style={{ fontSize: 12.5 }}>{tr('Noch keine – z. B. Betriebsruhe zwischen den Jahren oder ein Brückentag.', 'None yet – e.g. a shutdown between the holidays or a bridge day.')}</span>}
            {own.map((o) => (
              <motion.span key={o.d} className="chip chip-warn" {...enter(0, { y: 0, scale: 0.94, d: 'quick' })}>
                <span className="num">{fmt.date(o.d, { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>{o.name}
                <button type="button" className="chip-x" onClick={() => onChange({ own: own.filter((x) => x.d !== o.d) })} aria-label={tr('Firmentag entfernen', 'Remove company day off')}><Icon name="x" size={10} /></button>
              </motion.span>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
            <input type="date" className="input input-sm" value={d} min={isoOf(today - 31)} onChange={(e) => setD(e.target.value)} aria-label={tr('Datum des Firmentags', 'Date of the company day off')} />
            <input className="input input-sm" style={{ width: 200 }} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addOwn(); }}
              placeholder={tr('Betriebsruhe, Brückentag …', 'Shutdown, bridge day …')} aria-label={tr('Name des Firmentags', 'Name of the company day off')} />
            <button type="button" className="btn btn-sm" disabled={!canAdd} onClick={addOwn}><Icon name="plus" />{tr('Firmentag hinzufügen', 'Add company day off')}</button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
