// Public holidays per location, computed (no external calendar service needed, works on every site).
import { ymdIdx, dow } from './dates.js';
import { COUNTRIES, RULES, MORE_NAMES } from './holidayRules.js';

function easter(y) { // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymdIdx(y, month, day);
}
function orthodoxEaster(y) { // Julian computus shifted to Gregorian
  const a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
  return ymdIdx(y, month, day) + 13;
}
const nthWeekday = (y, m, wd, n) => { // n-th weekday (0=Sun) of month; n = -1 for last
  if (n > 0) { const first = ymdIdx(y, m, 1); return first + ((wd - dow(first) + 7) % 7) + (n - 1) * 7; }
  const last = (m === 12 ? ymdIdx(y + 1, 1, 1) : ymdIdx(y, m + 1, 1)) - 1;
  return last - ((dow(last) - wd + 7) % 7);
};

const DE_STATES = {
  'DE-BW': 'Baden-Württemberg', 'DE-BY': 'Bayern', 'DE-BE': 'Berlin', 'DE-BB': 'Brandenburg', 'DE-HB': 'Bremen',
  'DE-HH': 'Hamburg', 'DE-HE': 'Hessen', 'DE-MV': 'Mecklenburg-Vorpommern', 'DE-NI': 'Niedersachsen',
  'DE-NW': 'Nordrhein-Westfalen', 'DE-RP': 'Rheinland-Pfalz', 'DE-SL': 'Saarland', 'DE-SN': 'Sachsen',
  'DE-ST': 'Sachsen-Anhalt', 'DE-SH': 'Schleswig-Holstein', 'DE-TH': 'Thüringen',
};
// Every calendar the app can compute. Offered (CALENDAR_CHOICES): one per country with its national – state-wide –
// public holidays (boss 2026-11-18: "all countries, excluding the federal states"). The German states are no longer
// offered; locations that already use one keep it (still computed, marked in the select) until an admin switches.
const HAND = [
  ['DE', 'Deutschland', 'Germany'], ['AT', 'Österreich', 'Austria'], ['CH', 'Schweiz / Suisse / Svizzera', 'Switzerland'], ['GB', 'England & Wales', 'United Kingdom (England & Wales)'],
  ['US', 'United States', 'United States'], ['GR', 'Ελλάδα', 'Greece'], ['AU', 'Australia', 'Australia'], ['BE', 'Belgique / België', 'Belgium'], ['HR', 'Hrvatska', 'Croatia'],
  ['CZ', 'Česko', 'Czechia'], ['DK', 'Danmark', 'Denmark'], ['ES', 'España', 'Spain'], ['FR', 'France', 'France'], ['GB-NIR', 'Northern Ireland', 'United Kingdom (Northern Ireland)'],
  ['HU', 'Magyarország', 'Hungary'], ['IE', 'Ireland', 'Ireland'], ['IT', 'Italia', 'Italy'], ['LU', 'Luxembourg', 'Luxembourg'], ['NA', 'Namibia', 'Namibia'], ['NL', 'Nederland', 'Netherlands'],
  ['NO', 'Norge', 'Norway'], ['PL', 'Polska', 'Poland'], ['PT', 'Portugal', 'Portugal'], ['RO', 'România', 'Romania'], ['SE', 'Sverige', 'Sweden'], ['SK', 'Slovensko', 'Slovakia'],
  ['SI', 'Slovenija', 'Slovenia'], ['RS', 'Srbija', 'Serbia'],
];
// English first, then the country's own name (boss 2026-11-18: easier to find for a Jira admin); a note in brackets last
// (the country's name only once: "United Kingdom (Scotland)", not "United Kingdom (Scotland) / Scotland")
const labelOf = (native, english, note) => `${english.includes(native) ? english : `${english} / ${native}`}${note ? ` (${note})` : ''}`;
const NATIONAL = [...HAND, ...COUNTRIES].sort((a, b) => a[2].localeCompare(b[2], 'en'));
export const LEGACY_CALENDARS = new Set(Object.keys(DE_STATES));
export const LOCATIONS = {
  NONE: 'Ohne Feiertage / No holidays',
  ...Object.fromEntries(NATIONAL.map(([k, n, e, note]) => [k, labelOf(n, e, note)])),
  ...Object.fromEntries(Object.entries(DE_STATES).map(([k, v]) => [k, `Deutschland – ${v}`])),
};
// What a calendar select offers: no holidays, then every country by its English name. A legacy code in use is added
// by the caller (calendarChoices(current)).
export const CALENDAR_CHOICES = [{ value: 'NONE', label: LOCATIONS.NONE }, ...NATIONAL.map(([k]) => ({ value: k, label: LOCATIONS[k] }))];
export const calendarChoices = (current) => (current && LEGACY_CALENDARS.has(current)
  ? [...CALENDAR_CHOICES, { value: current, label: `${LOCATIONS[current]} (Bundesland – nicht mehr angeboten)`, legacy: true }] : CALENDAR_CHOICES);

