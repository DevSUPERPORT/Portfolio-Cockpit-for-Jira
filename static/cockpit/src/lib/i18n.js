// Two languages, chosen from the Jira locale. Strings live next to their use as tr('Deutsch', 'English').
let lang = 'de';
let locale = 'de-DE';
export function setLocale(l) {
  const s = String(l || 'de-DE').replace('_', '-');
  lang = s.toLowerCase().startsWith('de') ? 'de' : 'en';
  locale = lang === 'de' ? 'de-DE' : s.includes('-') ? s : 'en-GB';
  document.documentElement.lang = lang;
}
export const getLang = () => lang;
// The Jira locale is the default; a user's explicit choice (DE/EN switch) wins. Choosing the Jira
// locale's own language keeps its regional formats (e.g. en-US dates).
let jiraLocale = 'de-DE';
export function setJiraLocale(l) { jiraLocale = String(l || 'de-DE').replace('_', '-'); setLocale(jiraLocale); }
export function chooseLang(l) {
  if (l !== 'de' && l !== 'en') return setLocale(jiraLocale);
  setLocale(jiraLocale.toLowerCase().startsWith(l) ? jiraLocale : l);
}
export const tr = (de, en) => (lang === 'de' ? de : en);

// Formatters are kept per locale and options: building one costs 100–250 µs (measured), using one ~2 µs – a board
// formats thousands of numbers and dates per render. Same output as a new formatter per call.
const fmtCache = new Map();
const cached = (Ctor, o) => {
  const k = `${Ctor.name}|${locale}|${JSON.stringify(o)}`;
  let f = fmtCache.get(k);
  if (!f) { f = new Ctor(locale, o); fmtCache.set(k, f); }
  return f;
};
const nf = (o) => cached(Intl.NumberFormat, o);
const df = (o) => cached(Intl.DateTimeFormat, o);
export const fmt = {
  n: (v, d = 0) => (v == null || !Number.isFinite(v) ? '–' : nf({ maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v)),
  h: (v, d = 0) => (v == null || !Number.isFinite(v) ? '–' : `${nf({ maximumFractionDigits: d }).format(v)} h`),
  pct: (v, d = 0) => (v == null || !Number.isFinite(v) ? '–' : lang === 'de' ? `${nf({ maximumFractionDigits: d }).format(v * 100)} %` : `${nf({ maximumFractionDigits: d }).format(v * 100)}%`),
  signedPct: (v) => (v == null || !Number.isFinite(v) ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt.pct(Math.abs(v))}`),
  signedH: (v) => (v == null || !Number.isFinite(v) ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmt.h(Math.abs(v))}`),
  date: (iso, o = { day: '2-digit', month: 'short' }) => (iso ? df({ timeZone: 'UTC', ...o }).format(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)) : '–'),
  dateLong: (iso) => fmt.date(iso, { day: '2-digit', month: 'short', year: 'numeric' }),
  time: (iso) => (iso ? df({ hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '–'),
  dateTime: (iso) => (iso ? df({ day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '–'),
  dateTimeSec: (iso) => (iso ? df({ day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso)) : '–'),
  ago: (iso) => {
    if (!iso) return '–';
    const s = (Date.now() - Date.parse(iso)) / 1000;
    const rtf = cached(Intl.RelativeTimeFormat, { numeric: 'auto' });
    if (s < 60) return rtf.format(-Math.round(s), 'second');
    if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
    if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    return rtf.format(-Math.round(s / 86400), 'day');
  },
  quarter: (q) => (q ? `Q${q.slice(-1)} ${q.slice(0, 4)}` : '–'),
  week: (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const w = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
    return `${lang === 'de' ? 'KW' : 'W'} ${w}`;
  },
};

export const roleName = (role) => ({
  portfolio: tr('Portfolio-Projekt', 'Portfolio project'), rough: tr('Grobplanung', 'Rough planning'), structure: tr('Struktur', 'Structure'),
  estimate: tr('Schätzung & Zeiterfassung', 'Estimation & time tracking'), tiny: tr('Kleinst-Tasks', 'Tiny tasks'),
}[role] || role);
export const usageName = (u) => ({
  owner: 'Owner', team: tr('Team', 'Team'), assignee: 'Assignee', originalEstimate: 'Original Estimate', startDate: 'Start Date', dueDate: 'Due Date',
  milestone: tr('Meilenstein', 'Milestone'), tshirt: tr('T-Shirt-Größe', 'T-shirt size'), targetQuarters: tr('Ziel-Quartale', 'Target quarters'), parent: tr('Übergeordneter Vorgang', 'Parent'),
}[u] || u);
export const healthName = (h) => ({ onTrack: tr('Im Plan', 'On track'), atRisk: tr('Gefährdet', 'At risk'), critical: tr('Kritisch', 'Critical') }[h] || tr('Kein Update', 'No update'));
export const ruleName = (rule) => {
  const r = String(rule || '');
  if (r.startsWith('missing:')) {
    const u = r.slice(8);
    return tr(`${usageName(u)} fehlt`, `${usageName(u)} missing`);
  }
  return ({
    dueAfterMilestone: tr('Due Date nach Meilenstein', 'Due date after milestone'), datesInverted: tr('Start nach Due Date', 'Start after due date'), overdue: tr('Due Date überschritten', 'Due date exceeded'),
    outsideParent: tr('Termine außerhalb des Epic-Zeitraums', 'Dates outside the epic time frame'), roughTooLong: tr('Über mehr als 2 Quartale – teilen', 'Spans more than 2 quarters – split'),
  }[r] || r);
};
