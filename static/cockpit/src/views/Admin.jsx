import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { USAGES, DEFAULT_MATRIX } from '@shared/engine.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt, roleName, usageName } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call, openUrl, getContext } from '../lib/api.js';
import { parseQuarter } from '@shared/dates.js';
import { Segmented, Switch, Empty, Skeleton, spring, stagger, useTip, infoCard } from '../components/ui.jsx';
import { TAB_RIGHTS, ACTION_RIGHTS, RIGHT_LABEL, ROLE_LABEL } from '@shared/roles.js';
import AiSettings from '../components/AiSettings.jsx';
import UsageStats from '../components/UsageStats.jsx';
import SnapshotSettings from '../components/SnapshotSettings.jsx';
import LocationsSettings from '../components/LocationsSettings.jsx';
import SupportDispatchSettings from '../components/SupportDispatchSettings.jsx';
import TeamsSettings from '../components/TeamsSettings.jsx';
import { gapReminders, DEFAULT_NOTICES } from '@shared/notices.js';
import { calendarChoices } from '@shared/holidays.js';
import { validQuarterRange, rollingQuarters, quarterChoices, isQuarterKey, MAX_EXTRA_QUARTERS } from '@shared/quarterRange.js';

const SECTIONS = [
  ['hierarchy', 'layers', 'Hierarchie & Projekte', 'Hierarchy & projects'],
  ['fields', 'grid', 'Felder & Pflichtfelder', 'Fields & required fields'],
  ['teams', 'users', 'Teams', 'Teams'],
  ['sizes', 'target', 'T-Shirt-Größen & Quartale', 'T-shirt sizes & quarters'],
  ['rules', 'settings', 'Planungsregeln', 'Planning rules'],
  ['booking', 'clock', 'Buchungskontrolle', 'Booking check'],
  ['notices', 'send', 'Erinnerungen & Nachrichten', 'Reminders & notices'],
  ['locations', 'globe', 'Standorte und Feiertage', 'Locations and holidays'],
  ['snapshot', 'calendar', 'Plan-Snapshot', 'Plan snapshot'],
  ['milestones', 'milestone', 'Meilensteine', 'Milestones'],
  ['deps', 'link', 'Abhängigkeiten', 'Dependencies'],
  ['perms', 'shield', 'Rollen und Rechte', 'Roles and permissions'],
  ['ai', 'lock', 'KI & Datenschutz', 'AI & data protection'],
  ['usage', 'gauge', 'Nutzung', 'Usage'],
  ['support', 'headset', 'Support & SLAs', 'Support & SLAs'],
  ['capacity', 'users', 'Kapazität', 'Capacity'],
  ['versions', 'history', 'Versionen & Sicherung', 'Versions & backup'],
  ['audit', 'eye', 'Protokoll', 'Audit log'],
];
// What the delegated "Portfolio settings" group sees (in the cockpit, without Jira admin rights).
const DELEGATE_SECTIONS = ['sizes', 'rules', 'milestones', 'support', 'capacity'];
// Labels for the save bar's "what will change" summary.
const CHANGE_LABELS = { portfolio: ['Hierarchie', 'Hierarchy'], levels: ['Hierarchie', 'Hierarchy'], levelsOff: ['Hierarchie', 'Hierarchy'], fields: ['Felder', 'Fields'], matrix: ['Pflichtfelder', 'Required fields'],
  dependencies: ['Abhängigkeiten', 'Dependencies'], permissions: ['Rollen und Rechte', 'Roles and permissions'], roles: ['Rollen und Rechte', 'Roles and permissions'], report: ['Berechtigungen', 'Permissions'], tshirtSizes: ['T-Shirt-Größen', 'T-shirt sizes'],
  rules: ['Planungsregeln', 'Planning rules'], booking: ['Buchungskontrolle', 'Booking check'], notices: ['Erinnerungen & Nachrichten', 'Reminders & notices'], locations: ['Standorte und Feiertage', 'Locations and holidays'], snapshot: ['Plan-Snapshot', 'Plan snapshot'], support: ['Support', 'Support'], capacityDefaults: ['Kapazität', 'Capacity'], teams: ['Teams', 'Teams'], ai: ['KI & Datenschutz', 'AI & data protection'], quarterRange: ['Ziel-Quartale', 'Target quarters'] };
const ROLE_OPTS = ['rough', 'structure', 'estimate', 'tiny'];
// config.get › meta.staleFields: mapped custom fields Jira no longer has (deleted or hidden)
const STALE_LABELS = { team: ['Team', 'Team'], startDate: ['Startdatum', 'Start date'], tshirt: ['T-Shirt-Größe', 'T-shirt size'], targetQuarters: ['Zielquartale', 'Target quarters'],
  note: ['Abhängigkeits-Notiz', 'Dependency note'], owner: ['Owner', 'Owner'], milestone: ['Meilenstein', 'Milestone'], supportCause: ['Support-Ursache', 'Support cause'] };