// Holiday names [Deutsch, English] – for the location settings (chips) and explanations.
export const HOLIDAY_NAMES = {
  ny: ['Neujahr', 'New Year\'s Day'], epi: ['Heilige Drei Könige', 'Epiphany'], wom: ['Internationaler Frauentag', 'International Women\'s Day'],
  gf: ['Karfreitag', 'Good Friday'], em: ['Ostermontag', 'Easter Monday'], lab: ['Tag der Arbeit', 'Labour Day'],
  asc: ['Christi Himmelfahrt', 'Ascension Day'], wm: ['Pfingstmontag', 'Whit Monday'], cc: ['Fronleichnam', 'Corpus Christi'],
  ass: ['Mariä Himmelfahrt', 'Assumption Day'], kid: ['Weltkindertag', 'World Children\'s Day'], unity: ['Tag der Deutschen Einheit', 'German Unity Day'],
  ref: ['Reformationstag', 'Reformation Day'], all: ['Allerheiligen', 'All Saints\' Day'], bnt: ['Buß- und Bettag', 'Day of Repentance and Prayer'],
  xmas: ['1. Weihnachtstag', 'Christmas Day'], box: ['2. Weihnachtstag', 'St Stephen\'s Day'], atNat: ['Nationalfeiertag', 'National Day'],
  imm: ['Mariä Empfängnis', 'Immaculate Conception'], berch: ['Berchtoldstag', 'St Berchtold\'s Day'], chNat: ['Bundesfeiertag', 'Swiss National Day'],
  bhMay: ['Early May Bank Holiday', 'Early May Bank Holiday'], bhSpring: ['Spring Bank Holiday', 'Spring Bank Holiday'], bhSummer: ['Summer Bank Holiday', 'Summer Bank Holiday'],
  mlk: ['Martin Luther King Jr. Day', 'Martin Luther King Jr. Day'], pres: ['Presidents\' Day', 'Presidents\' Day'], mem: ['Memorial Day', 'Memorial Day'],
  june: ['Juneteenth', 'Juneteenth'], ind: ['Unabhängigkeitstag', 'Independence Day'], labUs: ['Labor Day', 'Labor Day'], vet: ['Veterans Day', 'Veterans Day'],
  thx: ['Thanksgiving', 'Thanksgiving'], clean: ['Kathara Deftera', 'Clean Monday'], grInd: ['Unabhängigkeitstag', 'Independence Day'],
  ochi: ['Ochi-Tag', 'Ochi Day'],
  natDay: ['Nationalfeiertag', 'National Day'], indep: ['Unabhängigkeitstag', 'Independence Day'], liber: ['Tag der Befreiung', 'Liberation Day'],
  rev: ['Revolutionsgedenktag', 'Revolution Day'], state: ['Staatsfeiertag', 'Statehood Day'], const: ['Verfassungstag', 'Constitution Day'],
  armis: ['Waffenstillstand', 'Armistice Day'], bastille: ['Nationalfeiertag (14. Juli)', 'Bastille Day'], king: ['Königstag', "King's Day"],
  europe: ['Europatag', 'Europe Day'], patrick: ['St. Patrick’s Day', "St Patrick's Day"], boyne: ['Schlacht am Boyne', 'Battle of the Boyne'],
  brigid: ['St. Brigid’s Day', "St Brigid's Day"], bhJun: ['June Bank Holiday', 'June Bank Holiday'], bhOct: ['October Bank Holiday', 'October Bank Holiday'],
  bhAug: ['August Bank Holiday', 'August Bank Holiday'], anzac: ['ANZAC Day', 'ANZAC Day'], ausDay: ['Australia Day', 'Australia Day'],
  rep: ['Tag der Republik', 'Republic Day'], unif: ['Vereinigungstag', 'Unification Day'], child: ['Kindertag', "Children's Day"],
  stAndrew: ['Andreastag', "St Andrew's Day"], heroes: ['Heldentag', "Heroes' Day"], africa: ['Afrikatag', 'Africa Day'],
  cassinga: ['Cassinga-Tag', 'Cassinga Day'], humanR: ['Tag der Menschenrechte', 'Human Rights Day'], genocide: ['Gedenktag Völkermord', 'Genocide Remembrance Day'],
  eve: ['Heiligabend', 'Christmas Eve'], nye: ['Silvester', "New Year's Eve"], mt: ['Gründonnerstag', 'Maundy Thursday'], es: ['Ostersonntag', 'Easter Sunday'],
  ws: ['Pfingstsonntag', 'Whit Sunday'], midsum: ['Mittsommerabend', 'Midsummer Eve'], prayer: ['Großer Bettag', 'Great Prayer Day'],
  grat: ['Reformationstag', 'Reformation Day'], culture: ['Kulturtag', 'Culture Day'], uprising: ['Aufstandstag', 'Uprising Day'],
  saints: ['Kyrill und Method', 'Saints Cyril and Methodius'], hus: ['Jan-Hus-Tag', 'Jan Hus Day'], wenceslas: ['Tag der Staatlichkeit', 'Statehood Day'],
  freedom: ['Tag des Kampfes für Freiheit', 'Struggle for Freedom Day'], hispan: ['Fiesta Nacional', 'National Day of Spain'], portDay: ['Portugal-Tag', 'Portugal Day'],
  implant: ['Tag der Republik (5. Oktober)', 'Republic Day (5 Oct)'], restor: ['Wiederherstellung der Unabhängigkeit', 'Restoration of Independence'],
  carnation: ['Tag der Freiheit', 'Freedom Day'], sanpietro: ['Tag der Republik (2. Juni)', 'Republic Day (2 June)'], uprisingSK: ['Slowakischer Nationalaufstand', 'Slovak National Uprising'],
  antifa: ['Antifaschistischer Kampf', 'Anti-Fascist Struggle Day'], victory: ['Tag des Sieges', 'Victory Day'], stStephen: ['Stephanstag (Staatsgründung)', "St Stephen's Day (State Foundation)"],
  dec1: ['Nationalfeiertag (1. Dezember)', 'Great Union Day'], jan24: ['Tag der Vereinigung', 'Union Day'], jun1: ['Kindertag', "Children's Day"],
  nov30: ['Andreastag', "St Andrew's Day"], prekmurje: ['Reformationstag', 'Reformation Day'], primoz: ['Tag des Widerstands', 'Day of Uprising Against Occupation'],
  preseren: ['Prešeren-Tag', 'Prešeren Day'], sloStat: ['Staatsfeiertag', 'Statehood Day'], indSl: ['Tag der Unabhängigkeit und Einheit', 'Independence and Unity Day'],
  stJohn: ['Johannistag', 'St John the Baptist'], orthXmas: ['Orthodoxe Weihnacht', 'Orthodox Christmas'], armistice: ['Waffenstillstandstag', 'Armistice Day'], stVitus: ['Sretenje (Staatsfeiertag)', 'Statehood Day'],
};

