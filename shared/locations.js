// Locations (UC-09): named places with their own holiday calendar and working days. config.locations =
//   [{ id, name, calendar (a LOCATIONS code or 'NONE'), workdays: [1..7] (ISO, 1 = Monday), off: ['YYYY-MM-DD'] (public
//      holidays deselected), own: [{ d: 'YYYY-MM-DD', name }] (company days off, e.g. company shutdown, bridge day) }]
// A person's capacity.people[id].location is EITHER a location id OR – as before – a calendar code ('DE-HH', 'AT' …).
// An empty list keeps the old behaviour exactly: Monday–Friday, the calendar's public holidays.
//
// Days off of a location = calendar holidays − deselected + company days off; a working day is one of the location's
// weekdays that is not a day off. Weekly hours are spread over the location's working days (weekly ÷ days per week).
import { LOCATIONS, CALENDAR_CHOICES, holidaysBetween, holidayName, HOLIDAY_NAMES } from './holidays.js';
import { dayIdx, isoOf, dow } from './dates.js';

export const DEFAULT_LOCATIONS = [];
export const LOCATION_ID_RE = /^[a-z0-9-]{1,32}$/;
export const MAX_LOCATIONS = 30;
export const MAX_OWN_DAYS = 60;
export const MAX_OFF_DAYS = 120;
export const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s) => typeof s === 'string' && DATE_RE.test(s) && isoOf(dayIdx(s)) === s;
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const toIdx = (d) => (d == null ? null : typeof d === 'number' ? d : dayIdx(d));
export const isoWeekday = (idx) => dow(idx) || 7; // 1 = Monday … 7 = Sunday

// ---------- validation ----------
// Strict: invalid or duplicate ids, unknown calendars, bad dates and everything beyond the limits are dropped.
export function validLocations(input) {
  const list = Array.isArray(input) ? input : Array.isArray(input?.locations) ? input.locations : [];
  const seen = new Set();
  const out = [];
  for (const x of list) {
    if (out.length >= MAX_LOCATIONS) break;
    if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !LOCATION_ID_RE.test(x.id) || seen.has(x.id)) continue;
    seen.add(x.id);
    const wd = [...new Set((Array.isArray(x.workdays) ? x.workdays : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))].sort((a, b) => a - b);
    const own = [];
    const ownSeen = new Set();
    for (const o of Array.isArray(x.own) ? x.own : []) {
      if (own.length >= MAX_OWN_DAYS) break;
      if (!o || !validDate(o.d) || ownSeen.has(o.d)) continue;
      ownSeen.add(o.d);
      own.push({ d: o.d, name: clean(o.name, 60) });
    }
    out.push({
      id: x.id,
      name: clean(x.name, 60) || x.id,
      calendar: typeof x.calendar === 'string' && Object.hasOwn(LOCATIONS, x.calendar) ? x.calendar : 'NONE',
      workdays: wd.length ? wd : [...DEFAULT_WORKDAYS],
      off: [...new Set((Array.isArray(x.off) ? x.off : []).filter(validDate))].sort().slice(0, MAX_OFF_DAYS),
      own: own.sort((a, b) => a.d.localeCompare(b.d)),
    });
  }
  return out;
}
// A new, unused id from a name ("Hamburg Office" → "hamburg-office", "-2" when taken).
export function locationId(name, taken = []) {
  const used = new Set((taken || []).map((l) => (typeof l === 'string' ? l : l?.id)));
  const base = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'standort';
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
}