export default function Admin({ mode = 'admin' }) {
  const delegate = mode === 'delegate';
  const { toast, computed, done, lang, reload, boot } = useApp();
  const [guideSeen, setGuideSeen] = useState(!!boot?.prefs?.hints?.admin);
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [ms, setMs] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [msDirty, setMsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0); // bumps after each save so the version list refreshes
  const [sec, setSec] = useState('hierarchy');
  const [err, setErr] = useState(null);
  const refs = useRef({});
  const loadAll = () => (delegate
    // Delegated settings: only the parts this group may change.
    ? call('settings.get').then((d) => {
      const c = { setupComplete: true, tshirtSizes: d.tshirtSizes, rules: d.rules, capacityDefaults: d.capacityDefaults, fields: d.fields, support: { sla: d.supportSla, slaTargetPct: d.slaTargetPct } };
      setData({ config: c, milestones: d.milestones, meta: { locations: d.locations, priorities: d.priorities || [] }, delegatedRules: d.delegatedRules }); setCfg(c); setMs(d.milestones); setDirty(false); setMsDirty(false);
    }).catch((e) => setErr(e))
    : call('config.get').then(async (d) => {
      let c = d.config;
      if (!c.setupComplete) { try { c = { ...(await call('config.detect')), permissions: c.permissions }; setDirty(true); } catch { /* keep defaults */ } }
      setData(d); setCfg(c); setMs(d.milestones);
    }).catch((e) => setErr(e)));
  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = (fn) => { setCfg((c) => { const n = structuredClone(c); fn(n); return n; }); setDirty(true); };
  const problems = useMemo(() => {
    if (!cfg || delegate) return [];
    const p = [];
    if (cfg.portfolio.source === 'issue' && !cfg.portfolio.issueTypeIds.length) p.push(tr('Bitte den Issue Type für Projekte wählen.', 'Please choose the issue type for projects.'));
    const est = cfg.levels.filter((l) => l.role === 'estimate').length;
    if (est !== 1) p.push(tr('Genau eine Ebene muss „Schätzung & Zeiterfassung" sein.', 'Exactly one level must be "Estimation & time tracking".'));
    if (cfg.levels.filter((l) => l.role === 'rough').length > 1) p.push(tr('„Grobplanung" darf nur einmal vorkommen.', '"Rough planning" may only occur once.'));
    const all = [...cfg.levels, ...(cfg.levelsOff || [])].flatMap((l) => l.issueTypeIds).concat(cfg.portfolio.source === 'issue' ? [...cfg.portfolio.issueTypeIds, ...(cfg.portfolio.group?.issueTypeIds || [])] : []);
    if (new Set(all).size !== all.length) p.push(tr('Ein Issue Type kann nur zu einer Ebene gehören.', 'An issue type can only belong to one level.'));
    return p;
  }, [cfg, lang]);
  if (err) return <div className="page"><Empty icon="lock" title={tr('Konfiguration nicht verfügbar', 'Configuration unavailable')}>{errText(err)}</Empty></div>;
  if (!cfg) return <div className="page"><Skeleton h={60} /><Skeleton h={300} /></div>;
  const meta = data.meta;
  const save = async () => {
    setSaving(true);
    const prevCfg = data.config, prevMs = data.milestones, wasDirty = dirty, wasMs = msDirty;
    try {
      const saveCfg = async (c) => (delegate
        ? await call('settings.save', { tshirtSizes: c.tshirtSizes, rules: c.rules, capacityDefaults: c.capacityDefaults, supportSla: c.support?.sla, slaTargetPct: c.support?.slaTargetPct })
          .then((r) => ({ ...c, tshirtSizes: r.tshirtSizes, rules: r.rules, capacityDefaults: r.capacityDefaults, support: { ...c.support, sla: r.supportSla ?? c.support?.sla, slaTargetPct: r.slaTargetPct ?? c.support?.slaTargetPct } }))
        : call('config.save', { config: c }));
      if (dirty) { const saved = await saveCfg(cfg); setCfg(saved); setDirty(false); setData((d) => ({ ...d, config: saved })); if (!delegate && JSON.stringify(saved.teams ?? null) !== JSON.stringify(prevCfg.teams ?? null)) reload?.(); } // teams change what every view lists
      setSavedAt(Date.now());
      if (msDirty) { const saved = await call('milestones.save', { milestones: ms }); setMs(saved); setMsDirty(false); setData((d) => ({ ...d, milestones: saved })); }
      const text = tr('Konfiguration gespeichert – wirkt sofort', 'Configuration saved – effective immediately');
      if (!prevCfg.setupComplete) toast({ text, icon: 'check' });
      else done(text, 'settings', tr('Konfigurationsänderung', 'configuration change'), async () => {
        if (wasDirty) { const c = await saveCfg(prevCfg); setCfg(c); setData((d) => ({ ...d, config: c })); if (!delegate && JSON.stringify(c.teams ?? null) !== JSON.stringify(cfg.teams ?? null)) reload?.(); }
        if (wasMs) { const m = await call('milestones.save', { milestones: prevMs }); setMs(m); setData((d) => ({ ...d, milestones: m })); }
      }, ['config']);
    } catch (e) { toast({ text: errText(e), error: true }); } finally { setSaving(false); }
  };
  const go = (id) => { setSec(id); refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const props = { cfg, upd, meta, delegate, reload: loadAll };
  const sections = delegate ? SECTIONS.filter(([id]) => DELEGATE_SECTIONS.includes(id)) : SECTIONS;
  const changes = [...new Set(Object.keys(CHANGE_LABELS).filter((k) => cfg[k] !== undefined && JSON.stringify(cfg[k]) !== JSON.stringify(data.config[k])).map((k) => tr(...CHANGE_LABELS[k])))]
    .concat(msDirty ? [tr('Meilensteine', 'Milestones')] : []);
  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      {!data.config.setupComplete && (
        <motion.div className="callout accent" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
          <Icon name="sparkle" /><div><b>{tr('Willkommen! Wir haben eure Jira-Struktur erkannt.', 'Welcome! We detected your Jira structure.')}</b> {tr('Prüfe die Vorschläge unten und speichere – danach ist das Cockpit für alle sichtbar.', 'Review the suggestions below and save – the cockpit then becomes available to everyone.')}</div>
        </motion.div>
      )}
      {!delegate && meta?.staleFields?.length > 0 && (
        <div className="callout warn" data-stale-fields><Icon name="alert" /><div>
          <b>{tr('Zugeordnete Felder fehlen in Jira', 'Mapped fields are missing in Jira')}</b>{' – '}
          {tr('gelöscht oder für dich nicht sichtbar:', 'deleted or not visible to you:')} {meta.staleFields.map((f) => `${tr(...(STALE_LABELS[f.usage] || [f.usage, f.usage]))} (${f.id})`).join(', ')}.{' '}
          {tr('Bis du unter „Felder“ ein anderes Feld wählst oder die Zuordnung leerst, bleiben diese Werte im Cockpit leer.', 'Until you choose another field under "Fields" or clear the mapping, these values stay empty in the cockpit.')}
        </div></div>
      )}
      <div className="admin">
        <nav className="admin-nav" aria-label={tr('Abschnitte', 'Sections')}>
          {sections.map(([id, icon, de, en]) => (
            <button key={id} aria-current={sec === id} onClick={() => go(id)}>
              {sec === id && <motion.span layoutId="admin-nav" className="admin-nav-bg" transition={spring} />}
              <Icon name={icon} size={15} />{tr(de, en)}
            </button>
          ))}
        </nav>
        <div className="stack" style={{ gap: 20 }}>
          {!delegate && !guideSeen && <SetupGuide go={go} onClose={() => { setGuideSeen(true); call('prefs.save', { hints: { admin: true } }).catch(() => {}); }} />}
          {delegate && <div className="callout"><Icon name="info" /><div>{tr('Du pflegst die Portfolio-Einstellungen als Mitglied der Einstellungs-Gruppe. Hierarchie, Felder, Berechtigungen und Datenschutz ändern Jira-Admins in der App-Konfiguration.', 'You maintain the portfolio settings as a member of the settings group. Hierarchy, fields, permissions and privacy are changed by Jira admins in the app configuration.')}</div></div>}
          {sections.map(([id, icon, de, en], i) => (
            <motion.section key={id} ref={(el) => { refs.current[id] = el; }} className="card" {...stagger(i, 0.04)} onMouseEnter={() => setSec(id)} style={{ scrollMarginTop: 12 }}>
              <div className="card-head"><h2 className="card-title"><Icon name={icon} />{tr(de, en)}</h2></div>
              <div className="card-pad">
                {id === 'hierarchy' && <Hierarchy {...props} />}
                {id === 'fields' && <Fields {...props} saved={data.config} />}
                {id === 'teams' && <TeamsSettings {...props} computed={computed} />}
                {id === 'deps' && <Deps {...props} />}
                {id === 'perms' && <Perms {...props} />}
                {id === 'ai' && <AiSettings {...props} saved={data.config} />}
                {id === 'usage' && <UsageStats />}
                {id === 'sizes' && <Sizes {...props} />}
                {id === 'rules' && <Rules {...props} />}
                {id === 'booking' && <Booking {...props} />}
                {id === 'notices' && <Notices {...props} computed={computed} />}
                {id === 'locations' && <Locations cfg={cfg} upd={upd} />}
                {id === 'snapshot' && <SnapshotSettings value={cfg.snapshot} onChange={(v) => upd((c) => { c.snapshot = v; })} />}
                {id === 'versions' && <Versions {...props} savedAt={savedAt} milestones={ms} onImport={(c, m) => { setCfg(c); setDirty(true); if (m) { setMs(m); setMsDirty(true); } }} />}
                {id === 'milestones' && <Milestones ms={ms} setMs={(fn) => { setMs(fn); setMsDirty(true); }} status={computed?.milestones} />}
                {id === 'support' && <SupportCfg {...props} />}
                {id === 'capacity' && <CapDefaults {...props} />}
                {id === 'audit' && <Audit />}
              </div>
            </motion.section>
          ))}
        </div>
      </div>
      <AnimatePresence>
        {(dirty || msDirty) && (
          <motion.div className="savebar" initial={{ y: 80, opacity: 0, x: '-50%' }} animate={{ y: 0, opacity: 1, x: '-50%' }} exit={{ y: 80, opacity: 0, x: '-50%' }} transition={spring}>
            {problems.length ? <span className="row" style={{ gap: 6 }}><Icon name="alert" size={14} />{problems[0]}</span> : <span>{changes.length ? <>{tr('Wird geändert:', 'Will change:')} <b>{changes.join(', ')}</b></> : tr('Ungespeicherte Änderungen', 'Unsaved changes')}</span>}
            <button className="btn btn-ghost btn-sm" onClick={() => { setCfg(data.config.setupComplete ? data.config : cfg); setMs(data.milestones); setDirty(!data.config.setupComplete); setMsDirty(false); }}>{tr('Verwerfen', 'Discard')}</button>
            <button className="btn btn-primary btn-sm" disabled={saving || problems.length > 0} onClick={save}>{saving ? tr('Speichere …', 'Saving …') : tr('Speichern', 'Save')}</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// single: exactly one type (the project type – boss 2026-11-18); a chosen type always stays visible so it can be removed
// First steps for a new Jira admin (boss review 2026-11-18): the order that makes the cockpit useful, each a jump to its
// section. Shown until closed; "?" in the header restarts the tour for everyone else.
const GUIDE_STEPS = [
  ['hierarchy', 'Was ist ein Projekt? Issue Type oder Space wählen, dann die Ebenen darunter.', 'What is a project? Choose an issue type or a space, then the levels below.'],
  ['fields', 'Team, Startdatum und Owner zuordnen – leer lassen, was es bei euch nicht gibt.', 'Map team, start date and owner – leave empty what you do not have.'],
  ['teams', 'Prüfen, dass „Verbunden“ steht, und wählen, welche Teams erscheinen.', 'Check it says "Connected" and choose which teams appear.'],
  ['perms', 'Gruppen für Projekt-Admin und Management zuordnen.', 'Map the groups for project admin and management.'],
  ['locations', 'Standorte mit ihren Feiertagen anlegen.', 'Create locations with their public holidays.'],
  ['support', 'Optional: Service-Spaces oder Software-Spaces für Support wählen.', 'Optional: choose service spaces or software spaces for support.'],
];
function SetupGuide({ go, onClose }) {
  return (
    <div className="callout accent setup-guide" data-setup-guide>
      <Icon name="sparkle" />
      <div className="grow">
        <b>{tr('In 6 Schritten eingerichtet', 'Set up in 6 steps')}</b>{' '}<span className="muted">{tr('– danach pflegt ihr Stunden unter Teams › Kapazitäten pflegen.', '– then maintain hours under Teams › Maintain capacities.')}</span>
        <ol className="setup-steps">{GUIDE_STEPS.map(([id, de, en], i) => <li key={id}><button type="button" className="linkbtn" onClick={() => go(id)}><span className="num">{i + 1}</span>{tr(de, en)}</button></li>)}</ol>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{tr('Verstanden', 'Got it')}</button>
    </div>
  );
}

// Issue type chips of ONE hierarchy level (boss 2026-11-18, round 3: "only show relevant issue types on this level – not
// all, this is too much"): the selected types and the ones that occur in the portfolio's work items first, the rest of
// this level behind "+ n more". Without portfolio data (Jira admin page) every type of the level is shown.
function TypeChips({ types, value, onChange, single = false, relevant = null, disabled = false }) {
  const [more, setMore] = useState(false);
  const pick = (t) => onChange(single ? (value.includes(t.id) ? [] : [t.id]) : value.includes(t.id) ? value.filter((x) => x !== t.id) : [...value, t.id]);
  const main = relevant ? types.filter((t) => value.includes(t.id) || relevant.has(String(t.id))) : types;
  const rest = types.filter((t) => !main.includes(t));
  const shown = more || !main.length ? types : main;
  return (
    <div className="type-chips">
      <div className="row wrap" style={{ gap: 5 }} role={single ? 'radiogroup' : 'group'}>
        {shown.map((t) => {
          const on = value.includes(t.id);
          return (
            <motion.button key={t.id} type="button" whileTap={{ scale: 0.94 }} disabled={disabled} className={`chip ${on ? 'chip-accent' : 'chip-outline'}`} role={single ? 'radio' : undefined} aria-checked={single ? on : undefined} aria-pressed={single ? undefined : on} onClick={() => pick(t)}
              title={relevant && !relevant.has(String(t.id)) ? tr('Kommt im Portfolio bisher nicht vor', 'Does not occur in the portfolio yet') : undefined}>
              {t.name}
            </motion.button>
          );
        })}
        {!types.length && <span className="faint" style={{ fontSize: 12 }}>{tr('Keine Issue Types auf dieser Ebene', 'No issue types on this level')}</span>}
        {main.length > 0 && rest.length > 0 && (
          <button type="button" className="linkbtn type-more" onClick={() => setMore((v) => !v)} aria-expanded={more} data-type-more>
            {more ? tr('Nur relevante zeigen', 'Show relevant only') : tr(`+ ${rest.length} weitere dieser Ebene`, `+ ${rest.length} more of this level`)}
          </button>
        )}
      </div>
    </div>
  );
}

// on / off of one hierarchy level (a real switch with its own name for screen readers). Hovering it shows what the level
// does, what is in it and what the switch would change – a locked switch says why (boss 2026-11-18: "a simple hover …
// nice, informative and tidy", in the look of the KPI cards). Locked = aria-disabled, not disabled: a disabled button gets
// no hover and could not explain itself.
function LevelSwitch({ on, onChange, label, locked = false, card }) {
  const tip = useTip();
  return (
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} aria-disabled={locked || undefined} className="switch lvl-switch" data-on={!!on} data-locked={locked || undefined}
      onClick={() => { if (!locked) onChange?.(!on); }} {...(card ? tip(infoCard(card)) : {})}>
      <span className="switch-track" aria-hidden="true">
        <motion.span className="switch-thumb" initial={false} animate={{ x: on ? 15 : 0 }} transition={spring} />
      </span>
    </button>
  );
}

// Hierarchy (boss 2026-11-18, round 3): every level of the site's Jira hierarchy is a row, highest first, each switched on
// or off – "on" = relevant for the portfolio. The level above the projects is the theme level (e.g. Themes over
// Project); a switched-off level is passed through (its work items leave the cockpit, their children stay with the project).
function Hierarchy({ cfg, upd, meta }) {
  const { ds } = useApp();
  const types = meta.issueTypes || [];
  const levelOf = (id) => types.find((t) => t.id === id)?.level;
  const typesAt = (h) => types.filter((t) => t.level === h);
  const hs = [...new Set(types.map((t) => t.level).filter(Number.isInteger))].sort((a, b) => b - a);
  // the types that occur in the cockpit's data – shown first; the others of a level on request
  const seen = useMemo(() => (ds ? new Set([...(ds.issues || []), ...(ds.portfolio || []), ...(ds.themes || [])].map((x) => x.type?.id).filter(Boolean).map(String)) : null), [ds]);
  const issueMode = cfg.portfolio.source === 'issue';
  const P = issueMode ? levelOf(cfg.portfolio.issueTypeIds[0]) ?? null : null;
  const group = cfg.portfolio.group || { active: true, name: '', issueTypeIds: [] };
  const hOf = (l) => (Number.isInteger(l.hierarchy) ? l.hierarchy : (() => { const ls = l.issueTypeIds.map(levelOf).filter(Number.isInteger); return ls.length ? Math.max(...ls) : null; })());
  const entries = [...cfg.levels.map((l, i) => ({ l, i, on: true })), ...(cfg.levelsOff || []).map((l, i) => ({ l, i, on: false }))];
  const hasRough = cfg.levels.some((l) => l.role === 'rough');
  const newKey = (c, h) => { const used = new Set([...c.levels, ...(c.levelsOff || [])].map((l) => l.key)); let k = `l${h + 2}`; while (used.has(k)) k = `l${h + 2}${Math.random().toString(36).slice(2, 5)}`; return k; };
  const names = (list) => list.map((t) => t.name).join(', ').slice(0, 60);
  const guessRole = (c, h) => (h <= -1 ? 'tiny' : h === 0 && !c.levels.some((l) => l.role === 'estimate') ? 'estimate' : h >= 2 && !c.levels.some((l) => l.role === 'rough') ? 'rough' : 'structure');
  const relevantOf = (h) => typesAt(h).filter((t) => !seen || seen.has(String(t.id)));

  const toggle = (e, next) => upd((c) => {
    c.levelsOff = c.levelsOff || [];
    const from = e.on ? c.levels : c.levelsOff, to = next ? c.levels : c.levelsOff;
    const [l] = from.splice(e.i, 1);
    to.push(l);
    if (next && !c.matrix[l.key]) c.matrix[l.key] = { ...(DEFAULT_MATRIX[l.role] || {}) };
    const order = (x) => -(hOf(x) ?? -9);
    c.levels.sort((a, b) => order(a) - order(b));
  });
  const create = (h) => upd((c) => {
    const key = newKey(c, h);
    const role = guessRole(c, h);
    const list = relevantOf(h).length ? relevantOf(h) : typesAt(h);
    c.levels.push({ key, name: names(list) || `L${h}`, role, issueTypeIds: list.map((t) => t.id), hierarchy: h });
    c.matrix[key] = { ...(DEFAULT_MATRIX[role] || {}) };
    c.levels.sort((a, b) => -(hOf(a) ?? -9) + (hOf(b) ?? -9));
  });
  const setLevel = (e, fn) => upd((c) => { fn(e.on ? c.levels[e.i] : c.levelsOff[e.i], c); });
  // the project level moves: levels at or above it leave, the old project level becomes the level right below it
  const setProjectLevel = (h) => upd((c) => {
    const at = typesAt(h);
    const t = at.find((x) => /^(project|projekt)$/i.test(x.name)) || at[0];
    if (!t) return;
    const oldTypes = c.portfolio.issueTypeIds, oldH = P;
    c.portfolio.issueTypeIds = [t.id];
    const keep = (list) => list.filter((l) => { const lh = hOf(l); return lh == null || lh < h; });
    c.levels = keep(c.levels); c.levelsOff = keep(c.levelsOff || []);
    if (oldH != null && oldH < h) {
      const key = newKey(c, oldH), role = c.levels.some((l) => l.role === 'rough') ? 'structure' : 'rough';
      c.levels.push({ key, name: names(typesAt(oldH)) || `L${oldH}`, role, issueTypeIds: oldTypes, hierarchy: oldH });
      c.matrix[key] = { ...(DEFAULT_MATRIX[role] || {}) };
      c.levels.sort((a, b) => -(hOf(a) ?? -9) + (hOf(b) ?? -9));
    }
    const above = typesAt(h + 1);
    c.portfolio.group = { active: above.length > 0, name: names(above), issueTypeIds: above.map((x) => x.id) };
  });
  const detect = async () => { const d = await call('config.detect'); upd((c) => { c.portfolio = d.portfolio; c.levels = d.levels; c.levelsOff = d.levelsOff || []; c.matrix = d.matrix; c.fields = { ...c.fields, ...Object.fromEntries(Object.entries(d.fields).filter(([, v]) => v)) }; c.dependencies = d.dependencies; }); };

  const rows = [];
  if (!issueMode) rows.push({ kind: 'space', h: null });
  for (const h of hs) {
    if (issueMode && P != null && h > P) { rows.push({ kind: h === P + 1 ? 'group' : 'above', h }); continue; }
    if (issueMode && h === P) { rows.push({ kind: 'portfolio', h }); continue; }
    const here = entries.filter((e) => hOf(e.l) === h);
    if (here.length) for (const e of here) rows.push({ kind: 'level', h, e });
    else rows.push({ kind: 'empty', h });
  }
  for (const e of entries.filter((x) => hOf(x.l) == null)) rows.push({ kind: 'level', h: null, e }); // a level without issue types
  const projectLevels = hs.filter((h) => h >= 1 && typesAt(h).length);
  // hover cards of the switches – what the level does, what is in it, what a click changes (or why it cannot)
  const onOff = (v) => (v ? tr('An', 'On') : tr('Aus', 'Off'));
  const ROLE_TEXT = {
    rough: tr('Trägt T-Shirt-Größe und Ziel-Quartale – die Grobplanung, solange noch nicht geschätzt ist.', 'Carries T-shirt size and target quarters – the rough plan while nothing is estimated yet.'),
    structure: tr('Gliedert die Arbeit eines Projekts – mit Fortschritt und Pflichtfeldern, aber ohne eigene Stunden.', 'Structures a project\'s work – with progress and required fields, but no hours of its own.'),
    estimate: tr('Hier kommen Original Estimate, Restaufwand und gebuchte Zeit her – die Grundlage für Kapazität, Wasserlinie, Wochenplanung und Plan vs. Ist.', 'Original estimate, remaining estimate and logged time come from here – the basis for capacity, waterline, weekly planning and plan vs. actual.'),
    tiny: tr('Kleinst-Tasks: ihre Zeiten zählen zur Arbeit darüber.', 'Tiny tasks: their time counts towards the work above them.'),
  };
  const countOf = (key) => (ds ? (ds.issues || []).filter((i) => i.levelKey === key).length : null);
  const typeNames = (ids) => types.filter((t) => ids.includes(t.id)).map((t) => t.name);
  const typeLine = (list) => (list.length ? `${list.slice(0, 3).join(', ')}${list.length > 3 ? ` +${list.length - 3}` : ''}` : '–');
  const cards = {
    space: () => ({ title: 'Space', sub: tr('Immer an', 'Always on'), text: tr('Jeder Jira-Space ist ein Projekt im Portfolio.', 'Every Jira space is a project in the portfolio.'), hint: tr('Projekte sind Spaces – diese Ebene trägt das Portfolio und lässt sich nicht ausschalten.', 'Projects are spaces – this level carries the portfolio and cannot be switched off.') }),
    above: (h) => ({ title: `${names(typesAt(h))} · L${h}`, sub: tr('Nicht nutzbar', 'Not usable'), text: tr('Das Cockpit fasst Projekte unter genau einer Ebene zusammen: der direkt über den Projekten.', 'The cockpit groups projects under exactly one level: the one directly above them.'), inputs: [[tr('Issue Types', 'Issue types'), typeLine(typesAt(h).map((t) => t.name))]], hint: tr('Soll diese Ebene die Projekte zusammenfassen, oben eine höhere Projekt-Ebene wählen.', 'For this level to group the projects, choose a higher project level above.') }),
    group: (h) => ({
      title: `${group.name || tr('Themen', 'Themes')} · L${h}`, sub: onOff(group.active),
      text: tr('Die Ebene über den Projekten. Im Portfolio fasst sie die Projekte zu Themen zusammen – mit Stunden, Besetzbarkeit und Health je Thema.', 'The level above the projects. In the portfolio it groups the projects into themes – with hours, staffing and health per theme.'),
      inputs: [[tr('Status', 'Status'), onOff(group.active)], [tr('Issue Types', 'Issue types'), group.issueTypeIds.length ? typeLine(typeNames(group.issueTypeIds)) : tr('jeder übergeordnete Vorgang', 'any parent work item')],
        ...(ds ? [[tr('Themen geladen', 'Themes loaded'), String((ds.themes || []).length)], [tr('Projekte mit Thema', 'Projects with a theme'), `${(ds.portfolio || []).filter((p) => p.themeId).length} / ${(ds.portfolio || []).length}`]] : [])],
      hint: group.active ? tr('Klick: ausschalten – das Portfolio zeigt dann keine Themen.', 'Click: switch off – the portfolio then shows no themes.') : tr('Klick: einschalten – die Projekte werden nach Themen zusammengefasst.', 'Click: switch on – the projects are grouped by theme.'),
    }),
    portfolio: (h) => ({
      title: `${tr('Projekte', 'Projects')} · L${h}`, sub: tr('Immer an', 'Always on'),
      text: tr('Hier liegen die Portfolio-Projekte: Rang, Owner, Health und Ziel-Quartale. Ohne Projekt-Ebene gibt es kein Portfolio – deshalb bleibt sie an.', 'This is where the portfolio projects live: rank, owner, health and target quarters. Without a project level there is no portfolio – so it stays on.'),
      inputs: [[tr('Issue Type', 'Issue type'), typeLine(typeNames(cfg.portfolio.issueTypeIds))], ...(ds ? [[tr('Projekte im Portfolio', 'Projects in the portfolio'), String((ds.portfolio || []).length)]] : [])],
      hint: tr('Eine andere Ebene als Projekte? Oben unter „Projekt-Ebene“ wählen.', 'Another level as projects? Choose it above under "Project level".'),
    }),
    empty: (h) => ({ title: `${names(typesAt(h))} · L${h}`, sub: tr('Aus', 'Off'), text: tr('Diese Ebene ist nicht Teil des Cockpits. Ihre Vorgänge werden übersprungen – was darunter liegt, gehört weiter zum Projekt.', 'This level is not part of the cockpit. Its work items are skipped – what lies below still belongs to the project.'),
      inputs: [[tr('Issue Types', 'Issue types'), typeLine(typesAt(h).map((t) => t.name))]], hint: tr('Klick: einschalten – die Ebene bekommt eine passende Rolle, die du danach ändern kannst.', 'Click: switch on – the level gets a fitting role you can change afterwards.') }),
    level: (e, h, locked) => {
      const n = e.on ? countOf(e.l.key) : null;
      return {
        title: `${e.l.name || tr('Ebene', 'Level')}${h == null ? '' : ` · L${h}`}`, sub: e.on ? roleName(e.l.role) : tr('Aus', 'Off'),
        text: e.on ? ROLE_TEXT[e.l.role] : tr('Diese Ebene ist ausgeschaltet. Ihre Vorgänge werden übersprungen – was darunter liegt, gehört weiter zum Projekt.', 'This level is switched off. Its work items are skipped – what lies below still belongs to the project.'),
        inputs: [[tr('Status', 'Status'), onOff(e.on)], [tr('Rolle', 'Role'), roleName(e.l.role)], [tr('Issue Types', 'Issue types'), typeLine(typeNames(e.l.issueTypeIds))], ...(n != null ? [[tr('Vorgänge im Portfolio', 'Work items in the portfolio'), String(n)]] : [])],
        hint: locked
          ? tr('Immer an: die einzige Ebene mit Schätzung & Zeiterfassung – ohne sie hat das Cockpit keine Stunden. Zum Ausschalten zuerst eine andere Ebene auf „Schätzung & Zeiterfassung“ stellen.', 'Always on: the only level with estimation & time tracking – without it the cockpit has no hours. To switch it off, first set another level to "Estimation & time tracking".')
          : e.on ? tr('Klick: ausschalten – die Vorgänge werden übersprungen, was darunter liegt, gehört weiter zum Projekt.', 'Click: switch off – the work items are skipped, what lies below still belongs to the project.')
            : tr('Klick: einschalten – mit der Rolle und den Issue Types von vorher.', 'Click: switch on – with the role and issue types it had before.'),
      };
    },
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid-2" style={{ gap: 12 }}>
        <button className="choice" aria-pressed={issueMode} onClick={() => upd((c) => { c.portfolio.source = 'issue'; })}>
          <Icon name="layers" size={22} /><span><b>{tr('Projekte sind Vorgänge', 'Projects are work items')}</b><div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{tr('Ein Issue Type (z. B. „Project") in der Plans-Hierarchie. Empfohlen für Jira Premium.', 'An issue type (e.g. "Project") in the Plans hierarchy. Recommended for Jira Premium.')}</div></span>
        </button>
        <button className="choice" aria-pressed={!issueMode} onClick={() => upd((c) => { c.portfolio.source = 'space'; c.portfolio.issueTypeIds = []; })}>
          <Icon name="project" size={22} /><span><b>{tr('Projekte sind Spaces', 'Projects are spaces')}</b><div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{tr('Jeder Jira-Space ist ein Projekt. Funktioniert auf jeder Jira-Edition.', 'Every Jira space is a project. Works on every Jira edition.')}</div></span>
        </button>
      </div>
      <div>
        <div className="row wrap" style={{ justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
          <div>
            <div className="label" style={{ margin: 0 }}>{tr('Ebenen der Jira-Hierarchie (oben = höchste)', 'Levels of the Jira hierarchy (top = highest)')}</div>
            <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{tr('Einschalten, was für das Portfolio relevant ist. Eine ausgeschaltete Ebene wird übersprungen – ihre Vorgänge darunter gehören weiter zum Projekt.', 'Switch on what is relevant for the portfolio. A switched-off level is skipped – the work items below it still belong to the project.')}</div>
          </div>
          <span className="row" style={{ gap: 4 }}>
            {issueMode && projectLevels.length > 1 && (
              <label className="row" style={{ gap: 6, fontSize: 12.5 }}>{tr('Projekt-Ebene', 'Project level')}
                <select className="select select-sm" value={P ?? ''} onChange={(e) => setProjectLevel(+e.target.value)} aria-label={tr('Projekt-Ebene', 'Project level')} data-project-level>
                  {P == null && <option value="">–</option>}
                  {projectLevels.map((h) => <option key={h} value={h}>L{h} · {names(typesAt(h))}</option>)}
                </select>
              </label>
            )}
            <button className="btn btn-ghost btn-sm" onClick={detect}><Icon name="sparkle" />{tr('Automatisch erkennen', 'Detect automatically')}</button>
          </span>
        </div>
        <div className="stack" style={{ gap: 8 }} data-hierarchy-rows>
          {rows.map((r) => {
            if (r.kind === 'space') return (
              <div key="space" className="lvl-row on" style={{ background: 'var(--sunken)' }}>
                <LevelSwitch on locked label="Space" card={cards.space()} /><span className="level-num">·</span><b>Space</b>
                <span className="chip chip-accent">{roleName('portfolio')}{!hasRough && ` + ${roleName('rough')}`}</span>
                <span className="muted" style={{ fontSize: 12.5 }}>{tr('Rang, Owner, Health, Ziel-Quartale', 'Rank, owner, health, target quarters')}</span>
              </div>
            );
            if (r.kind === 'above') return (
              <div key={`a${r.h}`} className="lvl-row off" data-level={r.h}>
                <LevelSwitch on={false} locked label={`L${r.h}`} card={cards.above(r.h)} /><span className="level-num">L{r.h}</span><b>{names(typesAt(r.h))}</b>
                <span className="faint" style={{ fontSize: 12 }}>{tr('Nicht genutzt – das Cockpit fasst Projekte unter der Ebene direkt darüber zusammen.', 'Not used – the cockpit groups projects under the level directly above them.')}</span>
              </div>
            );
            if (r.kind === 'group') return (
              <div key="group" className={`lvl-row ${group.active ? 'on' : 'off'}`} data-level={r.h} data-level-group>
                <LevelSwitch on={group.active} card={cards.group(r.h)} label={tr(`Themen-Ebene L${r.h} ein/aus`, `Theme level L${r.h} on/off`)} onChange={(v) => upd((c) => { c.portfolio.group = { ...group, active: v }; })} />
                <span className="level-num">L{r.h}</span>
                <input className="input input-sm" value={group.name} placeholder={tr('Themen', 'Themes')} maxLength={60} onChange={(e) => upd((c) => { c.portfolio.group = { ...group, name: e.target.value }; })} aria-label={tr('Name der Themen-Ebene', 'Theme level name')} />
                <span className="chip">{tr('Themen – über den Projekten', 'Themes – above the projects')}</span>
                {group.active
                  ? <div className="stack" style={{ gap: 4 }}><TypeChips types={typesAt(r.h)} relevant={seen} value={group.issueTypeIds} onChange={(v) => upd((c) => { c.portfolio.group = { ...group, issueTypeIds: v }; })} />
                    {!group.issueTypeIds.length && <span className="faint" style={{ fontSize: 11.5 }}>{tr('Kein Typ gewählt: jeder übergeordnete Vorgang eines Projekts ist sein Thema.', 'No type chosen: each project\'s parent work item is its theme.')}</span>}</div>
                  : <span className="faint" style={{ fontSize: 12 }}>{tr('Aus – Projekte werden nicht nach Themen zusammengefasst.', 'Off – projects are not grouped by theme.')}</span>}
              </div>
            );
            if (r.kind === 'portfolio') return (
              <div key="portfolio" className="lvl-row on" style={{ background: 'var(--sunken)' }} data-level={r.h} data-level-portfolio>
                <LevelSwitch on locked label={tr('Projekt-Ebene', 'Project level')} card={cards.portfolio(r.h)} />
                <span className="level-num">L{r.h}</span>
                <b>{tr('Projekte', 'Projects')}</b>
                <span className="chip chip-accent">{roleName('portfolio')}{!hasRough && ` + ${roleName('rough')}`}</span>
                <div className="stack" style={{ gap: 4 }}>
                  <TypeChips single types={typesAt(r.h)} relevant={seen} value={cfg.portfolio.issueTypeIds} onChange={(v) => upd((c) => { c.portfolio.issueTypeIds = v; })} />
                  <span className="faint" style={{ fontSize: 11.5 }}>{tr('Genau ein Issue Type · Rang, Owner, Health, Ziel-Quartale', 'Exactly one issue type · rank, owner, health, target quarters')}</span>
                </div>
              </div>
            );
            if (r.kind === 'empty') return (
              <div key={`e${r.h}`} className="lvl-row off" data-level={r.h}>
                <LevelSwitch on={false} card={cards.empty(r.h)} label={tr(`Ebene L${r.h} ein/aus`, `Level L${r.h} on/off`)} onChange={() => create(r.h)} />
                <span className="level-num">L{r.h}</span><b>{names(relevantOf(r.h).length ? relevantOf(r.h) : typesAt(r.h))}</b>
                <span className="faint" style={{ fontSize: 12 }}>{tr('Aus – einschalten, wenn diese Ebene für das Portfolio relevant ist.', 'Off – switch on when this level is relevant for the portfolio.')}</span>
              </div>
            );
            const { e } = r, l = e.l;
            const onlyEstimate = e.on && l.role === 'estimate' && cfg.levels.filter((x) => x.role === 'estimate').length === 1;
            return (
              <div key={l.key} className={`lvl-row ${e.on ? 'on' : 'off'}`} data-level={r.h ?? ''}>
                <LevelSwitch on={e.on} locked={onlyEstimate} card={cards.level(e, r.h, onlyEstimate)} label={tr(`${l.name} ein/aus`, `${l.name} on/off`)} onChange={(v) => toggle(e, v)} />
                <span className="level-num">{r.h == null ? '–' : `L${r.h}`}</span>
                <input className="input input-sm" value={l.name} maxLength={60} onChange={(ev) => setLevel(e, (x) => { x.name = ev.target.value; })} aria-label={tr('Name der Ebene', 'Level name')} />
                <select className="select select-sm" value={l.role} disabled={!e.on} onChange={(ev) => setLevel(e, (x, c) => { x.role = ev.target.value; c.matrix[x.key] = { ...(DEFAULT_MATRIX[ev.target.value] || {}) }; })} aria-label={tr('Rolle', 'Role')}>
                  {ROLE_OPTS.map((ro) => <option key={ro} value={ro}>{roleName(ro)}</option>)}
                </select>
                {e.on
                  ? <TypeChips types={r.h == null ? types.filter((t) => l.issueTypeIds.includes(t.id)) : typesAt(r.h)} relevant={seen} value={l.issueTypeIds} onChange={(v) => setLevel(e, (x) => { x.issueTypeIds = v; })} />
                  : <span className="faint" style={{ fontSize: 12 }}>{tr('Aus – wird übersprungen; die Vorgänge darunter gehören weiter zum Projekt.', 'Off – skipped; the work items below still belong to the project.')}</span>}
              </div>
            );
          })}
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>{tr('Grobplanung und Schätzung kommen genau einmal vor. Ohne eigene Grobplanungs-Ebene trägt das Projekt selbst T-Shirt-Größe und Ziel-Quartale.', 'Rough planning and estimation occur exactly once. Without a rough-planning level the project itself carries T-shirt size and target quarters.')}</div>
      </div>
      <Switch on={cfg.portfolio.autoRemoveDone} onChange={(v) => upd((c) => { c.portfolio.autoRemoveDone = v; })} label={tr('Abgeschlossene Projekte (Status-Kategorie „Erledigt") automatisch aus dem Portfolio nehmen', 'Automatically remove completed projects (status category "Done") from the portfolio')} />
    </div>
  );
}

const FIELD_SLOTS = [
  { k: 'owner', de: 'Owner (Projektverantwortliche:r)', en: 'Owner (accountable person)', none: ['— Jira-Assignee (Standard) —', '— Jira Assignee (default) —'], filter: (f) => f.type === 'user' || f.items === 'user' },
  { k: 'milestone', de: 'Meilenstein', en: 'Milestone', none: ['— Fix Versions → Meilensteine (Standard) —', '— Fix versions → milestones (default) —'], filter: (f) => ['date', 'datetime', 'option', 'string', 'version'].includes(f.type) || (f.type === 'array' && ['option', 'version', 'string'].includes(f.items)) },
  { k: 'team', de: 'Team-Feld (Atlassian Teams)', en: 'Team field (Atlassian Teams)', filter: (f) => /team/i.test(f.custom || '') || f.type === 'team' },
  { k: 'startDate', de: 'Start Date', en: 'Start date', filter: (f) => f.type === 'date' || f.type === 'datetime' },
  { k: 'tshirt', de: 'T-Shirt-Größe', en: 'T-shirt size', app: true, copy: true, filter: (f) => f.type === 'option' || f.type === 'string' },
  { k: 'targetQuarters', de: 'Ziel-Quartale', en: 'Target quarters', app: true, copy: true, filter: (f) => f.type === 'array' || f.type === 'string' || f.type === 'option' },
  { k: 'note', de: 'Abhängigkeits-Hinweis', en: 'Dependency note', filter: (f) => f.type === 'string' },
];
const GROUPS = [
  ['Jira-Systemfelder', 'Jira system fields', ['assignee', 'originalEstimate', 'dueDate', 'startDate', 'team', 'parent']],
  ['Custom Fields', 'Custom fields', ['owner', 'milestone', 'tshirt', 'targetQuarters']],
];
function Fields({ cfg, upd, meta, saved }) {
  const own = new Set([meta.appFields?.rank, meta.appFields?.tshirt, meta.appFields?.targetQuarters].filter(Boolean));
  const cols = [{ key: 'portfolio', name: tr('Projekt', 'Project') }, ...cfg.levels];
  const mode = (lk, u) => cfg.matrix?.[lk]?.[u] || 'ignored';
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {FIELD_SLOTS.map((s) => (
          <div key={s.k}>
            <label className="label" htmlFor={`f-${s.k}`}>{tr(s.de, s.en)}</label>
            <select id={`f-${s.k}`} className="select" style={{ width: '100%' }} value={cfg.fields[s.k] || ''} onChange={(e) => upd((c) => { c.fields[s.k] = e.target.value; })}>
              <option value="">{s.none ? tr(s.none[0], s.none[1]) : tr('— nicht verwenden —', '— not used —')}</option>
              {s.app && <option value="app">{tr('App-Feld (von Portfolio Cockpit)', 'App field (by Portfolio Cockpit)')}</option>}
              {meta.fields.filter((f) => !own.has(f.id) && s.filter(f)).map((f) => <option key={f.id} value={f.id}>{f.name} · {f.id.replace('customfield_', 'cf ')}</option>)}
            </select>
            {s.app && cfg.fields[s.k] === 'app' && <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>{tr('Von der App verwaltet – Werte pflegst du hier, nicht in Jira (dort ist der Kontext gesperrt).', 'Managed by the app – values are maintained here, not in Jira (its context is locked there).')}</div>}
            {s.app && /^customfield_/.test(cfg.fields[s.k] || '') && <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>{tr('Jira-Feld – Optionen pflegt ihr frei in Jira.', 'Jira field – your admins manage its options freely in Jira.')}</div>}
            {s.copy && saved?.fields?.[s.k] === 'app' && /^customfield_/.test(cfg.fields[s.k] || '') && <CopyValues usage={s.k} to={cfg.fields[s.k]} />}
          </div>
        ))}
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Tabelle, mit Pfeiltasten scrollbar', 'Table, scrollable with arrow keys')}>
        <table className="table matrix">
          <thead><tr><th>{tr('Feld', 'Field')}</th>{cols.map((c) => <th key={c.key}>{c.name}</th>)}</tr></thead>
          <tbody>
            {GROUPS.map(([de, en, list]) => [
              <tr key={de}><td colSpan={cols.length + 1} style={{ background: 'var(--surface-2)', fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}>{tr(de, en)}</td></tr>,
              ...list.filter((u) => USAGES.includes(u)).map((u) => (
                <tr key={u}>
                  <td>{usageName(u)}</td>
                  {cols.map((c) => (
                    <td key={c.key}>
                      <div className="tri" role="group" aria-label={`${usageName(u)} – ${c.name}`}>
                        {[['required', tr('Pflicht', 'Req.')], ['optional', tr('Optional', 'Opt.')], ['ignored', '—']].map(([v, l]) => (
                          <button key={v} className={v} aria-pressed={mode(c.key, u) === v} onClick={() => upd((x) => { x.matrix[c.key] = { ...(x.matrix[c.key] || {}), [u]: v }; })}>{l}</button>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <div className="faint" style={{ fontSize: 12 }}>{tr('Nur Pflichtfelder werden in der Datenqualität geprüft. „Portfolio Rank" ist schreibgeschützt auf Jira-Masken und in JQL nutzbar:', 'Only required fields are checked in data quality. "Portfolio Rank" is read-only on Jira screens and usable in JQL:')} <span className="mono">"Portfolio Rank" &lt;= 5</span></div>
    </div>
  );
}

function Deps({ cfg, upd, meta }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div><div className="label">{tr('Link-Typen, die als Abhängigkeit gelten', 'Link types that count as dependencies')}</div>
        <div className="row wrap" style={{ gap: 6 }}>
          {meta.linkTypes.map((l) => {
            const on = cfg.dependencies.linkTypeIds.includes(l.id);
            return <motion.button key={l.id} whileTap={{ scale: 0.95 }} className={`chip ${on ? 'chip-accent' : 'chip-outline'}`} style={{ height: 30, padding: '0 12px' }} aria-pressed={on}
              onClick={() => upd((c) => { c.dependencies.linkTypeIds = on ? c.dependencies.linkTypeIds.filter((x) => x !== l.id) : [...c.dependencies.linkTypeIds, l.id]; })}>{on && <Icon name="check" size={12} />}{l.name}<span className="faint">„{l.outward}"</span></motion.button>;
          })}
        </div>
      </div>
      {cfg.dependencies.linkTypeIds.length > 0 && (
        <div><div className="label">{tr('Richtung je Link-Typ (D16)', 'Direction per link type (D16)')}</div>
          <div className="stack" style={{ gap: 6 }}>
            {meta.linkTypes.filter((l) => cfg.dependencies.linkTypeIds.includes(l.id)).map((l) => {
              const rev = (cfg.dependencies.reversedLinkTypeIds || []).includes(l.id);
              return (
                <div key={l.id} className="row" style={{ gap: 12 }}>
                  <b style={{ width: 140, fontWeight: 540 }}>{l.name}</b>
                  <Segmented size="sm" value={rev ? 'rev' : 'fwd'} onChange={(v) => upd((c) => { const cur = new Set(c.dependencies.reversedLinkTypeIds || []); if (v === 'rev') cur.add(l.id); else cur.delete(l.id); c.dependencies.reversedLinkTypeIds = [...cur]; })}
                    options={[{ value: 'fwd', label: tr(`A „${l.outward}" B → A ist Voraussetzung`, `A "${l.outward}" B → A is prerequisite`) }, { value: 'rev', label: tr(`A „${l.outward}" B → B ist Voraussetzung`, `A "${l.outward}" B → B is prerequisite`) }]} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="callout"><Icon name="info" />{tr('Standard: Der Vorgang auf der „outward"-Seite ist die Voraussetzung (z. B. A „blocks" B). Das Hinweisfeld wählst du unter „Felder".', 'Default: the item on the "outward" side is the prerequisite (e.g. A "blocks" B). Choose the note field under "Fields".')}</div>
      <BlockedStatus cfg={cfg} upd={upd} meta={meta} />
    </div>
  );
}

// Which Jira status means "Blocked" (stories and sub-tasks). Nothing chosen = every status named Blocked or Blockiert.
function BlockedStatus({ cfg, upd, meta }) {
  const statuses = meta.statuses || [];
  const chosen = new Set(cfg.dependencies.blockedStatusIds || []);
  const auto = !chosen.size;
  const byName = (x) => /^(blocked|blockiert)$/i.test(x.name);
  const isOn = (x) => (auto ? byName(x) : x.ids.some((id) => chosen.has(id)));
  const toggle = (x) => upd((c) => {
    const cur = new Set(c.dependencies.blockedStatusIds?.length ? c.dependencies.blockedStatusIds : statuses.filter(byName).flatMap((y) => y.ids));
    const on = x.ids.some((id) => cur.has(id));
    x.ids.forEach((id) => (on ? cur.delete(id) : cur.add(id)));
    c.dependencies.blockedStatusIds = [...cur];
  });
  const found = statuses.filter(byName);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="label" style={{ margin: 0 }}>{tr('Status „Blocked“ (Stories und Sub-tasks)', 'Status "Blocked" (stories and sub-tasks)')}</div>
      <div className="muted" style={{ fontSize: 12.5 }}>{tr('Vorgänge in diesem Status erscheinen unter Abhängigkeiten › Blockiert, und in Teamdetails. „Seit“ kommt aus der Jira-Historie, der Grund aus dem letzten Kommentar.', 'Work items in this status appear under Dependencies › Blocked, and in Team details. "Since" comes from the Jira history, the reason from the latest comment.')}</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {statuses.map((x) => {
          const on = isOn(x);
          return <motion.button key={x.name} type="button" whileTap={{ scale: 0.95 }} className={`chip ${on ? 'chip-accent' : 'chip-outline'}`} style={{ height: 30, padding: '0 12px' }} aria-pressed={on} onClick={() => toggle(x)}>{on && <Icon name="check" size={12} />}{x.name}</motion.button>;
        })}
      </div>
      <div className={`callout ${auto && !found.length ? 'accent' : ''}`}><Icon name={auto && !found.length ? 'alert' : 'info'} />{auto
        ? (found.length ? tr(`Automatisch: der Status „${found.map((x) => x.name).join('“, „')}“. Wähle andere Status, um das festzulegen.`, `Automatic: the status "${found.map((x) => x.name).join('", "')}". Choose other statuses to set it explicitly.`)
          : tr('Auf dieser Site gibt es keinen Status „Blocked“. Lege ihn im Jira-Workflow an (Kategorie To Do, aus jedem Status erreichbar, weiter über Ready bzw. Open) oder wähle hier einen vorhandenen Status.', 'There is no "Blocked" status on this site. Add it to the Jira workflow (category To Do, reachable from every status, continuing via Ready or Open) or choose an existing status here.'))
        : <span>{tr(`${chosen.size} Status-ID(s) gewählt.`, `${chosen.size} status id(s) chosen.`)} <button type="button" className="linkbtn" onClick={() => upd((c) => { c.dependencies.blockedStatusIds = []; })}>{tr('Zurück auf automatisch', 'Back to automatic')}</button></span>}</div>
    </div>
  );
}

// Booking check (Time Spent vs. Estimate › booked hours per person): thresholds. Person-level values only.
function Booking({ cfg, upd }) {
  const b = { enabled: true, minPct: 90, escalatePct: 20, graceDays: 2, ...(cfg.booking || {}) };
  const set = (k, v) => upd((c) => { c.booking = { ...b, ...(c.booking || {}), [k]: v }; });
  if (cfg.rules.personLevel === false) {
    return <div className="callout"><Icon name="lock" />{tr('Die Buchungskontrolle braucht Werte auf Personenebene. Sie ist ausgeblendet, solange „Werte auf Personenebene anzeigen“ unter Planungsregeln aus ist.', 'The booking check needs person-level values. It stays hidden while "Show person-level values" under planning rules is off.')}</div>;
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="muted" style={{ fontSize: 13 }}>{tr('Prüft, ob jeder Mitarbeiter bis heute genug seiner möglichen Arbeitszeit gebucht hat. Mögliche Arbeitszeit = Wochenstunden laut Kapazität, ohne Feiertage und Abwesenheiten. Wer Einzelwerte sieht, legst du unter Rollen und Rechte › Datenschutz fest.', 'Checks whether everyone has booked enough of their possible working time up to today. Possible working time = weekly hours from capacity, without public holidays and absences. Who sees individual values is set under Roles and permissions › Privacy.')}</div>
      <Switch on={b.enabled} onChange={(v) => set('enabled', v)} label={tr('Buchungskontrolle aktiv (Hinweise und Eskalationen anzeigen)', 'Booking check active (show hints and escalations)')} />
      <div className="row wrap" style={{ gap: 16 }}>
        <NumField label={tr('Mindestens gebucht (% der möglichen Zeit)', 'At least booked (% of possible time)')} value={b.minPct} min={0} max={100} onChange={(v) => set('minPct', v)} />
        <NumField label={tr('Eskalation ab (% fehlend)', 'Escalation from (% missing)')} value={b.escalatePct} min={0} max={100} onChange={(v) => set('escalatePct', v)} />
        <NumField label={tr('Nachbuchfrist (Arbeitstage)', 'Grace period (workdays)')} value={b.graceDays} min={0} max={10} onChange={(v) => set('graceDays', v)} />
      </div>
      <div className="callout"><Icon name="info" />{tr(`Unter ${b.minPct} %: Hinweis. Fehlen mindestens ${b.escalatePct} % (also höchstens ${100 - b.escalatePct} % gebucht): Eskalation. Die Nachbuchfrist lässt die letzten ${b.graceDays} Arbeitstage außen vor, damit verspätete Buchungen nicht sofort auslösen. Die App zeigt Hinweise und Eskalationen an; sie verschickt keine Nachrichten.`, `Below ${b.minPct}%: a hint. At least ${b.escalatePct}% missing (at most ${100 - b.escalatePct}% booked): an escalation. The grace period leaves out the last ${b.graceDays} workdays so late bookings do not trigger at once. The app shows hints and escalations; it sends no messages.`)}</div>
    </div>
  );
}


// ---------- locations (UC-09): calendars, working days, company days off ----------
function Locations({ cfg, upd }) {
  const [people, setPeople] = useState(null);
  useEffect(() => { call('capacity.get').then((d) => setPeople(d.capacity?.people || {})).catch(() => setPeople({})); }, []);
  return <LocationsSettings value={cfg.locations || []} onChange={(v) => upd((c) => { c.locations = v; })} people={people || undefined} />;
}

// ---------- reminders & notices (UC-13, UC-19) ----------
// Everything can be set up and previewed; nothing is sent until "Nachrichten senden" is switched on.
function Notices({ cfg, upd, computed }) {
  const { setView } = useApp();
  const n = { ...DEFAULT_NOTICES, ...(cfg.notices || {}) };
  const b = { escalateTo: 'lead', schedule: 'week', ...(cfg.booking || {}) };
  const set = (k, v) => upd((c) => { c.notices = { ...n, ...(c.notices || {}), [k]: v }; });
  const setB = (k, v) => upd((c) => { c.booking = { ...b, ...(c.booking || {}), [k]: v }; });
  const [confirm, setConfirm] = useState(false);
  const preview = useMemo(() => (computed ? gapReminders(computed.dq.gaps) : null), [computed]);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className={`notice-switch ${n.enabled ? 'on' : ''}`}>
        <div style={{ minWidth: 0 }}>
          <b style={{ fontWeight: 600 }}>{n.enabled ? tr('Nachrichten werden gesendet', 'Notices are being sent') : tr('Nachrichten sind aus', 'Notices are off')}</b>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{n.enabled
            ? tr('Personen bekommen Jira-Benachrichtigungen zu ihren Vorgängen im eingestellten Rhythmus.', 'People get Jira notifications about their work items in the chosen rhythm.')
            : tr('Alles ist eingerichtet und unten als Vorschau sichtbar – es geht aber nichts raus, bis du es hier einschaltest.', 'Everything is set up and previewed below – but nothing goes out until you switch it on here.')}</div>
        </div>
        {n.enabled
          ? <button className="btn btn-sm" onClick={() => set('enabled', false)}><Icon name="x" size={13} />{tr('Ausschalten', 'Switch off')}</button>
          : confirm
            ? <div className="row" style={{ gap: 6 }}><button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>{tr('Abbrechen', 'Cancel')}</button><button className="btn btn-primary btn-sm" onClick={() => { set('enabled', true); setConfirm(false); }}>{tr('Ja, senden', 'Yes, send')}</button></div>
            : <button className="btn btn-sm" onClick={() => setConfirm(true)}><Icon name="send" size={13} />{tr('Einschalten …', 'Switch on …')}</button>}
      </div>

      <div className="perm-row">
        <span className="perm-ico"><Icon name="shield" /></span>
        <div><b style={{ fontWeight: 560 }}>{tr('Erinnerung an fehlende Werte', 'Reminder about missing values')}</b><div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{tr('Jede verantwortliche Person bekommt eine Nachricht mit ihren Lücken, dringende zuerst.', 'Each responsible person gets one message with their gaps, urgent ones first.')}</div></div>
        <Segmented size="sm" value={n.gaps} onChange={(v) => set('gaps', v)} label={tr('Rhythmus', 'Rhythm')} options={[{ value: 'off', label: tr('Aus', 'Off') }, { value: 'monday', label: tr('Montags', 'Mondays') }, { value: 'daily', label: tr('Täglich', 'Daily') }]} />
      </div>
      <div className="notice-preview-box" data-gap-preview>
        <div className="label">{tr('Vorschau: die nächste Erinnerung an fehlende Werte', 'Preview: the next reminder about missing values')}</div>
        {!preview ? <div className="muted" style={{ fontSize: 12.5 }}>{tr('Die Vorschau erscheint im Cockpit unter Konfiguration.', 'The preview appears in the cockpit under Configuration.')}</div>
          : preview.length === 0 ? <div className="callout"><Icon name="check" />{tr('Niemand hätte gerade offene Lücken.', 'Nobody has open gaps right now.')}</div>
            : <ul className="notice-preview">{preview.slice(0, 8).map((r) => (
              <li key={r.to}><b>{r.name || tr('Person', 'Person')}</b><span className="muted">{tr(`${r.count} Werte`, `${r.count} values`)}{r.urgent ? ` · ${r.urgent} ${tr('dringend', 'urgent')}` : ''}</span><span className="faint mono">{r.lines.slice(0, 2).join(' · ')}</span></li>
            ))}{preview.length > 8 && <li className="faint">{tr(`+ ${preview.length - 8} weitere Personen`, `+ ${preview.length - 8} more people`)}</li>}</ul>}
        <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>{tr('Zustellung über Jira (Benachrichtigung zu einem eurer Vorgänge) – kein externer Dienst, nichts verlässt Atlassian. Jede Sendung wird protokolliert.', 'Delivered through Jira (a notification about one of your work items) – no external service, nothing leaves Atlassian. Every run is logged.')}</div>
      </div>
      <div className="perm-row">
        <span className="perm-ico"><Icon name="clock" /></span>
        <div><b style={{ fontWeight: 560 }}>{tr('Buchungskontrolle: Hinweise und Eskalationen', 'Booking check: notices and escalations')}</b><div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{tr('Unter der Mindestquote ein Hinweis an die Person; ab der Eskalationsschwelle zusätzlich an:', 'Below the minimum rate a notice to the person; from the escalation threshold also to:')}</div></div>
        <div className="stack" style={{ gap: 8 }}>
          <Switch on={n.booking} onChange={(v) => set('booking', v)} label={tr('Hinweise zur Buchung senden', 'Send booking notices')} />
          <select className="select select-sm esc-select" value={b.escalateTo} onChange={(e) => setB('escalateTo', e.target.value)} aria-label={tr('Eskalation an', 'Escalate to')}>
            <option value="lead">{tr('Verantwortliche des Teams', "The team's responsible people")}</option>
            <option value="leadOwner">{tr('Verantwortliche des Teams und Project-Owner', "The team's responsible people and project owners")}</option>
            <option value="mgmt">{tr('Verantwortliche des Teams und Management', "The team's responsible people and management")}</option>
          </select>
          {/* who gets the escalation and where each of them is maintained (boss 2026-11-18: full names, better formatting, short) */}
          <div className="esc-where" data-lead-where role="note" aria-label={tr('Wo die Empfänger gepflegt werden', 'Where the recipients are maintained')}>
            {[
              { k: 'lead', on: true, icon: 'users', who: tr('Verantwortliche des Teams', "Team's responsible people"), where: tr('Teams › Kapazitäten pflegen', 'Teams › Maintain capacities') },
              { k: 'leadOwner', on: b.escalateTo === 'leadOwner', icon: 'project', who: 'Project-Owner', where: tr('Owner-Feld der Projekte', "Projects' owner field") },
              { k: 'mgmt', on: b.escalateTo === 'mgmt', icon: 'shield', who: 'Management', where: tr('Rollen und Rechte', 'Roles and permissions') },
            ].map((r) => (
              <div key={r.k} className={`esc-where-row${r.on ? ' on' : ''}`}>
                <Icon name={r.icon} size={13} />
                <b>{r.who}</b>
                <span>{r.where}</span>
              </div>
            ))}
            <button type="button" className="linkbtn" onClick={() => setView?.('team')}>{tr('Verantwortliche pflegen – zu Teams', 'Maintain responsible people – go to Teams')}<Icon name="arrowRight" size={12} /></button>
          </div>
          <select className="select select-sm" value={b.schedule} onChange={(e) => setB('schedule', e.target.value)} aria-label={tr('Prüfung', 'Check')}>
            <option value="day">{tr('Täglich prüfen', 'Check daily')}</option><option value="week">{tr('Wöchentlich prüfen (montags)', 'Check weekly (Mondays)')}</option><option value="month">{tr('Monatlich prüfen', 'Check monthly')}</option>
          </select>
        </div>
      </div>

    </div>
  );
}

// ---------- roles and rights (UC-08) ----------
// Mitarbeiter = every Jira user; Jira-Admin follows from the Jira permission. The admin maps groups to
// Projekt-Admin and Management and decides per role which tabs it sees and what it may do.
const MATRIX_ROLES = ['employee', 'projectAdmin', 'management'];
const rightRows = () => [[tr('Tabs', 'Tabs'), TAB_RIGHTS], [tr('Aktionen', 'Actions'), ACTION_RIGHTS]];
const RIGHT_HINT = {
  mine: ['Immer sichtbar – eigene Aufgaben und Buchungen.', 'Always visible – own work and time logs.'],
  report: ['Alle Projekte, auch ohne Zugriff auf jeden Space.', 'All projects, even without access to every space.'],
  a_rank: ['Rang per Drag & Drop, Projekte hinzufügen und entfernen.', 'Rank by drag and drop, add and remove projects.'],
  a_cap: ['Wochenstunden, Standorte, Abwesenheiten, Verantwortliche, Support-Reserve.', 'Weekly hours, locations, absences, responsible people, support reserve.'],
  a_plan: ['Aufgaben in der Wochenplanung verschieben und in Jira übernehmen.', 'Move tasks in weekly planning and apply them in Jira.'],
  a_disp: ['Support-Tickets Team und Person zuweisen.', 'Assign support tickets to a team and person.'],
  a_health: ['Health aller Projekte – Owner dürfen ihr eigenes immer.', 'Health of every project – owners can always update their own.'],
};
function Perms({ cfg, upd }) {
  const roles = cfg.roles || { groups: { projectAdmin: [], management: [] }, rights: {}, adminPersonValues: false };
  const setRoles = (fn) => upd((c) => { c.roles = structuredClone(c.roles || roles); fn(c.roles); });
  const has = (role, r) => (roles.rights?.[role] || []).includes(r);
  const toggle = (role, r) => setRoles((x) => { const l = new Set(x.rights[role] || []); if (l.has(r)) l.delete(r); else l.add(r); x.rights[role] = [...l]; });
  const privacy = (role) => (has(role, 'a_logs_all') ? 'all' : has(role, 'a_logs_team') ? 'team' : 'none');
  const setPrivacy = (role, v) => setRoles((x) => { x.rights[role] = (x.rights[role] || []).filter((r) => !r.startsWith('a_logs_')).concat(v === 'all' ? ['a_logs_all'] : v === 'team' ? ['a_logs_team'] : []); });
  const [cap, setCap] = useState(null);
  useEffect(() => { call('capacity.get').then((d) => setCap(d)).catch(() => setCap(null)); }, []);
  const noLead = cap ? Object.entries(cap.capacity?.teams || {}).filter(([, t]) => !(t.responsible || []).length).map(([id, t]) => t.name || id) : [];
  const label = (r) => tr(...ROLE_LABEL[r]);
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <div className="label">{tr('Rollen', 'Roles')}</div>
        <div className="muted" style={{ fontSize: 12.5, margin: '2px 0 10px' }}>{tr('Mitarbeiter sind alle Jira-Nutzer, Jira-Admin ergibt sich aus der Jira-Berechtigung. Wer in mehreren Gruppen ist, bekommt die Rechte aller seiner Rollen.', 'Employees are all Jira users; Jira admin follows from the Jira permission. Anyone in several groups gets the rights of all their roles.')}</div>
        {['projectAdmin', 'management'].map((r) => (
          <div key={r} className="perm-row">
            <span className="perm-ico"><Icon name={r === 'management' ? 'ranking' : 'users'} /></span>
            <div><b style={{ fontWeight: 560 }}>{label(r)}</b><div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{r === 'management' ? tr('z. B. portfolio-management', 'e.g. portfolio-management') : tr('z. B. projekt-admins. Die Rechte kommen nur aus dieser Gruppe – Teamleitungen bekommen sie nicht automatisch.', 'e.g. projekt-admins. The rights come only from this group – team leads do not get them automatically.')}</div></div>
            <GroupPicker value={roles.groups?.[r] || []} onChange={(v) => setRoles((x) => { x.groups[r] = v; })} />
          </div>
        ))}
      </div>

      <div className="callout" data-lead-hint><Icon name="info" /><div>{tr('Teamleitung („Verantwortlich“ je Team unter Teams › Kapazitäten pflegen) vergibt keine Rechte. Sie legt nur fest, wessen Einzelwerte jemand mit „Eigene Teams“ sieht und wer Eskalationen der Buchungskontrolle bekommt. Wer Projekt-Admin-Rechte braucht, gehört in die Gruppe oben.', 'Team lead ("Responsible" per team under Teams › Maintain capacities) grants no rights. It only decides whose individual values someone with "Own teams" sees and who gets booking-check escalations. Anyone who needs project-admin rights belongs in the group above.')}</div></div>

      <div>
        <div className="label">{tr('Rollen und Rechte', 'Roles and permissions')}</div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Rechte-Matrix, mit Pfeiltasten scrollbar', 'Permission matrix, scrollable with arrow keys')}>
          <table className="table matrix">
            <thead><tr><th>{tr('Recht', 'Right')}</th>{MATRIX_ROLES.map((r) => <th key={r} className="c">{label(r)}</th>)}<th className="c">{tr('Jira-Admin', 'Jira admin')}</th></tr></thead>
            <tbody>
              {rightRows().map(([group, list]) => [
                <tr key={group} className="matrix-group"><td colSpan={MATRIX_ROLES.length + 2}>{group}</td></tr>,
                ...list.map((r) => (
                  <tr key={r}>
                    <td><b style={{ fontWeight: 520 }}>{tr(...RIGHT_LABEL[r])}</b>{RIGHT_HINT[r] && <div className="faint" style={{ fontSize: 11.5 }}>{tr(...RIGHT_HINT[r])}</div>}</td>
                    {MATRIX_ROLES.map((role) => (
                      <td key={role} className="c">
                        <input type="checkbox" className="pick" checked={r === 'mine' || has(role, r)} disabled={r === 'mine'} onChange={() => toggle(role, r)} aria-label={`${label(role)}: ${tr(...RIGHT_LABEL[r])}`} />
                      </td>
                    ))}
                    <td className="c"><Icon name="check" size={14} /></td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="label">{tr('Datenschutz: Einzelwerte von Personen', 'Privacy: individual values of people')}</div>
        <div className="muted" style={{ fontSize: 12.5, margin: '2px 0 10px' }}>{tr('Buchungen, Plan vs. Ist und Auslastung je Person. Ohne Recht erscheinen andere Teams nur als Summe; Hinweise und Eskalationen an die Personen gehen trotzdem raus.', 'Bookings, plan vs. actual and utilisation per person. Without the right, other teams appear only as a sum; notices and escalations to the people still go out.')}</div>
        {cfg.rules?.personLevel === false && <div className="callout" style={{ marginBottom: 10 }}><Icon name="lock" />{tr('„Werte auf Personenebene anzeigen“ ist unter Planungsregeln aus – dann sieht niemand Einzelwerte.', '"Show person-level values" is off under planning rules – then nobody sees individual values.')}</div>}
        {['projectAdmin', 'management'].map((r) => (
          <div key={r} className="perm-row">
            <span className="perm-ico"><Icon name="eye" /></span>
            <b style={{ fontWeight: 560, alignSelf: 'center' }}>{label(r)}</b>
            <Segmented size="sm" value={privacy(r)} onChange={(v) => setPrivacy(r, v)} label={label(r)} options={[
              { value: 'none', label: tr('Keine', 'None') }, { value: 'team', label: tr('Eigene Teams', 'Own teams') }, { value: 'all', label: tr('Alle Teams', 'All teams') }]} />
          </div>
        ))}
        <div className="perm-row">
          <span className="perm-ico"><Icon name="shield" /></span>
          <b style={{ fontWeight: 560, alignSelf: 'center' }}>{tr('Jira-Admin', 'Jira admin')}</b>
          <Switch on={!!roles.adminPersonValues} onChange={(v) => setRoles((x) => { x.adminPersonValues = v; })} label={tr('sieht Einzelwerte aller Teams', 'sees individual values of all teams')} />
        </div>
        {noLead.length > 0 && <div className="callout warn" style={{ marginTop: 10 }}><Icon name="alert" /><div>{tr(`Ohne Verantwortliche: ${noLead.join(', ')}. „Eigene Teams“ zeigt für diese Teams niemandem Einzelwerte – in Teams › Kapazitäten pflegen eintragen.`, `No responsible people: ${noLead.join(', ')}. "Own teams" shows nobody individual values for these teams – add them in Teams › Maintain capacities.`)}</div></div>}
      </div>

      <div className="faint" style={{ fontSize: 12 }}>{tr('Alle Rechte werden bei jedem Aufruf serverseitig geprüft. Jede Änderung wird protokolliert.', 'All permissions are checked on the server on every call. Every change is logged.')}</div>
    </div>
  );
}
function GroupPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const t = setTimeout(() => call('meta.groups', { query: q }).then(setRes).catch(() => setRes([])), 200); return () => clearTimeout(t); }, [q, open]);
  return (
    <div style={{ position: 'relative' }}>
      <div className="row wrap" style={{ gap: 5, marginBottom: 6 }}>
        <AnimatePresence>{value.map((g) => (
          <motion.span key={g.id} className="chip chip-accent" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }} transition={spring}>
            <Icon name="users" size={12} />{g.name}<button style={{ border: 0, background: 'none', padding: 0, color: 'inherit', display: 'grid' }} onClick={() => onChange(value.filter((x) => x.id !== g.id))} aria-label={tr('Entfernen', 'Remove')}><Icon name="x" size={12} /></button>
          </motion.span>
        ))}</AnimatePresence>
        {value.length === 0 && <span className="faint" style={{ fontSize: 12.5 }}>{tr('Keine Gruppe – niemand', 'No group – nobody')}</span>}
      </div>
      <input className="input input-sm" style={{ width: '100%' }} value={q} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)} placeholder={tr('Gruppe suchen …', 'Search group …')} aria-label={tr('Gruppe suchen', 'Search group')} />
      <AnimatePresence>{open && res.length > 0 && (
        <motion.div className="popover" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 240, overflow: 'auto' }} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          {res.filter((g) => !value.some((v) => v.id === g.id)).map((g) => <button key={g.id} className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange([...value, g]); setQ(''); }}><Icon name="users" size={14} />{g.name}</button>)}
        </motion.div>
      )}</AnimatePresence>
    </div>
  );
}

function Rules({ cfg, upd, delegate }) {
  const r = cfg.rules;
  const set = (k, v) => upd((c) => { c.rules[k] = v; });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 28 }}>
      <div className="stack" style={{ gap: 16 }}>
        <div><Switch on={r.dueDateWarning} onChange={(v) => set('dueDateWarning', v)} label={tr('Warnung bei überschrittenem Due Date', 'Warning on exceeded due date')} />
          <div className="faint rule-where" data-rule-where="due">{tr('Wirkt in: Projekte (Fehlende Werte, Kachel Datenqualität), Erinnerungen an fehlende Werte, Lotse „Lücken füllen“ und C-Level-Report. Überfällige Stories im „Handlungsbedarf“ bleiben immer sichtbar.', 'Applies to: Projects (missing values, data quality tile), reminders about missing values, Lotse "Fill the gaps" and the C-level report. Overdue stories in "Action needed" always stay visible.')}</div></div>
        {!delegate && <div><Switch on={r.personLevel} onChange={(v) => set('personLevel', v)} label={tr('Werte auf Personenebene anzeigen', 'Show person-level values')} />
          <div className="faint rule-where" data-rule-where="person">{tr('Wirkt in: Teams, Wochenplanung, Plan vs. Ist, Projekte (Kapazität je Person), Support (Zuweisen an Personen), Buchungskontrolle und C-Level-Report. Aus = dort nur Summen ohne Namen. „Meine Arbeit“ zeigt jedem weiter die eigenen Werte; wer welche Einzelwerte sieht, regelt Rollen und Rechte › Datenschutz.', 'Applies to: Teams, weekly planning, plan vs. actual, Projects (capacity per person), Support (assigning to people), booking check and the C-level report. Off = only totals without names there. "My work" still shows everyone their own values; who sees which individual values is set under Roles and permissions › Privacy.')}</div></div>}
        {!delegate && <Switch on={r.lockSubtasks} onChange={(v) => set('lockSubtasks', v)} label={tr('Zeiterfassung & Schätzung auf Sub-tasks sperren', 'Lock time tracking & estimates on sub-tasks')} />}
        <div><div className="label">{tr('Verteilung der Schätzung im Zeitraum', 'Distribution of estimates in a period')}</div>
          <Segmented value={r.distribution} onChange={(v) => set('distribution', v)} options={[{ value: 'linear', label: tr('Linear (Arbeitstage)', 'Linear (working days)') }, { value: 'start', label: tr('Am Start', 'At start') }, { value: 'due', label: tr('Am Due Date', 'At due date') }, { value: 'capacity', label: tr('Nach freier Kapazität', 'By free capacity') }]} />
        </div>
        <div className="row wrap" style={{ gap: 16 }}>
          <NumField label={tr('Health-Rhythmus (Tage)', 'Health rhythm (days)')} value={r.healthRhythmDays} min={1} max={90} onChange={(v) => set('healthRhythmDays', v)} />
          <NumField label={tr('Warnschwelle Prognose %', 'Forecast warning %')} value={r.forecastThresholdPct} min={0} max={100} onChange={(v) => set('forecastThresholdPct', v)} />
          <NumField label={tr('Abweichung hervorheben ab %', 'Highlight deviation from %')} value={r.deviationThresholdPct} min={1} max={100} onChange={(v) => set('deviationThresholdPct', v)} />
        </div>
      </div>
    </div>
  );
}
function NumField({ label, value, onChange, min, max }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="label" style={{ margin: 0 }}>{label}</span><input className="input input-sm num" type="number" min={min} max={max} style={{ width: 120 }} value={value} onChange={(e) => onChange(+e.target.value)} /></label>;
}

function Milestones({ ms, setMs, status }) {
  const [q, setQ] = useState({});
  const [found, setFound] = useState({});
  const [vers, setVers] = useState({});
  const search = async (id, query) => { setQ((x) => ({ ...x, [id]: query })); const r = await call('meta.versions', { query }).catch(() => []); setFound((x) => ({ ...x, [id]: r })); setVers((v) => ({ ...v, ...Object.fromEntries(r.map((y) => [y.id, y])) })); };
  const st = (id) => status?.find((m) => m.id === id);
  const taken = new Set(ms.flatMap((m) => m.fixVersionIds));
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="muted" style={{ fontSize: 13 }}>{tr('Ein Meilenstein bündelt Fix Versions aus beliebigen Spaces; jede Fix Version gehört zu höchstens einem Meilenstein. Stories gehören über ihre Fix Version automatisch dazu.', 'A milestone bundles fix versions from any spaces; each fix version belongs to at most one milestone. Stories belong to it automatically via their fix version.')}</div>
      <AnimatePresence initial={false}>
        {ms.map((m, i) => {
          const s = st(m.id);
          return (
            <motion.div key={m.id} layout className="card" style={{ padding: 14, boxShadow: 'none' }} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
              <div className="row wrap" style={{ gap: 10 }}>
                <Icon name="milestone" style={{ color: 'var(--accent)' }} />
                <input className="input input-sm" style={{ width: 240, fontWeight: 560 }} value={m.name} onChange={(e) => setMs((l) => l.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} aria-label={tr('Name', 'Name')} />
                <input type="date" className="input input-sm" value={m.date} onChange={(e) => setMs((l) => l.map((x, k) => (k === i ? { ...x, date: e.target.value } : x)))} aria-label={tr('Datum', 'Date')} />
                {s && <span className={`chip ${s.atRisk ? 'chip-warn' : 'chip-ok'}`}>{s.atRisk ? tr('Gefährdet', 'At risk') : tr('Im Plan', 'On track')}</span>}
                {s && <span className="muted" style={{ fontSize: 12.5 }}>{s.stories.length} Stories · {s.spaces.join(', ') || '–'}</span>}
                <span className="grow" />
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setMs((l) => l.filter((_, k) => k !== i))} aria-label={tr('Löschen', 'Delete')}><Icon name="trash" size={14} /></button>
              </div>
              <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                {m.fixVersionIds.map((v) => {
                  const info = vers[v] || s?.versions?.find((x) => String(x.id) === String(v));
                  const late = info && (!info.releaseDate || info.releaseDate > m.date);
                  return <span key={v} className={`chip ${late ? 'chip-warn' : ''}`} title={late ? tr('Endet nach dem Meilenstein oder ohne Datum', 'Ends after the milestone or has no date') : undefined}>{info?.name || `#${v}`}{info?.projectKey && <span className="faint">{info.projectKey}</span>}{info && <span className="faint">{info.releaseDate ? fmt.date(info.releaseDate) : tr('ohne Datum', 'no date')}</span>}
                    <button style={{ border: 0, background: 'none', padding: 0, display: 'grid', color: 'inherit' }} onClick={() => setMs((l) => l.map((x, k) => (k === i ? { ...x, fixVersionIds: x.fixVersionIds.filter((y) => y !== v) } : x)))} aria-label={tr('Entfernen', 'Remove')}><Icon name="x" size={12} /></button></span>;
                })}
                <div style={{ position: 'relative' }}>
                  <input className="input input-sm" style={{ width: 220 }} value={q[m.id] || ''} onChange={(e) => search(m.id, e.target.value)} onFocus={() => search(m.id, q[m.id] || '')} placeholder={tr('Fix Version suchen …', 'Search fix version …')} aria-label={tr('Fix Version suchen', 'Search fix version')} />
                  {found[m.id]?.length > 0 && (
                    <div className="popover" style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, width: 320, maxHeight: 240, overflow: 'auto' }}>
                      {found[m.id].filter((v) => !taken.has(v.id)).map((v) => <button key={v.id} className="menu-item" onClick={() => { setMs((l) => l.map((x, k) => (k === i ? { ...x, fixVersionIds: [...x.fixVersionIds, v.id] } : x))); setFound((f) => ({ ...f, [m.id]: [] })); setQ((x) => ({ ...x, [m.id]: '' })); }}>
                        <Icon name="flag" size={13} /><span className="grow">{v.name}</span><span className="mono faint">{v.projectKey}</span><span className="faint">{v.releaseDate ? fmt.date(v.releaseDate) : '–'}</span></button>)}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMs((l) => [...l, { id: Math.random().toString(36).slice(2, 10), name: tr('Neuer Meilenstein', 'New milestone'), date: new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10), fixVersionIds: [] }])}><Icon name="plus" />{tr('Meilenstein anlegen', 'Create milestone')}</button>
    </div>
  );
}

const DEFAULT_SLA_CFG = { mode: 'business', start: 8, end: 17, location: 'DE', atRiskShare: 0.75, fallbackHours: 72, policies: [{ priority: 'Highest', hours: 8 }, { priority: 'High', hours: 24 }, { priority: 'Medium', hours: 72 }, { priority: 'Low', hours: 120 }, { priority: 'Lowest', hours: 200 }] };
// Support & SLAs: where support work comes from (JSM service spaces and/or queues in any space),
// how the SLA clock runs and what the targets per priority are. Delegates see the SLA part only.
function SupportCfg({ cfg, upd, meta, delegate }) {
  const [list, setList] = useState(null);
  useEffect(() => { if (!delegate) call('meta.projects', { service: true }).then(setList).catch(() => setList([])); else setList([]); }, [delegate]);
  const s = { serviceProjectIds: [], queues: [], averagingWeeks: 4, slaTargetPct: 95, escalationLinkTypeId: '', ...cfg.support, sla: { ...DEFAULT_SLA_CFG, ...(cfg.support?.sla || {}) } };
  const set = (fn) => upd((c) => { c.support = { ...s, ...(c.support || {}), sla: { ...s.sla, ...(c.support?.sla || {}) } }; fn(c.support); });
  // the plain spaces (Software / Business) chosen as support – one built-in queue "spaces" with all their work items
  const spacesQ = s.queues.find((q) => q.id === 'spaces') || null;
  const otherQueues = s.queues.filter((q) => q.id !== 'spaces');
  const setSpaces = (ids) => set((x) => { const rest = s.queues.filter((q) => q.id !== 'spaces'); x.queues = ids.length ? [{ id: 'spaces', name: tr('Support-Spaces', 'Support spaces'), projectIds: ids, issueTypeIds: [], labels: [] }, ...rest] : rest; });
  return (
    <div className="stack" style={{ gap: 22 }}>
      {!delegate && (
        <>
          <div className="callout"><Icon name="headset" /><div>{tr('Support-Arbeit kommt aus drei Quellen: Service-Spaces (Jira Service Management), ganzen Software- und Business-Spaces und Queues – einem Teil eines Spaces, z. B. nur Bugs mit dem Label „support“. Alle Tickets zählen als Support-Arbeit (Reserve, Verteilen, Zeit); gelesen wird immer mit den Rechten der jeweiligen Person.', 'Support work comes from three sources: service spaces (Jira Service Management), whole software and business spaces, and queues – part of a space, e.g. only bugs labelled "support". All tickets count as support work (reserve, dispatch, time); they are always read with the permissions of the person looking.')}</div></div>
          <div><div className="label">{tr('Service-Spaces (Jira Service Management)', 'Service spaces (Jira Service Management)')}</div>
            {list == null ? <Skeleton h={30} w={260} /> : list.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>{tr('Auf dieser Site gibt es keine Service-Spaces. Kein Problem: lege unten eine Queue an.', 'There are no service spaces on this site. No problem: define a queue below.')}</div> : (
              <div className="row wrap" style={{ gap: 6 }}>{list.map((p) => { const on = s.serviceProjectIds.includes(p.id); return <button key={p.id} className={`chip ${on ? 'chip-accent' : 'chip-outline'}`} style={{ height: 30, padding: '0 12px' }} aria-pressed={on} onClick={() => set((x) => { x.serviceProjectIds = on ? s.serviceProjectIds.filter((y) => y !== p.id) : [...s.serviceProjectIds, p.id]; })}>{on && <Icon name="check" size={12} />}{p.name}<span className="mono faint">{p.key}</span></button>; })}</div>
            )}
          </div>
          <SupportSpaces ids={spacesQ?.projectIds || []} jsm={list || []} onChange={setSpaces} />
          <div>
            <div className="label">{tr('Support-Queues (nur ein Teil eines Spaces)', 'Support queues (only part of a space)')}</div>
            <div className="faint" style={{ fontSize: 12.5, marginBottom: 8 }}>{tr('Für einzelne Arbeitstypen oder Labels, z. B. nur Bugs mit dem Label „support“.', 'For single work types or labels, e.g. only bugs labelled "support".')}</div>
            <div className="stack" style={{ gap: 10 }}>
              {otherQueues.map((q) => <QueueEditor key={q.id} q={q} meta={meta} onChange={(fn) => set((x) => { x.queues = s.queues.map((y) => { if (y.id !== q.id) return y; const n = structuredClone(y); fn(n); return n; }); })} onRemove={() => set((x) => { x.queues = s.queues.filter((y) => y.id !== q.id); })} />)}
              {s.queues.length < 12 && <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set((x) => { x.queues = [...s.queues, { id: `q${Date.now().toString(36).slice(-6)}`, name: tr('Neue Queue', 'New queue'), projectIds: [], issueTypeIds: [], labels: [] }]; })}><Icon name="plus" />{tr('Queue anlegen', 'Add queue')}</button>}
            </div>
          </div>
        </>
      )}
      <div className="callout" data-sla-jsm><Icon name="shield" /><div><b style={{ fontWeight: 560 }}>{tr('SLAs kommen aus Jira Service Management', 'SLAs come from Jira Service Management')}</b> – {tr('jeder Service-Space hat seine eigenen Kalender und Ziele, das Cockpit liest sie von den Tickets. Software- und Business-Spaces und Queues haben kein SLA: ihre Tickets zählen als Support-Arbeit, aber in keiner SLA-Zahl. Hier ist dafür nichts einzustellen.', 'every service space has its own calendars and goals, and the cockpit reads them from the tickets. Software and business spaces and queues have no SLA: their tickets count as support work but in no SLA figure. Nothing to set here.')}</div></div>
      {!delegate && <div className="callout"><Icon name="info" /><div>{tr('Optional: Der Workflow-Validator „Original Estimate required (Portfolio Cockpit)" erzwingt eine Schätzung, bevor ein Ticket auf „In Arbeit" geht. Füge ihn im Workflow-Editor an der Transition hinzu.', 'Optional: the workflow validator "Original Estimate required (Portfolio Cockpit)" enforces an estimate before a ticket moves to "In Progress". Add it to the transition in the workflow editor.')}</div></div>}
      {!delegate && <SupportDispatchSettings value={cfg.support} onChange={(next) => upd((c) => { c.support = { ...(c.support || {}), dispatch: next.dispatch, timeGroupBy: next.timeGroupBy, causeFieldId: next.causeFieldId }; })}
        statuses={(meta?.statuses || []).flatMap((x) => x.ids.map((id) => ({ id, name: x.name, category: x.category })))} fields={(meta?.fields || []).filter((x) => x.type === 'option')} />}
    </div>
  );
}

// Software / Business spaces as support sources (boss 2026-11-18: "add normal projects"): every work item of the chosen
// spaces counts as a support ticket – read with the person's rights; service spaces stay in the list above.
function SupportSpaces({ ids, jsm, onChange }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [known, setKnown] = useState([]);
  const [count, setCount] = useState(null);
  useEffect(() => { call('meta.projects', {}).then(setKnown).catch(() => setKnown([])); }, []);
  useEffect(() => {
    if (!query.trim()) { setFound([]); return undefined; }
    const t = setTimeout(() => call('meta.projects', { query }).then(setFound).catch(() => setFound([])), 250);
    return () => clearTimeout(t);
  }, [query]);
  const key = ids.join(',');
  useEffect(() => {
    if (!ids.length) { setCount(null); return undefined; }
    setCount('…');
    const t = setTimeout(() => call('support.preview', { queue: { id: 'spaces', name: 'spaces', projectIds: ids, issueTypeIds: [], labels: [] } }).then(setCount).catch(() => setCount(null)), 600);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const jsmIds = new Set(jsm.map((p) => p.id));
  const byId = new Map([...known, ...found].map((p) => [p.id, p]));
  return (
    <div data-support-spaces>
      <div className="row wrap" style={{ justifyContent: 'space-between', gap: 8 }}>
        <div className="label" style={{ margin: 0 }}>{tr('Software- und Business-Spaces als Support', 'Software and business spaces as support')}</div>
        <span aria-live="polite">{count && typeof count === 'object' ? <span className="chip chip-accent num">{tr(`${fmt.n(count.total)} Tickets · ${fmt.n(count.open)} offen`, `${fmt.n(count.total)} tickets · ${fmt.n(count.open)} open`)}</span> : count === '…' ? <span className="faint">{tr('zähle …', 'counting …')}</span> : null}</span>
      </div>
      <div className="faint" style={{ fontSize: 12.5, margin: '2px 0 8px' }}>{tr('Alle Vorgänge dieser Spaces zählen als Support – z. B. ein Software-Space, in dem das Team Störungen bearbeitet.', 'All work items of these spaces count as support – e.g. a software space where the team handles incidents.')}</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {ids.map((id) => { const p = byId.get(id); return <button key={id} type="button" className="chip chip-accent" onClick={() => onChange(ids.filter((x) => x !== id))} aria-label={tr(`${p?.name || id} entfernen`, `Remove ${p?.name || id}`)}>{p ? p.name : id}{p && <span className="mono faint">{p.key}</span>}<Icon name="x" size={11} /></button>; })}
        <span style={{ position: 'relative' }}>
          <input className="input input-sm" style={{ width: 220 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Space hinzufügen …', 'Add space …')} aria-label={tr('Software-Space suchen', 'Search software space')} />
          {found.length > 0 && <div className="pop-list">{found.filter((p) => !ids.includes(p.id) && !jsmIds.has(p.id)).slice(0, 8).map((p) => <button key={p.id} type="button" className="pick-row" onClick={() => { onChange([...ids, p.id].slice(0, 20)); setQuery(''); }}><span className="mono faint">{p.key}</span><span style={{ flex: 1, textAlign: 'left' }}>{p.name}</span></button>)}</div>}
        </span>
        {!ids.length && <span className="faint" style={{ fontSize: 12.5 }}>{tr('noch keiner', 'none yet')}</span>}
      </div>
    </div>
  );
}

const LABEL_OK = /^[\p{L}\p{N}_.:-]{1,64}$/u;
// One queue: spaces + optional work types + optional labels, with a live ticket count while you build it.
function QueueEditor({ q, meta, onChange, onRemove }) {
  const [spaces, setSpaces] = useState([]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [count, setCount] = useState(null);
  const [labelText, setLabelText] = useState(q.labels.join(', '));
  useEffect(() => { call('meta.projects', {}).then(setSpaces).catch(() => setSpaces([])); }, []);
  useEffect(() => {
    if (!query.trim()) { setFound([]); return undefined; }
    const t = setTimeout(() => call('meta.projects', { query }).then(setFound).catch(() => setFound([])), 250);
    return () => clearTimeout(t);
  }, [query]);
  const key = JSON.stringify([q.projectIds, q.issueTypeIds, q.labels]);
  useEffect(() => {
    if (!q.projectIds.length) { setCount(null); return undefined; }
    setCount('…');
    const t = setTimeout(() => call('support.preview', { queue: q }).then(setCount).catch(() => setCount(null)), 600);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const known = new Map([...spaces, ...found].map((p) => [p.id, p]));
  const badLabels = labelText.split(',').map((x) => x.trim()).filter((x) => x && !LABEL_OK.test(x));
  return (
    <div className="queue-card">
      <div className="row" style={{ gap: 10, justifyContent: 'space-between' }}>
        <input className="input input-sm" style={{ fontWeight: 560, maxWidth: 280 }} value={q.name} maxLength={60} aria-label={tr('Name der Queue', 'Queue name')} onChange={(e) => onChange((n) => { n.name = e.target.value; })} />
        <span className="row" style={{ gap: 10 }}>
          <span aria-live="polite">{count && typeof count === 'object' ? <span className="chip chip-accent num">{tr(`${fmt.n(count.total)} Tickets · ${fmt.n(count.open)} offen`, `${fmt.n(count.total)} tickets · ${fmt.n(count.open)} open`)}</span> : count === '…' ? <span className="faint">{tr('zähle …', 'counting …')}</span> : null}</span>
          <button className="btn btn-ghost btn-icon btn-sm" aria-label={tr('Queue entfernen', 'Remove queue')} onClick={onRemove}><Icon name="trash" size={14} /></button>
        </span>
      </div>
      <div className="queue-grid">
        <div className="label" style={{ margin: 0 }}>{tr('Spaces', 'Spaces')}</div>
        <div className="row wrap" style={{ gap: 6 }}>
          {q.projectIds.map((id) => { const p = known.get(id); return <button key={id} className="chip chip-accent" onClick={() => onChange((n) => { n.projectIds = n.projectIds.filter((x) => x !== id); })} aria-label={tr(`${p?.name || id} entfernen`, `Remove ${p?.name || id}`)}>{p ? p.name : id}{p && <span className="mono faint">{p.key}</span>}<Icon name="x" size={11} /></button>; })}
          <span style={{ position: 'relative' }}>
            <input className="input input-sm" style={{ width: 200 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Space hinzufügen …', 'Add space …')} aria-label={tr('Space suchen', 'Search space')} />
            {found.length > 0 && <div className="pop-list">{found.filter((p) => !q.projectIds.includes(p.id)).slice(0, 8).map((p) => <button key={p.id} className="pick-row" onClick={() => { onChange((n) => { n.projectIds = [...n.projectIds, p.id].slice(0, 20); }); setQuery(''); }}><span className="mono faint">{p.key}</span><span style={{ flex: 1, textAlign: 'left' }}>{p.name}</span></button>)}</div>}
          </span>
        </div>
        <div className="label" style={{ margin: 0 }}>{tr('Arbeitstypen', 'Work types')}</div>
        <div className="row wrap" style={{ gap: 6 }}>
          {(() => {
            const all = (meta?.issueTypes || []).filter((t) => t.level <= 0).slice(0, 14).map((t) => t.id);
            const every = all.length > 0 && all.every((id) => q.issueTypeIds.includes(id));
            return <button className={`chip ${every ? 'chip-accent' : 'chip-outline'}`} aria-pressed={every} onClick={() => onChange((n) => { n.issueTypeIds = every ? [] : all; })} title={every ? tr('Auswahl aufheben', 'Clear selection') : tr('Alle Arbeitstypen auswählen', 'Select all work types')}>{every && <Icon name="check" size={11} />}{tr('Alle', 'All')}</button>;
          })()}
          {(meta?.issueTypes || []).filter((t) => t.level <= 0).slice(0, 14).map((t) => { const on = q.issueTypeIds.includes(t.id); return <button key={t.id} className={`chip ${on ? 'chip-accent' : 'chip-outline'}`} aria-pressed={on} onClick={() => onChange((n) => { n.issueTypeIds = on ? n.issueTypeIds.filter((x) => x !== t.id) : [...n.issueTypeIds, t.id]; })}>{on && <Icon name="check" size={11} />}{t.name}</button>; })}
          {!q.issueTypeIds.length && <span className="faint" style={{ fontSize: 12.5 }}>{tr('nichts gewählt = alle Arbeitstypen', 'none selected = all work types')}</span>}
        </div>
        <div className="label" style={{ margin: 0 }}>Labels</div>
        <div>
          <input className="input input-sm" style={{ width: 280 }} value={labelText} placeholder={tr('z. B. support, incident', 'e.g. support, incident')} aria-label="Labels" aria-invalid={badLabels.length > 0}
            onChange={(e) => { setLabelText(e.target.value); const ls = e.target.value.split(',').map((x) => x.trim()).filter((x) => LABEL_OK.test(x)).slice(0, 10); onChange((n) => { n.labels = ls; }); }} />
          {badLabels.length > 0 && <div style={{ color: 'var(--bad)', fontSize: 12, marginTop: 4 }}>{tr('Labels ohne Leerzeichen und Sonderzeichen:', 'Labels without spaces or special characters:')} {badLabels.join(', ')}</div>}
        </div>
      </div>
      {!q.projectIds.length && <div className="faint" style={{ fontSize: 12.5 }}>{tr('Wähle mindestens einen Space – ohne Space wird die Queue nicht gespeichert.', 'Choose at least one space – a queue without a space is not saved.')}</div>}
    </div>
  );
}

function CapDefaults({ cfg, upd, meta }) {
  return (
    <div className="row wrap" style={{ gap: 20 }}>
      <NumField label={tr('Standard-Wochenstunden', 'Default weekly hours')} value={cfg.capacityDefaults.defaultWeeklyHours} min={0} max={80} onChange={(v) => upd((c) => { c.capacityDefaults.defaultWeeklyHours = v; })} />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span className="label" style={{ margin: 0 }}>{tr('Standard-Standort (Feiertage)', 'Default location (public holidays)')}</span>
        <select className="select select-sm" value={cfg.capacityDefaults.defaultLocation} onChange={(e) => upd((c) => { c.capacityDefaults.defaultLocation = e.target.value; })}>{calendarChoices(cfg.capacityDefaults.defaultLocation).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      </label>
      <div className="muted" style={{ fontSize: 12.5, maxWidth: 420 }}>{tr('Gilt für Personen, deren Kapazität noch nicht gepflegt ist. Die Pflege selbst erfolgt im Cockpit unter Kapazität › Bearbeiten.', 'Applies to people whose capacity is not maintained yet. Maintenance happens in the cockpit under Capacity › Edit.')}</div>
    </div>
  );
}

function Audit() {
  const { ds } = useApp();
  const [list, setList] = useState(null);
  useEffect(() => { call('audit.list').then(setList).catch(() => setList([])); }, []);
  if (!list) return <Skeleton h={120} />;
  if (!list.length) return <div className="muted">{tr('Noch keine Änderungen protokolliert.', 'No changes logged yet.')}</div>;
  const label = (e) => ({
    'rank.change': tr('Rang geändert', 'Rank changed'), 'portfolio.add': tr('Projekt aufgenommen', 'Project added'), 'portfolio.remove': tr('Projekt entfernt', 'Project removed'),
    'portfolio.autoRemove': tr('Automatisch entfernt', 'Removed automatically'), 'health.update': 'Health-Update', 'health.undo': tr('Health-Update rückgängig', 'Health update undone'),
    'config.update': tr('Konfiguration geändert', 'Configuration changed'), 'capacity.update': tr('Kapazitäten geändert', 'Capacities changed'), 'milestones.update': tr('Meilensteine geändert', 'Milestones changed'),
    'issue.fill': tr('Lücke ergänzt', 'Gap filled'), 'issue.fill.undo': tr('Lücke ergänzt – rückgängig', 'Gap fill undone'),
    'issue.parent': tr('Parent gesetzt', 'Parent set'), 'issue.parent.undo': tr('Parent gesetzt – rückgängig', 'Parent set undone'),
    'plan.update': tr('Grobplanung geändert', 'Rough plan changed'), 'plan.update.undo': tr('Grobplanung – rückgängig', 'Rough plan change undone'),
    'plan.apply': tr('Planung in Jira übernommen', 'Plan written to Jira'), 'plan.apply.undo': tr('Planung rückgängig gemacht', 'Plan change undone'),
    'support.dispatch': tr('Support verteilt', 'Support assigned'), 'support.dispatch.undo': tr('Support-Verteilung rückgängig', 'Support assignment undone'), 'support.reserve': tr('Support-Reserve geändert', 'Support reserve changed'),
    'report.publish': tr('Report veröffentlicht', 'Report published'), 'ai.enabled': tr('KI eingeschaltet', 'AI switched on'), 'ai.disabled': tr('KI ausgeschaltet', 'AI switched off'),
    'ai.settings': tr('KI-Einstellungen geändert', 'AI settings changed'), 'ai.assist': tr('KI-Vorschlag angefordert', 'AI suggestion requested'),
  }[e.action] || e.action);
  const FIELD = { start: 'Start', due: 'Due', assignee: tr('Zuständig', 'Assignee'), team: 'Team' };
  const val = (v) => (v == null || v === '' ? '–' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));
  // what changed, from → to (people and teams by name where the cockpit knows them)
  const who = (f, v) => (v && f === 'assignee' ? ds?.people?.[v]?.name || v : v && f === 'team' ? (ds?.teams || []).find((t) => t.id === v)?.name || v : val(v));
  const detail = (e) => {
    const d = e.details || {};
    if (e.action === 'rank.change') return `${d.ref}: ${d.from} → ${d.to}`;
    if (e.action === 'config.update') return (d.sections || []).join(', ');
    if (e.action === 'health.update') return `${d.ref}: ${d.from || '–'} → ${d.to}`;
    if (/^plan\.apply/.test(e.action) && Array.isArray(d.changes)) {
      const parts = d.changes.map((c) => `${c.key}: ${Object.entries(c).filter(([k]) => k !== 'key').map(([f, [a, b]]) => `${FIELD[f] || f} ${who(f, a)} → ${who(f, b)}`).join(', ')}`);
      return [...parts, ...(d.failed ? [tr(`${d.failed} nicht übernommen`, `${d.failed} not applied`)] : [])].join(' · ');
    }
    if (/^(issue\.fill|plan\.update)/.test(e.action) && 'to' in d) return `${d.key || d.ref}: ${usageName(d.usage)} ${val(d.from)} → ${val(d.to)}`;
    return Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
  };
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Tabelle, mit Pfeiltasten scrollbar', 'Table, scrollable with arrow keys')} style={{ maxHeight: 420 }}>
      <table className="table"><thead><tr><th>{tr('Zeitpunkt', 'Time')}</th><th>{tr('Person', 'Person')}</th><th>{tr('Aktion', 'Action')}</th><th>Details</th></tr></thead>
        <tbody>{list.map((e, i) => <tr key={i}><td className="num" style={{ whiteSpace: 'nowrap' }}>{fmt.dateTimeSec(e.at)}</td><td>{e.byName || e.by}</td><td><b style={{ fontWeight: 540 }}>{label(e)}</b></td><td className="muted mono" style={{ fontSize: 12 }}>{detail(e)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

// ---------- T-shirt sizes & target quarters ----------
// With an app field, sizes are edited here. With a Jira select field, the options come from Jira (your
// admins manage them there freely) and only the hours per option are set here; differences are flagged.
const SK = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const SIZE_OK = /^[\p{L}\p{N}+ .,()/-]{1,40}$/u;
const sameSize = (key, value) => SK(key) === SK(value) || SK(value).split(/[\s(]/)[0] === SK(key);

function useOptions(fieldId) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const load = () => {
    if (!/^customfield_/.test(fieldId || '')) { setState({ loading: false, data: null, error: null }); return; }
    setState((s) => ({ ...s, loading: true, error: null }));
    call('fields.options', { fieldId }).then((data) => setState({ loading: false, data, error: null })).catch((error) => setState({ loading: false, data: null, error }));
  };
  useEffect(load, [fieldId]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, load];
}

// Jira admin pages open in a new tab with the full site URL, so unsaved edits here stay.
async function openJira(path) {
  const c = await getContext().catch(() => ({}));
  openUrl(c?.siteUrl ? new URL(path, c.siteUrl).toString() : path);
}

function SourceChip({ field, meta }) {
  if (field === 'app') return <span className="chip chip-outline"><Icon name="layers" size={12} />{tr('App-Feld (von Portfolio Cockpit)', 'App field (by Portfolio Cockpit)')}</span>;
  if (/^customfield_/.test(field || '')) {
    const f = (meta?.fields || []).find((x) => x.id === field);
    return <span className="chip chip-info"><Icon name="grid" size={12} />{tr('Jira-Feld', 'Jira field')}: {f?.name || field.replace('customfield_', 'cf ')}</span>;
  }
  return <span className="chip chip-warn"><Icon name="alert" size={12} />{tr('Kein Feld zugeordnet', 'No field mapped')}</span>;
}

function Sizes({ cfg, upd, meta, delegate }) {
  const src = cfg.fields?.tshirt || '';
  const jira = /^customfield_/.test(src);
  const [{ loading, data, error }, reload] = useOptions(src);
  const max = Math.max(1, ...cfg.tshirtSizes.map((t) => +t.hours || 0));
  const setHours = (key, hours) => upd((c) => {
    const i = c.tshirtSizes.findIndex((t) => SK(t.key) === SK(key));
    if (i >= 0) c.tshirtSizes[i].hours = hours; else c.tshirtSizes.push({ key: SK(key), hours });
  });
  const remove = (key) => upd((c) => { c.tshirtSizes = c.tshirtSizes.filter((t) => SK(t.key) !== SK(key)); });
  const options = data?.options || [];
  const rows = jira && data
    ? [...options.map((o) => {
      const entry = cfg.tshirtSizes.find((t) => sameSize(t.key, o.value));
      return { key: entry?.key || SK(o.value), label: o.value, hours: entry?.hours, inJira: true, needsHours: !entry, invalid: !SIZE_OK.test(SK(o.value)) };
    }), ...cfg.tshirtSizes.filter((t) => !options.some((o) => sameSize(t.key, o.value))).map((t) => ({ key: t.key, label: t.key, hours: t.hours, inJira: false }))]
    : null;
  const missing = rows ? rows.filter((r) => r.needsHours).length : 0;
  const orphans = rows ? rows.filter((r) => !r.inJira).length : 0;
  const bar = (h) => <div className="grow" style={{ height: 6, borderRadius: 3, background: 'var(--sunken)', overflow: 'hidden', minWidth: 60 }}><motion.div animate={{ width: `${Math.min(100, ((+h || 0) / max) * 100)}%` }} style={{ height: '100%', background: 'var(--accent)', borderRadius: 3 }} /></div>;
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 10 }}>
          <div className="row wrap" style={{ gap: 8 }}><b style={{ fontWeight: 560 }}>{tr('T-Shirt-Größen', 'T-shirt sizes')}</b><SourceChip field={src} meta={meta} /></div>
          {jira && data?.manageUrl && (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={() => openJira(data.manageUrl)}><Icon name="external" size={13} />{tr('Optionen in Jira verwalten', 'Manage options in Jira')}</button>
              <button className="btn btn-ghost btn-sm" onClick={reload} disabled={loading}><Icon name="refresh" size={13} />{tr('Neu laden', 'Reload')}</button>
            </div>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          {jira ? tr('Die Größen kommen aus den Optionen des Jira-Felds. Neue Optionen erscheinen hier automatisch – trage nur die Stunden ein.', 'Sizes come from the options of the Jira field. New options appear here automatically – just enter the hours.')
            : src === 'app' ? tr('Die Größen werden hier gepflegt und gelten für alle Projekte. Lieber eigene Jira-Optionen? Unter „Felder" ein Auswahlfeld zuordnen.', 'Sizes are maintained here and apply to all projects. Prefer your own Jira options? Map a select field under "Fields".')
              : delegate ? tr('Ein Jira-Admin muss zuerst ein T-Shirt-Feld zuordnen.', 'A Jira admin needs to map a T-shirt field first.') : tr('Unter „Felder" das App-Feld oder ein eigenes Jira-Auswahlfeld zuordnen.', 'Map the app field or your own Jira select field under "Fields".')}
        </div>
        {jira && loading && <Skeleton h={120} />}
        {jira && error && <div className="callout bad"><Icon name="alert" /><div>{tr('Optionen konnten nicht gelesen werden', 'Could not read the options')}: {errText(error)}</div></div>}
        {jira && data && !options.length && <div className="callout"><Icon name="info" /><div>{tr('Keine Optionen gefunden. Ist das Feld auf den Bildschirmen der Projekt-Vorgänge? Optionen in Jira anlegen und „Neu laden".', 'No options found. Is the field on the screens of your project work items? Add options in Jira and click "Reload".')}</div></div>}
        {(missing > 0 || orphans > 0) && (
          <div className="row wrap" style={{ gap: 6 }}>
            {missing > 0 && <span className="chip chip-warn"><Icon name="alert" size={11} />{tr(`${missing} neue Option(en) ohne Stunden`, `${missing} new option(s) without hours`)}</span>}
            {orphans > 0 && <span className="chip chip-outline">{tr(`${orphans} Größe(n) nicht mehr in Jira`, `${orphans} size(s) no longer in Jira`)}</span>}
          </div>
        )}
        <div className="stack" style={{ gap: 6 }}>
          <AnimatePresence initial={false}>
            {(rows || cfg.tshirtSizes.map((t) => ({ key: t.key, label: t.key, hours: t.hours, editable: true }))).map((r, i) => (
              <motion.div key={`${r.label}-${i}`} className="row" layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} style={{ gap: 10 }}>
                {r.editable
                  ? <input className="input input-sm" style={{ width: 140, fontWeight: 600 }} value={r.key} maxLength={40} onChange={(e) => upd((c) => { c.tshirtSizes[i].key = e.target.value.toUpperCase(); })} aria-label={tr('Größe', 'Size')} />
                  : <b style={{ width: 140, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</b>}
                <input className="input input-sm num" type="number" min={0} style={{ width: 100, textAlign: 'right', ...(r.needsHours ? { borderColor: 'var(--warn)' } : {}) }} value={r.hours ?? ''} placeholder="–"
                  onChange={(e) => (r.editable ? upd((c) => { c.tshirtSizes[i].hours = +e.target.value; }) : setHours(r.key, +e.target.value))} aria-label={`${tr('Stunden', 'Hours')} ${r.label}`} disabled={r.inJira === false ? false : r.invalid} />
                <span className="muted">h</span>
                {bar(r.hours)}
                {r.needsHours && <span className="chip chip-warn" style={{ flex: 'none' }}>{tr('neu in Jira', 'new in Jira')}</span>}
                {r.invalid && <span className="chip chip-bad" style={{ flex: 'none' }} title={tr('Max. 40 Zeichen, keine Sonderzeichen', 'Max. 40 characters, no special characters')}>{tr('Wert nicht nutzbar', 'value not usable')}</span>}
                {r.inJira === false && <span className="chip chip-outline" style={{ flex: 'none' }}>{tr('nicht in Jira', 'not in Jira')}</span>}
                {(r.editable || r.inJira === false) && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => (r.editable ? upd((c) => { c.tshirtSizes.splice(i, 1); }) : remove(r.key))} aria-label={`${tr('Entfernen', 'Remove')} ${r.label}`}><Icon name="x" size={14} /></button>}
              </motion.div>
            ))}
          </AnimatePresence>
          {!jira && src === 'app' && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => upd((c) => { c.tshirtSizes.push({ key: 'NEU', hours: 0 }); })}><Icon name="plus" />{tr('Größe hinzufügen', 'Add size')}</button>}
        </div>
      </div>
      <Quarters cfg={cfg} meta={meta} upd={upd} delegate={delegate} />
    </div>
  );
}

function Quarters({ cfg, meta, upd, delegate }) {
  const src = cfg.fields?.targetQuarters || '';
  const range = validQuarterRange(cfg.quarterRange);
  const setRange = (patch) => upd((c) => { c.quarterRange = { ...validQuarterRange(c.quarterRange), ...patch }; });
  const rolling = rollingQuarters(range);
  const cur = rolling[range.back];
  const offSet = new Set(range.off);
  const shown = [...new Set([...rolling, ...range.extra])].sort();
  const offered = quarterChoices(range);
  const toggle = (k) => setRange({ off: offSet.has(k) ? range.off.filter((x) => x !== k) : [...range.off, k].sort() });
  const removeExtra = (k) => setRange({ extra: range.extra.filter((x) => x !== k) });
  const thisYear = new Date().getUTCFullYear();
  const [addY, setAddY] = useState(String(thisYear + 3));
  const [addQ, setAddQ] = useState('1');
  const addKey = `${addY}-Q${addQ}`;
  const canAdd = isQuarterKey(addKey) && !offered.includes(addKey) && range.extra.length < MAX_EXTRA_QUARTERS;
  const add = () => { if (!canAdd) return; setRange(rolling.includes(addKey) ? { off: range.off.filter((x) => x !== addKey) } : { extra: [...range.extra, addKey].sort() }); };
  const [{ loading, data, error }, reload] = useOptions(src);
  const opts = data?.options || [];
  const unreadable = opts.filter((o) => !parseQuarter(o.value));
  return (
    <div className="stack" style={{ gap: 10, paddingTop: 18, borderTop: '1px solid var(--line-soft)' }}>
      <div className="row wrap" style={{ justifyContent: 'space-between', gap: 10 }}>
        <div className="row wrap" style={{ gap: 8 }}><b style={{ fontWeight: 560 }}>{tr('Ziel-Quartale', 'Target quarters')}</b><SourceChip field={src} meta={meta} /></div>
        {data?.manageUrl && <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={() => openJira(data.manageUrl)}><Icon name="external" size={13} />{tr('Optionen in Jira verwalten', 'Manage options in Jira')}</button>
          <button className="btn btn-ghost btn-sm" onClick={reload} disabled={loading}><Icon name="refresh" size={13} />{tr('Neu laden', 'Reload')}</button>
        </div>}
      </div>
      {src === 'app' ? (
        <div className="stack" style={{ gap: 10 }} data-quarter-range>
          <div className="muted" style={{ fontSize: 12.5 }}>{tr('Am Vorgang wählt man ein oder mehrere Quartale aus dieser Liste. Sie rollt mit der Zeit mit – lege fest, wie weit sie zurück und nach vorne reicht, schalte einzelne Quartale aus oder füge welche von Hand hinzu.', 'On the work item people pick one or more quarters from this list. It rolls forward with time – set how far back and ahead it reaches, switch single quarters off or add some by hand.')}</div>
          {!delegate && <div className="row wrap" style={{ gap: 16 }}>
            <NumField label={tr('Quartale zurück', 'Quarters back')} value={range.back} min={0} max={8} onChange={(v) => setRange({ back: Math.max(0, Math.min(8, Math.round(v) || 0)) })} />
            <NumField label={tr('Quartale voraus', 'Quarters ahead')} value={range.ahead} min={1} max={20} onChange={(v) => setRange({ ahead: Math.max(1, Math.min(20, Math.round(v) || 1)) })} />
          </div>}
          <div className="row wrap q-chips" style={{ gap: 5 }} role="group" aria-label={tr('Wählbare Quartale', 'Selectable quarters')} data-quarter-chips>
            {shown.map((k) => {
              const extra = range.extra.includes(k) && !rolling.includes(k);
              const off = offSet.has(k);
              const label = `${fmt.quarter(k)}${k === cur ? ` · ${tr('aktuell', 'current')}` : ''}`;
              return extra ? (
                <span key={k} className="chip chip-accent q-chip-extra" data-quarter={k}>{fmt.quarter(k)}<span className="faint" style={{ fontSize: 10.5 }}>{tr('manuell', 'manual')}</span>
                  {!delegate && <button type="button" className="chip-x" onClick={() => removeExtra(k)} aria-label={tr(`${fmt.quarter(k)} entfernen`, `Remove ${fmt.quarter(k)}`)}><Icon name="x" size={11} /></button>}</span>
              ) : (
                <button key={k} type="button" className={`chip ${off ? 'chip-outline q-chip-off' : k === cur ? 'chip-accent' : 'chip-outline'}`} aria-pressed={!off} disabled={delegate} data-quarter={k}
                  onClick={() => toggle(k)} title={off ? tr('Ausgeschaltet – Klick schaltet es wieder ein', 'Switched off – click to switch it on again') : tr('Klick schaltet dieses Quartal aus', 'Click to switch this quarter off')}>
                  {off ? <Icon name="x" size={11} /> : <Icon name="check" size={11} />}{label}
                </button>
              );
            })}
          </div>
          {!delegate && (
            <div className="row wrap" style={{ gap: 6, alignItems: 'center' }} data-quarter-add>
              <span className="muted" style={{ fontSize: 12.5 }}>{tr('Quartal hinzufügen', 'Add a quarter')}</span>
              <select className="select select-sm" value={addY} onChange={(e) => setAddY(e.target.value)} aria-label={tr('Jahr', 'Year')}>
                {Array.from({ length: 16 }, (_, i) => thisYear - 3 + i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <select className="select select-sm" value={addQ} onChange={(e) => setAddQ(e.target.value)} aria-label={tr('Quartal', 'Quarter')}>
                {['1', '2', '3', '4'].map((q) => <option key={q} value={q}>Q{q}</option>)}
              </select>
              <button type="button" className="btn btn-sm" disabled={!canAdd} onClick={add}><Icon name="plus" size={13} />{tr('Hinzufügen', 'Add')}</button>
              {!canAdd && offered.includes(addKey) && <span className="faint" style={{ fontSize: 12 }}>{tr('schon wählbar', 'already selectable')}</span>}
            </div>
          )}
          <div className="faint" style={{ fontSize: 12 }}>{tr(`${offered.length} Quartale wählbar${range.off.length ? ` · ${range.off.length} ausgeschaltet` : ''}${range.extra.length ? ` · ${range.extra.length} manuell` : ''}. Ein Klick schaltet ein Quartal aus oder wieder ein. Schon gesetzte Werte bleiben am Vorgang erhalten.`, `${offered.length} quarters selectable${range.off.length ? ` · ${range.off.length} switched off` : ''}${range.extra.length ? ` · ${range.extra.length} manual` : ''}. A click switches a quarter off or on again. Values already set stay on the work item.`)}</div>
        </div>
      ) : <div className="muted" style={{ fontSize: 12.5 }}>{tr('Gelesen werden Werte wie „2026-Q4", „Q4 2026" oder „Q4/26". Eine Option je Quartal anlegen; Mehrfachauswahl erlaubt mehrere Quartale.', 'Values like "2026-Q4", "Q4 2026" or "Q4/26" are understood. Create one option per quarter; multi-select allows several quarters.')}</div>}
      {loading && <Skeleton h={40} />}
      {error && <div className="callout bad"><Icon name="alert" /><div>{errText(error)}</div></div>}
      {opts.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>
          {opts.map((o) => { const q = parseQuarter(o.value); return <span key={o.value} className={`chip ${q ? 'chip-ok' : 'chip-warn'}`} title={q ? `= ${fmt.quarter(q)}` : tr('nicht als Quartal lesbar', 'not readable as a quarter')}>{q ? <Icon name="check" size={11} /> : <Icon name="alert" size={11} />}{o.value}</span>; })}
        </div>
      )}
      {unreadable.length > 0 && <div className="faint" style={{ fontSize: 12 }}>{tr(`${unreadable.length} Option(en) werden nicht als Quartal erkannt und deshalb ignoriert.`, `${unreadable.length} option(s) are not recognised as a quarter and are ignored.`)}</div>}
    </div>
  );
}

// Moves existing values from the app-owned field into the Jira field the admin switched to.
function CopyValues({ usage, to }) {
  const { done } = useApp();
  const [st, setSt] = useState(null);
  const run = async () => {
    let cursor = null;
    let acc = { copied: 0, skipped: 0, failed: [] };
    const ids = [];
    setSt({ ...acc, running: true });
    try {
      do {
        const r = await call('fields.copyValues', { usage, to, cursor });
        acc = { copied: acc.copied + r.copied, skipped: acc.skipped + r.skipped, failed: [...acc.failed, ...r.failed] };
        ids.push(...(r.copiedIds || []));
        setSt({ ...acc, running: true });
        cursor = r.nextCursor;
      } while (cursor);
      setSt({ ...acc, done: true });
    } catch (e) { setSt({ ...acc, error: errText(e) }); }
    // Undo empties the field again on exactly the items this copy filled (unless edited since).
    if (ids.length) {
      done(tr(`${ids.length} Werte übernommen`, `${ids.length} values copied`), 'arrowRight', tr(`${ids.length} Werte übernommen`, `${ids.length} values copied`), async () => {
        let cleared = 0, kept = 0;
        for (let i = 0; i < ids.length; i += 50) {
          const r = await call('fields.uncopyValues', { usage, to, issueIds: ids.slice(i, i + 50) });
          cleared += r.cleared; kept += r.kept;
        }
        setSt(null);
        if (kept) throw Object.assign(new Error(tr(`${cleared} zurückgesetzt, ${kept} seither geändert und deshalb behalten`, `${cleared} reverted, ${kept} changed since and therefore kept`)), { code: 'PARTIAL' });
      }, ids.map((id) => `fill:${id}:${usage}`));
    }
  };
  return (
    <div className="callout" style={{ marginTop: 8, fontSize: 12.5 }}>
      <Icon name="arrowRight" size={14} />
      <div className="stack" style={{ gap: 6 }}>
        {!st && <><span>{tr('Bisherige Werte aus dem App-Feld in das Jira-Feld übernehmen? Bereits gesetzte Werte bleiben unangetastet.', 'Copy existing values from the app field into the Jira field? Values already set there stay untouched.')}</span>
          <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={run}><Icon name="arrowRight" size={13} />{tr('Werte übernehmen', 'Copy values')}</button></>}
        {st && <span aria-live="polite">{st.running ? tr('Übernehme …', 'Copying …') : st.error ? tr('Abgebrochen', 'Stopped') : tr('Fertig', 'Done')}: <b>{st.copied}</b> {tr('übernommen', 'copied')}, {st.skipped} {tr('übersprungen (schon gesetzt)', 'skipped (already set)')}{st.failed.length ? `, ${st.failed.length} ${tr('nicht möglich', 'not possible')}` : ''}{st.error ? ` – ${st.error}` : ''}</span>}
        {st?.failed?.length > 0 && <div className="faint">{st.failed.slice(0, 5).map((f) => `${f.key}: ${f.reason}`).join(' · ')}{st.failed.length > 5 ? ' …' : ''}</div>}
      </div>
    </div>
  );
}

// ---------- versions, export & import ----------
function Versions({ cfg, meta, reload, milestones, onImport, savedAt }) {
  const { done, toast } = useApp();
  const [list, setList] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [warn, setWarn] = useState(null);
  const fileRef = useRef(null);
  const load = () => call('config.history').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [savedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const restore = async (v) => {
    setBusy(v.id);
    const current = list?.[0];
    try {
      await call('config.restore', { id: v.id });
      await reload(); await load();
      done(tr(`Version vom ${fmt.dateTime(v.at)} wiederhergestellt`, `Version from ${fmt.dateTime(v.at)} restored`), 'history', tr('Wiederherstellung', 'restore'), async () => {
        if (current) { await call('config.restore', { id: current.id }); await reload(); await load(); }
      }, ['config']);
    } catch (e) { toast({ text: errText(e), error: true }); } finally { setBusy(null); setConfirm(null); }
  };
  const exportCfg = () => {
    const blob = new Blob([JSON.stringify({ kind: 'portfolio-cockpit-config', exportedAt: new Date().toISOString(), config: cfg, milestones }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `portfolio-cockpit-config-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const importCfg = async (file) => {
    try {
      const j = JSON.parse(await file.text());
      const c = j?.config || j;
      if (!c || typeof c !== 'object' || !c.portfolio || !Array.isArray(c.levels)) throw new Error(tr('Keine Portfolio-Cockpit-Konfiguration', 'Not a Portfolio Cockpit configuration'));
      // Ids are site-specific: list what this site does not know, so nothing breaks silently.
      const typeIds = new Set((meta.issueTypes || []).map((t) => t.id));
      const fieldIds = new Set((meta.fields || []).map((f) => f.id));
      const unknownTypes = [...(c.portfolio.issueTypeIds || []), ...c.levels.flatMap((l) => l.issueTypeIds || [])].filter((id) => !typeIds.has(id));
      const unknownFields = Object.entries(c.fields || {}).filter(([, v]) => /^customfield_/.test(v || '') && !fieldIds.has(v)).map(([k, v]) => `${k} (${v})`);
      onImport({ ...cfg, ...c, setupComplete: cfg.setupComplete }, Array.isArray(j?.milestones) ? j.milestones : null);
      setWarn(unknownTypes.length || unknownFields.length ? { unknownTypes, unknownFields } : null);
      toast({ text: tr('Importiert – prüfen und speichern', 'Imported – review and save'), icon: 'check' });
    } catch (e) { toast({ text: `${tr('Import fehlgeschlagen', 'Import failed')}: ${e.message}`, error: true }); }
    if (fileRef.current) fileRef.current.value = '';
  };
  const label = (k) => (CHANGE_LABELS[k] ? tr(...CHANGE_LABELS[k]) : k);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row wrap" style={{ justifyContent: 'space-between', gap: 10 }}>
        <div className="muted" style={{ fontSize: 12.5, maxWidth: 620 }}>{tr('Jede gespeicherte Konfiguration wird als Version abgelegt (die letzten 30). Ändert frei – jede Version lässt sich mit einem Klick wiederherstellen.', 'Every saved configuration is kept as a version (the latest 30). Change things freely – any version can be restored with one click.')}</div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={exportCfg}><Icon name="download" size={13} />{tr('Exportieren', 'Export')}</button>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}><Icon name="plus" size={13} />{tr('Importieren', 'Import')}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importCfg(e.target.files[0])} aria-label={tr('Konfigurationsdatei importieren', 'Import configuration file')} />
        </div>
      </div>
      {warn && <div className="callout warn"><Icon name="alert" /><div>{tr('Auf dieser Site unbekannt – bitte vor dem Speichern anpassen:', 'Unknown on this site – adjust before saving:')} {[...warn.unknownTypes.map((t) => `${tr('Issue Type', 'Issue type')} ${t}`), ...warn.unknownFields].join(', ')}</div></div>}
      {!list ? <Skeleton h={120} /> : !list.length ? <Empty icon="history" title={tr('Noch keine Versionen', 'No versions yet')}>{tr('Die erste entsteht beim nächsten Speichern.', 'The first one is created with the next save.')}</Empty> : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Versionen', 'Versions')} style={{ maxHeight: 420 }}>
          <table className="table">
            <thead><tr><th>{tr('Zeitpunkt', 'When')}</th><th>{tr('Von', 'By')}</th><th>{tr('Geändert', 'Changed')}</th><th>{tr('T-Shirt-Größen', 'T-shirt sizes')}</th><th /></tr></thead>
            <tbody>
              {list.map((v, i) => (
                <tr key={v.id}>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmt.dateTime(v.at)}{i === 0 && <span className="chip chip-ok" style={{ marginLeft: 8 }}>{tr('aktuell', 'current')}</span>}</td>
                  <td>{v.note === 'before-history' ? <span className="muted">{tr('Stand vor der Versionierung', 'State before versioning')}</span> : v.byName || '–'}{v.note && v.note !== 'before-history' && <div className="faint" style={{ fontSize: 11.5 }}>{/^restored /.test(v.note) ? `${tr('Wiederherstellung von', 'restore of')} ${fmt.dateTime(v.note.slice(9))}` : v.note}</div>}</td>
                  <td><div className="row wrap" style={{ gap: 4 }}>{[...new Set((v.sections || []).map(label))].map((x) => <span key={x} className="chip chip-outline">{x}</span>)}</div></td>
                  <td className="muted" style={{ fontSize: 12 }}>{v.summary?.sizes || '–'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {i > 0 && (confirm === v.id
                      ? <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}><button className="btn btn-primary btn-xs" disabled={!!busy} onClick={() => restore(v)}>{busy === v.id ? '…' : tr('Ja, wiederherstellen', 'Yes, restore')}</button><button className="btn btn-ghost btn-xs" onClick={() => setConfirm(null)}>{tr('Abbrechen', 'Cancel')}</button></span>
                      : <button className="btn btn-ghost btn-xs" onClick={() => setConfirm(v.id)}><Icon name="history" size={12} />{tr('Wiederherstellen', 'Restore')}</button>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