Object.assign(HOLIDAY_NAMES, Object.fromEntries(Object.entries(MORE_NAMES).filter(([k]) => !HOLIDAY_NAMES[k])));

// ---------- rule calendars (shared/holidayRules.js) ----------
const LUNAR = { I: 'islamic-umalqura', C: 'chinese', P: 'persian', H: 'hebrew', T: 'ethiopic' };
const calFmts = new Map();
// The platform's own calendar (Intl); null where the runtime has none – those holidays are then left out.
function calFmt(cal) {
  if (!calFmts.has(cal)) {
    let f = null;
    try {
      f = new Intl.DateTimeFormat(`en-u-ca-${cal}`, { timeZone: 'UTC', month: cal === 'hebrew' ? 'long' : 'numeric', day: 'numeric' });
      if (f.resolvedOptions().calendar !== cal) f = null;
    } catch { f = null; }
    calFmts.set(cal, f);
  }
  return calFmts.get(cal);
}
const calYears = new Map();
// 'month-day' of that calendar → the day indices in one Gregorian year (a lunar day can occur twice in one year)
function calDays(cal, y) {
  const k = `${cal}:${y}`;
  if (calYears.has(k)) return calYears.get(k);
  const m = new Map(), f = calFmt(cal);
  if (f) {
    for (let d = ymdIdx(y, 1, 1), end = ymdIdx(y + 1, 1, 1); d < end; d++) {
      let mo = '', da = '';
      for (const p of f.formatToParts(new Date(d * 864e5))) { if (p.type === 'month') mo = p.value; else if (p.type === 'day') da = p.value; }
      const key = `${mo}-${da}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(d);
    }
  }
  calYears.set(k, m);
  return m;
}
const TOKEN = /^(\w+)@([^,*!<>%]+)(?:,([+-]?\d+))?(?:\*(\d+))?(?:!([mnu]))?(?:>(\d{4}))?(?:<(\d{4}))?(?:%(\d+))?$/;
const parsedRules = new Map();
export function rulesOf(code) {
  if (!parsedRules.has(code)) {
    parsedRules.set(code, String(RULES[code] || '').trim().split(/\s+/).filter(Boolean).map((t) => {
      const m = TOKEN.exec(t);
      if (!m) throw new Error(`holiday rule ${code}: ${t}`);
      return { name: m[1], when: m[2], off: +m[3] || 0, span: +m[4] || 1, sub: m[5] || null, from: +m[6] || 0, until: +m[7] || 0, every: +m[8] || 0 };
    }));
  }
  return parsedRules.get(code);
}
function baseDays(when, y, E, O) {
  let m;
  if ((m = /^(\d{1,2})-(\d{1,2})$/.exec(when))) return [ymdIdx(y, +m[1], +m[2])];
  if ((m = /^(\d{1,2})-(\d{1,2})~(\d)$/.exec(when))) { const d = ymdIdx(y, +m[1], +m[2]); return [d + ((+m[3] - dow(d) + 7) % 7)]; }
  if ((m = /^([EO])([+-]\d+)?$/.exec(when))) return [(m[1] === 'E' ? E : O) + (+m[2] || 0)];
  if ((m = /^(\d{1,2})\.(\d)\.(-?\d)$/.exec(when))) return [nthWeekday(y, +m[1], +m[2], +m[3])];
  if ((m = /^([ICPHT]):([A-Za-z ]+|\d{1,2})-(\d{1,2})$/.exec(when))) return calDays(LUNAR[m[1]], y).get(`${m[2]}-${m[3]}`) || [];
  const t = y - 1980, c = y % 100;
  if (when === 'VE') return [ymdIdx(y, 3, Math.floor(20.8431 + 0.242194 * t - Math.floor(t / 4)))]; // Japan, 1980–2099
  if (when === 'AE') return [ymdIdx(y, 9, Math.floor(23.2488 + 0.242194 * t - Math.floor(t / 4)))];
  if (when === 'QM') return [ymdIdx(y, 4, Math.floor(c * 0.2422 + 4.81) - Math.floor(c / 4))]; // 2001–2099
  if ((m = /^Y:(.+)$/.exec(when))) return m[1].split('/').filter((x) => x.startsWith(`${y}-`)).map((x) => ymdIdx(y, +x.slice(5, 7), +x.slice(8, 10)));
  throw new Error(`holiday rule: ${when}`);
}
// The holidays of one rule calendar in year y (days spilling over from the year before included), then the
// substitute days, in date order, each on the next day that is free.
function ruleDays(code, y, add) {
  const entries = [];
  for (const yy of [y - 1, y]) {
    const E = easter(yy), O = orthodoxEaster(yy);
    for (const r of rulesOf(code)) {
      if ((r.from && yy < r.from) || (r.until && yy >= r.until) || (r.every && yy % r.every)) continue;
      for (const b of baseDays(r.when, yy, E, O)) for (let i = 0; i < r.span; i++) entries.push([b + r.off + i, r.name, r.sub]);
    }
  }
  entries.sort((a, b) => a[0] - b[0]);
  const taken = new Set(entries.map((e) => e[0]));
  const extra = [];
  for (const [d, n, sub] of entries) {
    if (!sub) continue;
    const w = dow(d);
    let to = null;
    if (sub === 'u') to = w === 6 ? d - 1 : w === 0 ? d + 1 : null;
    else if ((sub === 'm' && w === 0) || (sub === 'n' && (w === 0 || w === 6))) { to = d + 1; while (taken.has(to) || dow(to) === 0 || dow(to) === 6) to++; }
    if (to != null && !taken.has(to)) { taken.add(to); extra.push([to, n]); }
  }
  // Japan: a weekday between two holidays is a holiday too (Citizens' Holiday)
  if (code === 'JP') for (const [d] of entries) if (taken.has(d + 2) && !taken.has(d + 1) && dow(d + 1) !== 0 && dow(d + 1) !== 6) { taken.add(d + 1); extra.push([d + 1, 'citizens']); }
  const a = ymdIdx(y, 1, 1), b = ymdIdx(y + 1, 1, 1);
  for (const [d, n] of [...entries, ...extra]) if (d >= a && d < b) add(n, d);
}

const cache = new Map();
const named = new Map(); // `${location}:${year}` → Map(dayIdx → name key)
function compute(location, year) {
  const key = `${location}:${year}`;
  if (cache.has(key)) return key;
  const y = year, E = easter(y), set = new Set(), names = new Map();
  const add = (n, d) => { set.add(d); if (!names.has(d)) names.set(d, n); };
  const loc = location || 'NONE';
  if (loc === 'DE' || loc.startsWith('DE-')) {
    add('ny', ymdIdx(y, 1, 1)); add('gf', E - 2); add('em', E + 1); add('lab', ymdIdx(y, 5, 1)); add('asc', E + 39); add('wm', E + 50);
    add('unity', ymdIdx(y, 10, 3)); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
    const s = loc.slice(3);
    if (['BW', 'BY', 'ST'].includes(s)) add('epi', ymdIdx(y, 1, 6));
    if (['BE', 'MV'].includes(s)) add('wom', ymdIdx(y, 3, 8));
    if (['BW', 'BY', 'HE', 'NW', 'RP', 'SL'].includes(s)) add('cc', E + 60);
    if (s === 'SL') add('ass', ymdIdx(y, 8, 15));
    if (s === 'TH') add('kid', ymdIdx(y, 9, 20));
    if (['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'].includes(s)) add('ref', ymdIdx(y, 10, 31));
    if (['BW', 'BY', 'NW', 'RP', 'SL'].includes(s)) add('all', ymdIdx(y, 11, 1));
    if (s === 'SN') { const n22 = ymdIdx(y, 11, 22); add('bnt', n22 - ((dow(n22) - 3 + 7) % 7)); }
  } else if (loc === 'AT') {
    add('ny', ymdIdx(y, 1, 1)); add('epi', ymdIdx(y, 1, 6)); add('em', E + 1); add('lab', ymdIdx(y, 5, 1)); add('asc', E + 39); add('wm', E + 50);
    add('cc', E + 60); add('ass', ymdIdx(y, 8, 15)); add('atNat', ymdIdx(y, 10, 26)); add('all', ymdIdx(y, 11, 1)); add('imm', ymdIdx(y, 12, 8));
    add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'CH') {
    // only days every canton keeps (Berchtold, Good Friday, Easter/Whit Monday, St Stephen are cantonal)
    add('ny', ymdIdx(y, 1, 1)); add('asc', E + 39); add('chNat', ymdIdx(y, 8, 1)); add('xmas', ymdIdx(y, 12, 25));
  } else if (loc === 'GB') {
    add('ny', ymdIdx(y, 1, 1)); add('gf', E - 2); add('em', E + 1); add('bhMay', nthWeekday(y, 5, 1, 1)); add('bhSpring', nthWeekday(y, 5, 1, -1));
    add('bhSummer', nthWeekday(y, 8, 1, -1)); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'US') {
    add('ny', ymdIdx(y, 1, 1)); add('mlk', nthWeekday(y, 1, 1, 3)); add('pres', nthWeekday(y, 2, 1, 3)); add('mem', nthWeekday(y, 5, 1, -1));
    add('june', ymdIdx(y, 6, 19)); add('ind', ymdIdx(y, 7, 4)); add('labUs', nthWeekday(y, 9, 1, 1)); add('vet', ymdIdx(y, 11, 11));
    add('thx', nthWeekday(y, 11, 4, 4)); add('xmas', ymdIdx(y, 12, 25));
  } else if (loc === 'GR') {
    const O = orthodoxEaster(y);
    add('ny', ymdIdx(y, 1, 1)); add('epi', ymdIdx(y, 1, 6)); add('clean', O - 48); add('grInd', ymdIdx(y, 3, 25)); add('gf', O - 2); add('em', O + 1);
    add('lab', ymdIdx(y, 5, 1)); add('wm', O + 50); add('ass', ymdIdx(y, 8, 15)); add('ochi', ymdIdx(y, 10, 28)); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'HU') {
    add('ny', ymdIdx(y, 1, 1)); add('rev', ymdIdx(y, 3, 15)); add('gf', E - 2); add('em', E + 1); add('lab', ymdIdx(y, 5, 1)); add('wm', E + 50);
    add('stStephen', ymdIdx(y, 8, 20)); add('uprising', ymdIdx(y, 10, 23)); add('all', ymdIdx(y, 11, 1)); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'CZ') {
    add('ny', ymdIdx(y, 1, 1)); add('gf', E - 2); add('em', E + 1); add('lab', ymdIdx(y, 5, 1)); add('liber', ymdIdx(y, 5, 8)); add('saints', ymdIdx(y, 7, 5));
    add('hus', ymdIdx(y, 7, 6)); add('wenceslas', ymdIdx(y, 9, 28)); add('indep', ymdIdx(y, 10, 28)); add('freedom', ymdIdx(y, 11, 17));
    add('eve', ymdIdx(y, 12, 24)); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'SK') {
    add('ny', ymdIdx(y, 1, 1)); add('epi', ymdIdx(y, 1, 6)); add('gf', E - 2); add('em', E + 1); add('lab', ymdIdx(y, 5, 1)); add('liber', ymdIdx(y, 5, 8));
    add('saints', ymdIdx(y, 7, 5)); add('uprisingSK', ymdIdx(y, 8, 29)); add('ass', ymdIdx(y, 9, 15)); add('all', ymdIdx(y, 11, 1));
    add('eve', ymdIdx(y, 12, 24)); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'PL') {
    add('ny', ymdIdx(y, 1, 1)); add('epi', ymdIdx(y, 1, 6)); add('em', E + 1); add('lab', ymdIdx(y, 5, 1)); add('const', ymdIdx(y, 5, 3)); add('cc', E + 60);
    add('ass', ymdIdx(y, 8, 15)); add('all', ymdIdx(y, 11, 1)); add('indep', ymdIdx(y, 11, 11)); if (y >= 2025) add('eve', ymdIdx(y, 12, 24));
    add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'RO') {
    const O = orthodoxEaster(y);
    add('ny', ymdIdx(y, 1, 1)); add('ny', ymdIdx(y, 1, 2)); if (y >= 2024) { add('epi', ymdIdx(y, 1, 6)); add('stJohn', ymdIdx(y, 1, 7)); } add('jan24', ymdIdx(y, 1, 24));
    add('gf', O - 2); add('em', O + 1); add('lab', ymdIdx(y, 5, 1)); add('jun1', ymdIdx(y, 6, 1)); add('wm', O + 50); add('ass', ymdIdx(y, 8, 15));
    add('nov30', ymdIdx(y, 11, 30)); add('dec1', ymdIdx(y, 12, 1)); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'HR') {
    add('ny', ymdIdx(y, 1, 1)); add('epi', ymdIdx(y, 1, 6)); add('em', E + 1); add('lab', ymdIdx(y, 5, 1)); add('state', ymdIdx(y, 5, 30)); add('cc', E + 60);
    add('antifa', ymdIdx(y, 6, 22)); add('victory', ymdIdx(y, 8, 5)); add('ass', ymdIdx(y, 8, 15)); add('all', ymdIdx(y, 11, 1)); add('rep', ymdIdx(y, 11, 18));
    add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'SI') {
    add('ny', ymdIdx(y, 1, 1)); add('ny', ymdIdx(y, 1, 2)); add('preseren', ymdIdx(y, 2, 8)); add('em', E + 1); add('primoz', ymdIdx(y, 4, 27));
    add('lab', ymdIdx(y, 5, 1)); add('lab', ymdIdx(y, 5, 2)); add('sloStat', ymdIdx(y, 6, 25)); add('ass', ymdIdx(y, 8, 15)); add('grat', ymdIdx(y, 10, 31));
    add('all', ymdIdx(y, 11, 1)); add('xmas', ymdIdx(y, 12, 25)); add('indSl', ymdIdx(y, 12, 26));
  } else if (loc === 'RS') {
    const O = orthodoxEaster(y);
    add('ny', ymdIdx(y, 1, 1)); add('ny', ymdIdx(y, 1, 2)); add('orthXmas', ymdIdx(y, 1, 7)); add('stVitus', ymdIdx(y, 2, 15)); add('stVitus', ymdIdx(y, 2, 16));
    add('gf', O - 2); add('em', O + 1); add('lab', ymdIdx(y, 5, 1)); add('lab', ymdIdx(y, 5, 2)); add('armistice', ymdIdx(y, 11, 11));
  } else if (loc === 'NL') {
    const kd = ymdIdx(y, 4, 27);
    add('ny', ymdIdx(y, 1, 1)); add('em', E + 1); add('king', dow(kd) === 0 ? kd - 1 : kd); if (y % 5 === 0) add('liber', ymdIdx(y, 5, 5));
    add('asc', E + 39); add('wm', E + 50); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'BE') {
    add('ny', ymdIdx(y, 1, 1)); add('em', E + 1); add('lab', ymdIdx(y, 5, 1)); add('asc', E + 39); add('wm', E + 50); add('natDay', ymdIdx(y, 7, 21));
    add('ass', ymdIdx(y, 8, 15)); add('all', ymdIdx(y, 11, 1)); add('armis', ymdIdx(y, 11, 11)); add('xmas', ymdIdx(y, 12, 25));
  } else if (loc === 'LU') {
    add('ny', ymdIdx(y, 1, 1)); add('em', E + 1); add('lab', ymdIdx(y, 5, 1)); if (y >= 2019) add('europe', ymdIdx(y, 5, 9)); add('asc', E + 39); add('wm', E + 50);
    add('natDay', ymdIdx(y, 6, 23)); add('ass', ymdIdx(y, 8, 15)); add('all', ymdIdx(y, 11, 1)); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'FR') {
    add('ny', ymdIdx(y, 1, 1)); add('em', E + 1); add('lab', ymdIdx(y, 5, 1)); add('victory', ymdIdx(y, 5, 8)); add('asc', E + 39); add('wm', E + 50);
    add('bastille', ymdIdx(y, 7, 14)); add('ass', ymdIdx(y, 8, 15)); add('all', ymdIdx(y, 11, 1)); add('armis', ymdIdx(y, 11, 11)); add('xmas', ymdIdx(y, 12, 25));
  } else if (loc === 'ES') {
    add('ny', ymdIdx(y, 1, 1)); add('epi', ymdIdx(y, 1, 6)); add('gf', E - 2); add('lab', ymdIdx(y, 5, 1)); add('ass', ymdIdx(y, 8, 15));
    add('hispan', ymdIdx(y, 10, 12)); add('all', ymdIdx(y, 11, 1)); add('const', ymdIdx(y, 12, 6)); add('imm', ymdIdx(y, 12, 8)); add('xmas', ymdIdx(y, 12, 25));
  } else if (loc === 'PT') {
    add('ny', ymdIdx(y, 1, 1)); add('gf', E - 2); add('carnation', ymdIdx(y, 4, 25)); add('lab', ymdIdx(y, 5, 1)); add('cc', E + 60); add('portDay', ymdIdx(y, 6, 10));
    add('ass', ymdIdx(y, 8, 15)); add('implant', ymdIdx(y, 10, 5)); add('all', ymdIdx(y, 11, 1)); add('restor', ymdIdx(y, 12, 1)); add('imm', ymdIdx(y, 12, 8)); add('xmas', ymdIdx(y, 12, 25));
  } else if (loc === 'IT') {
    add('ny', ymdIdx(y, 1, 1)); add('epi', ymdIdx(y, 1, 6)); add('em', E + 1); add('liber', ymdIdx(y, 4, 25)); add('lab', ymdIdx(y, 5, 1)); add('sanpietro', ymdIdx(y, 6, 2));
    add('ass', ymdIdx(y, 8, 15)); add('all', ymdIdx(y, 11, 1)); add('imm', ymdIdx(y, 12, 8)); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'DK') {
    add('ny', ymdIdx(y, 1, 1)); add('mt', E - 3); add('gf', E - 2); add('em', E + 1); add('asc', E + 39); add('wm', E + 50); add('const', ymdIdx(y, 6, 5));
    add('eve', ymdIdx(y, 12, 24)); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'SE') {
    const mid = ymdIdx(y, 6, 19); const midEve = mid + ((5 - dow(mid) + 7) % 7); // Friday between 19 and 25 June
    add('ny', ymdIdx(y, 1, 1)); add('epi', ymdIdx(y, 1, 6)); add('gf', E - 2); add('em', E + 1); add('lab', ymdIdx(y, 5, 1)); add('asc', E + 39);
    add('natDay', ymdIdx(y, 6, 6)); add('midsum', midEve); add('eve', ymdIdx(y, 12, 24)); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26)); add('nye', ymdIdx(y, 12, 31));
  } else if (loc === 'NO') {
    add('ny', ymdIdx(y, 1, 1)); add('mt', E - 3); add('gf', E - 2); add('em', E + 1); add('lab', ymdIdx(y, 5, 1)); add('const', ymdIdx(y, 5, 17)); add('asc', E + 39);
    add('wm', E + 50); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'IE') {
    const f1 = ymdIdx(y, 2, 1);
    add('ny', ymdIdx(y, 1, 1)); if (y >= 2023) add('brigid', dow(f1) === 5 ? f1 : nthWeekday(y, 2, 1, 1)); add('patrick', ymdIdx(y, 3, 17)); add('em', E + 1);
    add('bhMay', nthWeekday(y, 5, 1, 1)); add('bhJun', nthWeekday(y, 6, 1, 1)); add('bhAug', nthWeekday(y, 8, 1, 1)); add('bhOct', nthWeekday(y, 10, 1, -1));
    add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'GB-NIR') {
    add('ny', ymdIdx(y, 1, 1)); add('patrick', ymdIdx(y, 3, 17)); add('gf', E - 2); add('em', E + 1); add('bhMay', nthWeekday(y, 5, 1, 1)); add('bhSpring', nthWeekday(y, 5, 1, -1));
    add('boyne', ymdIdx(y, 7, 12)); add('bhSummer', nthWeekday(y, 8, 1, -1)); add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'AU') {
    add('ny', ymdIdx(y, 1, 1)); add('ausDay', ymdIdx(y, 1, 26)); add('gf', E - 2); add('em', E + 1); add('anzac', ymdIdx(y, 4, 25));
    add('xmas', ymdIdx(y, 12, 25)); add('box', ymdIdx(y, 12, 26));
  } else if (loc === 'NA') {
    // Namibia: a public holiday on a Sunday is also off on the Monday after
    const na = (n, d) => { add(n, d); if (dow(d) === 0) add(n, d + 1); };
    na('ny', ymdIdx(y, 1, 1)); na('indep', ymdIdx(y, 3, 21)); add('gf', E - 2); add('em', E + 1); na('lab', ymdIdx(y, 5, 1)); na('cassinga', ymdIdx(y, 5, 4));
    add('asc', E + 39); na('africa', ymdIdx(y, 5, 25)); if (y >= 2025) na('genocide', ymdIdx(y, 5, 28)); na('heroes', ymdIdx(y, 8, 26)); na('humanR', ymdIdx(y, 12, 10));
    na('xmas', ymdIdx(y, 12, 25)); na('box', ymdIdx(y, 12, 26));
  }
  else if (Object.hasOwn(RULES, loc)) ruleDays(loc, y, add);
  cache.set(key, set);
  named.set(key, names);
  return key;
}
export function holidaysFor(location, year) {
  return cache.get(compute(location, year));
}
// The name key of a public holiday of a calendar (see HOLIDAY_NAMES), or null.
export function holidayName(location, idx) {
  const y = new Date(idx * 86400000).getUTCFullYear();
  return named.get(compute(location, y)).get(idx) || null;
}

// Holidays of a location within [a, b] (day indices) as one Set.
export function holidaysBetween(location, a, b) {
  const out = new Set();
  const y0 = new Date(a * 86400000).getUTCFullYear(), y1 = new Date(b * 86400000).getUTCFullYear();
  for (let y = y0; y <= y1; y++) for (const d of holidaysFor(location, y)) if (d >= a && d <= b) out.add(d);
  return out;
}