// ---------- resolution ----------
// src: the locations array, a config ({ locations }), a model ({ cfg }) or a dataset ({ config }).
export function locationsOf(src) {
  if (Array.isArray(src)) return src;
  if (Array.isArray(src?.locations)) return src.locations;
  if (Array.isArray(src?.cfg?.locations)) return src.cfg.locations;
  if (Array.isArray(src?.config?.locations)) return src.config.locations;
  if (Array.isArray(src?.ds?.config?.locations)) return src.ds.config.locations;
  return DEFAULT_LOCATIONS;
}
const resolved = new WeakMap(); // locations array → Map(code → location)
function build(l, legacy) {
  const workdays = l.workdays?.length ? [...l.workdays] : [...DEFAULT_WORKDAYS];
  const own = new Map();
  for (const o of l.own || []) { const i = dayIdx(o.d); if (i != null) own.set(i, o.name || ''); }
  return {
    id: l.id, name: l.name, calendar: l.calendar || 'NONE', legacy, workdays, days: new Set(workdays), perWeek: workdays.length,
    off: new Set((l.off || []).map(dayIdx).filter((i) => i != null)), own,
  };
}
// The location a person's `location` value stands for: a named location by id; a calendar code ('DE-NW') stands for
// the first named location with that calendar (so people need no change after "Standorte anlegen"), otherwise for
// the calendar itself (legacy: Monday–Friday). Unknown ids (a deleted location) fall back to 'NONE'.
export function resolveLocation(src, code) {
  const list = locationsOf(src);
  let cache = resolved.get(list);
  if (!cache) { cache = new Map(); resolved.set(list, cache); }
  const key = code == null || code === '' ? 'NONE' : String(code);
  if (cache.has(key)) return cache.get(key);
  const named = list.find((l) => l && l.id === key) || (key !== 'NONE' && Object.hasOwn(LOCATIONS, key) ? list.find((l) => l && l.calendar === key) : null);
  const cal = Object.hasOwn(LOCATIONS, key) ? key : 'NONE';
  const out = named ? build(named, false) : build({ id: cal, name: LOCATIONS[cal], calendar: cal }, true);
  cache.set(key, out);
  return out;
}
// What the location select offers: the named locations, or – while none are defined – the calendars.
export function locationOptions(src) {
  const list = locationsOf(src);
  if (list.length) return list.map((l) => ({ value: l.id, label: l.name, named: true }));
  return CALENDAR_CHOICES.map(({ value, label }) => ({ value, label, named: false }));
}
export const locationLabel = (src, code) => resolveLocation(src, code).name || code || '';
// How many people use each location: { [location id or calendar code]: n } (resolved as above).
export function countByLocation(src, capacityPeople) {
  const out = {};
  for (const p of Object.values(capacityPeople || {})) { const id = resolveLocation(src, p?.location).id; out[id] = (out[id] || 0) + 1; }
  return out;
}

// ---------- days off and working days ----------
// Effective days off in [from, to] (day indices or ISO dates): calendar holidays − deselected + company days off.
export function holidaysFor(src, code, from, to) {
  const loc = resolveLocation(src, code);
  const a = toIdx(from), b = toIdx(to);
  const set = holidaysBetween(loc.calendar, a, b);
  if (loc.legacy) return set;
  for (const d of loc.off) set.delete(d);
  for (const d of loc.own.keys()) if (d >= a && d <= b) set.add(d);
  return set;
}
export function isWorkday(src, code, day) {
  const loc = resolveLocation(src, code);
  const d = toIdx(day);
  return d != null && loc.days.has(isoWeekday(d)) && !holidaysFor(src, code, d, d).has(d);
}
// Working days of a resolved location in [a, b], minus the days in `hol` (a Set of day indices) that are working days.
// For Monday–Friday this is exactly dates.workdays(a, b, hol).
export function countWorkdays(loc, a, b, hol) {
  if (a == null || b == null || b < a) return 0;
  const len = b - a + 1;
  const full = Math.floor(len / 7);
  let n = full * loc.perWeek;
  for (let i = a + full * 7; i <= b; i++) if (loc.days.has(isoWeekday(i))) n++;
  if (hol && hol.size) for (const h of hol) if (h >= a && h <= b && loc.days.has(isoWeekday(h))) n--;
  return n;
}
// One person in [a, b]: the location's working days (all), after days off (work), recorded absences on working days
// (absent) and what is left (days); hours per day = weekly hours ÷ perWeek. The same arithmetic every capacity
// view uses (engine, team, week plan, booking check, my work).
// Called per person × week × view: the location's days off and working days of a span are cached per resolved
// location (a new locations list resolves to new objects, so an edit never sees stale days), and the absences are
// indexed per person once per absences array (same order, so the same sums).
const spanCache = new WeakMap(); // resolved location → Map(`${a}:${b}` → { hol, all, work })
function spanOf(src, code, loc, a, b) {
  let m = spanCache.get(loc);
  if (!m) { m = new Map(); spanCache.set(loc, m); }
  const k = `${a}:${b}`;
  let v = m.get(k);
  if (!v) {
    const hol = holidaysFor(src, code, a, b);
    v = { hol, all: countWorkdays(loc, a, b), work: countWorkdays(loc, a, b, hol) };
    if (m.size > 20000) m.clear();
    m.set(k, v);
  }
  return v;
}
const absIndex = new WeakMap(); // absences array → { n, by: Map(accountId → absences) }
function absencesOf(absences, id) {
  if (!absences?.length) return [];
  let x = absIndex.get(absences);
  if (!x || x.n !== absences.length) {
    const by = new Map();
    for (const ab of absences) (by.get(ab.accountId) || by.set(ab.accountId, []).get(ab.accountId)).push(ab);
    x = { n: absences.length, by };
    absIndex.set(absences, x);
  }
  return x.by.get(id) || [];
}
export function personDays(src, person, absences, a, b) {
  const code = person?.location || 'NONE';
  const loc = resolveLocation(src, code);
  const { hol, all, work } = spanOf(src, code, loc, a, b);
  let absent = 0;
  for (const ab of absencesOf(absences, person?.id)) {
    if (ab.accountId !== person?.id) continue;
    const s = Math.max(a, dayIdx(ab.from)), e = Math.min(b, dayIdx(ab.to));
    if (e >= s) absent += countWorkdays(loc, s, e, hol);
  }
  return { loc, hol, all, work, absent, days: Math.max(0, work - absent), perWeek: loc.perWeek || 5 };
}

