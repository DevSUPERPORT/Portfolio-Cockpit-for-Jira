// Planungs-Check on the Jira work item (module pc-story-check): team fit, time allocation, the assignee's load
// and conflicts – all computed on the server by shared/storyCheck.js with the cockpit's own engine.
// Deliberately tiny (no React) so it opens fast in the issue sidebar. Read-only.
import { view } from '@bridge-part/view'; // company policy: only the bridge modules needed, never the AI-assistant opener
import { invoke } from '@bridge-part/invoke';
import { router } from '@bridge-part/router';
import './story.css';

const app = document.getElementById('app');
let de = true;
const tr = (d, e) => (de ? d : e);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
const TONE = () => ({ bad: tr('Konflikt', 'Conflict'), warn: tr('Hinweis', 'Warning'), info: tr('Info', 'Info'), ok: tr('OK', 'OK') });
const nf = () => new Intl.NumberFormat(de ? 'de-DE' : 'en-GB', { maximumFractionDigits: 1 });
const h = (v) => `${nf().format(Math.round((+v || 0) * 10) / 10)} h`;
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)} %` : '∞');

const openIssue = (key) => router.navigate({ target: 'issue', issueKey: key }).catch(() => {});
const keyLink = (key) => el('button', { type: 'button', class: 'key', onclick: () => openIssue(key), title: tr(`${key} öffnen`, `Open ${key}`) }, key);

function note(n) {
  return el('li', { class: `note ${n.tone}` },
    el('span', { class: 'dot', 'aria-hidden': 'true' }),
    el('span', { class: 'sr' }, `${TONE()[n.tone]}: `),
    el('span', {}, n.key && n.text.includes(n.key) ? splitKey(n.text, n.key) : n.text));
}
// make the work-item key inside a sentence clickable
function splitKey(text, key) {
  const i = text.indexOf(key);
  return [text.slice(0, i), keyLink(key), text.slice(i + key.length)];
}
const rows = (list) => el('dl', { class: 'rows' }, list.map(([k, v]) => el('div', {}, el('dt', {}, k), el('dd', {}, v))));
const chip = (tone) => (tone && tone !== 'ok' && tone !== 'info' ? el('span', { class: `chip ${tone}` }, TONE()[tone]) : tone === 'ok' ? el('span', { class: 'chip ok' }, '✓') : null);
function section(title, tone, ...kids) {
  return el('section', { class: 'sec' }, el('h3', {}, el('span', {}, title), chip(tone)), ...kids);
}
const notes = (list) => (list?.length ? el('ul', { class: 'notes' }, list.map(note)) : null);

function loadChart(load) {
  const max = 1.5;
  return el('ol', { class: 'weeks', 'aria-label': tr(`Auslastung von ${load.name} je Woche`, `${load.name}'s load per week`) },
    load.weeks.map((w) => {
      const none = !Number.isFinite(w.util) && w.plan > 0.05; // planned work, but no available time at all (JSON turns ∞ into null)
      const u = Number.isFinite(w.util) ? w.util : 0;
      const title = none
        ? `${w.label}: ${tr('keine verfügbare Zeit (Abwesenheit/Feiertage), trotzdem', 'no available time (absence/holidays), yet')} ${h(w.plan)} ${tr('geplant', 'planned')}${w.story > 0.05 ? ` · ${tr('davon diese Story', 'of which this story')} ${h(w.story)}` : ''}`
        : `${w.label}: ${h(w.plan)} ${tr('geplant', 'planned')} / ${h(w.cap)} ${tr('verfügbar', 'available')} = ${pct(w.util)}${w.story > 0.05 ? ` · ${tr('davon diese Story', 'of which this story')} ${h(w.story)}` : ''}`;
      return el('li', { class: `wk ${w.tone}${none ? ' none' : ''}`, title, tabindex: '0', 'aria-label': title },
        el('span', { class: 'wl' }, w.label),
        el('span', { class: 'bar' },
          none ? el('i', { class: 'fill', style: 'width:100%' }) : el('i', { class: 'fill', style: `width:${Math.min(100, (u / max) * 100)}%` }),
          !none && w.story > 0.05 && w.plan > 0 ? el('i', { class: 'mine', style: `width:${Math.min(100, ((Math.min(u, max) * (w.story / w.plan)) / max) * 100)}%` }) : null,
          el('i', { class: 'full', style: `left:${(1 / max) * 100}%` })),
        el('span', { class: 'wv' }, none ? tr('keine Zeit', 'no time') : w.plan <= 0.05 && !(w.cap > 0) ? '–' : pct(w.util)));
    }));
}