// One person's days off on working days in [a, b] (day indices), for the week tooltips (boss 2026-11-23: "the complete
// period and the free days – holidays etc."): public holidays by name, company days off, recorded absences. An absence
// says only "absent" unless `reasons` (capacity editors see the reason – GDPR minimisation, as in the dataset).
// → [{ iso, kind: 'holiday' | 'own' | 'absent', name, type }] sorted by day
export function daysOffOf(src, person, absences, a, b, { lang = 'de', reasons = false } = {}) {
  if (a == null || b == null || b < a) return [];
  const code = person?.location || 'NONE';
  const loc = resolveLocation(src, code);
  const hol = holidaysFor(src, code, a, b);
  const out = [];
  for (const d of [...hol].sort((x, y) => x - y)) {
    if (!loc.days.has(isoWeekday(d))) continue;
    const k = loc.own?.has?.(d) ? null : holidayName(loc.calendar, d);
    out.push({ iso: isoOf(d), idx: d, kind: k ? 'holiday' : 'own', name: k ? HOLIDAY_NAMES[k][lang === 'en' ? 1 : 0] : (loc.own?.get?.(d) || '') });
  }
  for (const ab of absencesOf(absences, person?.id)) {
    if (ab.accountId !== person?.id) continue;
    const s = Math.max(a, dayIdx(ab.from)), e = Math.min(b, dayIdx(ab.to));
    for (let d = s; d <= e; d++) if (loc.days.has(isoWeekday(d)) && !hol.has(d)) out.push({ iso: isoOf(d), idx: d, kind: 'absent', name: '', type: reasons ? ab.type || null : null });
  }
  return out.sort((x, y) => x.idx - y.idx);
}

// ---------- for the settings ----------
// The coming days off of a location in [from, to] for the chips: public holidays (with `deselected`) and company days.
export function upcomingDays(location, from, to, lang = 'de') {
  const loc = build(location, false);
  const a = toIdx(from), b = toIdx(to);
  const out = [];
  for (const d of [...holidaysBetween(loc.calendar, a, b)].sort((x, y) => x - y)) {
    const k = holidayName(loc.calendar, d);
    out.push({ iso: isoOf(d), idx: d, kind: 'holiday', name: k ? HOLIDAY_NAMES[k][lang === 'en' ? 1 : 0] : '', deselected: loc.off.has(d), weekday: loc.days.has(isoWeekday(d)) });
  }
  for (const [d, name] of loc.own) if (d >= a && d <= b) out.push({ iso: isoOf(d), idx: d, kind: 'own', name, deselected: false, weekday: loc.days.has(isoWeekday(d)) });
  return out.sort((x, y) => x.idx - y.idx);
}
// One location per calendar code people use today (one click "Standorte anlegen"). The people keep their codes –
// resolveLocation maps a code to the location with that calendar; remapPeople can store the ids instead.
export function migrateLocations(capacityPeople, defaultLocation = null) {
  const codes = new Set();
  for (const p of Object.values(capacityPeople || {})) if (p?.location && Object.hasOwn(LOCATIONS, p.location) && p.location !== 'NONE') codes.add(p.location);
  if (defaultLocation && Object.hasOwn(LOCATIONS, defaultLocation) && defaultLocation !== 'NONE') codes.add(defaultLocation);
  const out = [];
  for (const code of [...codes].sort()) {
    const name = LOCATIONS[code].replace(/^Deutschland – /, '').replace(/ \(.*\)$/, '').split(' / ').pop(); // the country's own name
    out.push({ id: locationId(name, out), name, calendar: code, workdays: [...DEFAULT_WORKDAYS], off: [], own: [] });
  }
  return validLocations(out);
}
// People with a calendar code that a migrated location stands for get that location's id (other values stay).
export function remapPeople(capacityPeople, locations) {
  const byCal = new Map();
  for (const l of locations || []) if (!byCal.has(l.calendar)) byCal.set(l.calendar, l.id);
  return Object.fromEntries(Object.entries(capacityPeople || {}).map(([id, p]) => [id, byCal.has(p?.location) ? { ...p, location: byCal.get(p.location) } : p]));
}