function renderStory(r) {
  const out = [];
  out.push(el('div', { class: `head ${r.tone}`, role: 'status' },
    el('span', { class: 'big-dot', 'aria-hidden': 'true' }),
    el('div', {}, el('b', {}, r.headline),
      r.project ? el('div', { class: 'sub' }, tr(`Projekt „${r.project.name}“ · Rang ${r.project.rank}`, `Project "${r.project.name}" · rank ${r.project.rank}`)) : null,
      r.viaParent ? el('div', { class: 'sub' }, tr(`Teilaufgabe – geplant wird über die Story ${r.key}.`, `Sub-task – planning runs through story ${r.key}.`)) : null)));
  // the assignee is not part of the work item's team (boss feedback 2026-11-17) – said first, in plain words
  const ac = r.assigneeCheck;
  if (ac?.status === 'outside') {
    const who = ac.name || tr('Die bearbeitende Person', 'The assignee');
    out.push(el('div', { class: 'assignee-out', role: 'alert' },
      el('span', { class: 'tag' }, tr('Nicht im Team', 'Not in team')),
      el('div', {},
        el('b', {}, tr(`${who} gehört nicht zum Team ${ac.team}.`, `${who} is not part of team ${ac.team}.`)),
        el('div', { class: 'sub' }, ac.source === 'atlassian'
          ? tr('Laut Atlassian Teams ist die Person kein Mitglied. Details und Lösungen unter „Team & Zuständigkeit“.', 'According to Atlassian Teams the person is not a member. Details and fixes under "Team & assignee".')
          : tr('Laut Kapazitätsplanung im Cockpit hat die Person keinen Anteil an diesem Team. Details und Lösungen unter „Team & Zuständigkeit“.', 'According to the cockpit’s capacity planning the person has no share in this team. Details and fixes under "Team & assignee".')))));
  }
  out.push(section(tr('Team & Zuständigkeit', 'Team & assignee'), r.team.tone, rows(r.team.rows), notes(r.team.notes)));
  out.push(section(tr('Zeitplanung', 'Time allocation'), r.time.tone, rows(r.time.rows), notes(r.time.notes)));
  if (r.load) out.push(section(tr(`Auslastung von ${r.load.name}`, `${r.load.name}'s load`), r.load.tone, rows(r.load.rows), loadChart(r.load),
    el('p', { class: 'hint' }, tr('Balken: geplant ÷ verfügbar je Woche (Strich = 100 %). Dunkler Teil = diese Story. Verfügbar = Wochenstunden − Tagesgeschäft − Intern − Support − Abwesenheit/Feiertage.', 'Bar: planned ÷ available per week (line = 100 %). Darker part = this story. Available = weekly hours − daily business − internal − support − absence/holidays.')),
    notes(r.load.notes)));
  else if (!r.personLevel) out.push(section(tr('Auslastung', 'Load'), 'info', el('p', { class: 'hint' }, tr('Personenbezogene Auswertungen sind in diesem Jira ausgeschaltet.', 'Person-level values are switched off on this site.'))));
  out.push(section(tr('Konflikte & Abhängigkeiten', 'Conflicts & dependencies'), r.conflicts.reduce((w, c) => ({ ok: 0, info: 1, warn: 2, bad: 3 }[c.tone] > { ok: 0, info: 1, warn: 2, bad: 3 }[w] ? c.tone : w), 'ok'),
    r.conflicts.length ? notes(r.conflicts) : el('p', { class: 'hint' }, tr('Keine Abhängigkeiten oder Terminkonflikte.', 'No dependencies or date conflicts.'))));
  return out;
}
function renderGroup(r) {
  return [
    el('div', { class: `head ${r.tone}`, role: 'status' }, el('span', { class: 'big-dot', 'aria-hidden': 'true' }), el('div', {}, el('b', {}, r.headline), el('div', { class: 'sub' }, r.intro))),
    ...r.groups.map((g) => section(`${g.text} · ${g.n}`, g.tone, g.items.length ? el('ul', { class: 'items' }, g.items.map((x) => el('li', {}, keyLink(x.key), ' ', x.summary))) : null)),
  ];
}

async function load(lang) {
  app.setAttribute('aria-busy', 'true');
  if (!app.firstChild) app.append(el('div', { class: 'skel' }, el('i'), el('i'), el('i')));
  const res = await invoke('story.check', { lang }).catch((e) => ({ ok: false, error: { code: 'ERROR', message: String(e?.message || e) } }));
  app.removeAttribute('aria-busy');
  const foot = el('div', { class: 'foot' },
    el('button', { type: 'button', class: 'ghost', onclick: () => router.navigate({ target: 'module', moduleKey: 'pc-cockpit' }).catch(() => {}) }, tr('Im Portfolio Cockpit öffnen', 'Open Portfolio Cockpit')),
    el('button', { type: 'button', class: 'ghost', onclick: () => load(lang) }, tr('Neu prüfen', 'Check again')));
  if (!res?.ok) {
    const c = res?.error?.code;
    const msg = c === 'UNAVAILABLE' ? tr('Portfolio Cockpit ist vorübergehend pausiert – nichts geht verloren.', 'Portfolio Cockpit is paused for now – nothing is lost.')
      : c === 'SETUP_REQUIRED' ? tr('Das Portfolio Cockpit ist noch nicht eingerichtet.', 'Portfolio Cockpit is not set up yet.')
        : c === 'LICENSE_INACTIVE' ? tr('Die Lizenz des Portfolio Cockpit ist nicht aktiv.', 'The Portfolio Cockpit licence is not active.')
          : tr('Der Planungs-Check konnte gerade nicht geladen werden.', 'The planning check could not be loaded right now.');
    app.replaceChildren(el('p', { class: 'muted', role: 'alert' }, msg), foot);
    return;
  }
  const r = res.data;
  if (!r.known) {
    app.replaceChildren(el('p', { class: 'muted' }, r.setup === false ? tr('Das Portfolio Cockpit ist noch nicht eingerichtet.', 'Portfolio Cockpit is not set up yet.') : r.text), foot);
    return;
  }
  app.replaceChildren(...(r.kind === 'story' ? renderStory(r) : renderGroup(r)),
    el('p', { class: 'stamp' }, tr(`Stand ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · dieselben Zahlen wie im Portfolio Cockpit`, `As of ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · the same numbers as in Portfolio Cockpit`)), foot);
}

(async () => {
  try { await view.theme.enable(); } catch { /* light */ }
  const ctx = await view.getContext().catch(() => ({}));
  de = String(ctx.locale || 'de').toLowerCase().startsWith('de');
  document.documentElement.lang = de ? 'de' : 'en';
  await load(de ? 'de' : 'en');
})();
