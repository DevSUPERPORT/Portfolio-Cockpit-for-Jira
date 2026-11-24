// Insights: "how do we allocate people so the plan reflects reality – without overtime and in rank order?"
//
// Pure and deterministic (no AI, no clock unless `today` is left out, no randomness). Every number can be
// recomputed by hand from the inputs; tests/insights.test.js does exactly that.
//
//   realisticCapacity(computed, { weeks, history, planActual, lang })
//       nominal hours (engine) − support reality (P80 of the weekly support hours) = realistic room for projects;
//       planned project load × the team's estimate factor (Time Spent ÷ Original Estimate of done stories);
//       overtime risk per week, and which ranked projects fit without overtime (waterline on the realistic room).
//   similarWork(target, pool, { limit, lang })
//       done stories with a similar summary (TF-IDF cosine + team/type/component/label bonus) and what they took.
//   supportTopics(tickets, { minCount, lang, today })
//       recurring support topics (summary token signature, request type/component/label) → playbook candidates.
//   overtimeOutlook(rcOrComputed, { weeks, lang })
//       who is above 100 % realistic load in the next N weeks, by how much, and the lowest-ranked work causing it.
//
// Input shapes (history rows come from src/lib/history.js or static/cockpit/src/lib/mockHistory.js):
//   story row:   { id, key, summary, type, projectKey, components[], labels[], team:{id,name}|null, assignee:id|null,
//                  oe (h), ts (h), created, start, resolved ('YYYY-MM-DD'), parentId, parentKey, parentSummary,
//                  statusCat:'done', commentCount? }
//   support row: { id, key, summary, requestType, components[], labels[], team:{id,name}|null, assignee:id|null,
//                  spentH, created, resolved, statusCat, worklogs?: [{ d:'YYYY-MM-DD', h, a:id|null }] }
//   Open/recent tickets of the dataset (ds.supportTickets.tickets) have the same fields and can be mixed in.
import { dayIdx, isoOf, mondayOf, nextWorkday, weeksFrom, workdays, todayIdx } from './dates.js';
import { weeksUtilizationShared, capacityPeople, personCapacityIn, spreadWindow, shareIn, teamSettings } from './engine.js';

const EPS = 0.01;
const r1 = (n) => Math.round((n || 0) * 10) / 10;
const r2 = (n) => Math.round((n || 0) * 100) / 100;
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat) !== 'done';
const idOf = (u) => (u == null ? null : typeof u === 'object' ? u.id ?? null : String(u));

// ---------- statistics ----------
export function median(xs) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Nearest-rank percentile: the smallest value with at least p of the values at or below it (P80 of 10 weeks =
// the 8th smallest). Always a value that actually occurred – easy to point at in the data.
export function percentile(xs, p) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}
// Mean without the extremes: from 5 values on, the lowest and highest 10 % (at least one each) are dropped.
export function trimmedMean(xs, trim = 0.1) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return { mean: null, n: 0, trimmed: 0 };
  const k = s.length >= 5 ? Math.max(1, Math.floor(s.length * trim)) : 0;
  const kept = s.slice(k, s.length - k);
  return { mean: sum(kept) / kept.length, n: s.length, trimmed: 2 * k };
}
export const confidenceOf = (n, [mid, high]) => (n >= high ? 'high' : n >= mid ? 'medium' : 'low');
const CONF_RANK = { none: 0, low: 1, medium: 2, high: 3 };
const minConf = (...c) => c.reduce((a, x) => (CONF_RANK[x] < CONF_RANK[a] ? x : a), 'high');

// ---------- wording ----------
const fmtNum = (n, d, lang) => {
  const s = (Math.round(n * 10 ** d) / 10 ** d).toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return lang === 'de' ? s.replace('.', ',') : s;
};
// Hours: whole hours from 10 h on, one decimal below (0,5 h), never "-0".
export const fmtH = (h, lang = 'de') => `${fmtNum(Math.abs(h) >= 10 ? Math.round(h) : h, Math.abs(h) >= 10 ? 0 : 1, lang)} h`;
const fmtF = (f, lang) => fmtNum(f, 2, lang);
const fmtPct = (x) => `${Math.round(x * 100)} %`;
const T = (lang, de, en) => (lang === 'de' ? de : en);
const rankLabel = (p, lang) => (p.rank != null ? T(lang, `Rang ${p.rank}`, `Rank ${p.rank}`) : T(lang, 'Ohne Rang', 'Unranked'));

// ---------- text ----------
const STOP_RAW = `ab der die das den dem des ein eine einer eines einem einen und oder aber nicht kein keine keinen ist sind war waren wird werden
wurde wurden sein bei beim im in ins am an auf aus mit von vom zu zum zur fuer ueber unter nach vor bis durch ohne gegen als auch noch nur so wie
was wer wo wenn dass ob es er sie wir ihr ich du man sich mehr neu neue neuer neues neuen bitte kann koennen muss soll sollte sowie bzw etc ca
alle allen alles jetzt mal schon sehr hier dort diese dieser dieses diesem diesen the an and or but not no is are was were be been being to of
on at for with from by as into via this that these those it its we you they our your new add adds update please can could should must will would
all any some per be do does did has have had if than then there what when where which who why how`;
const STOP = new Set(STOP_RAW.split(/\s+/).filter(Boolean));
// a few synonyms that mix in German/English tickets
const SYN = { kennwort: 'passwort', password: 'passwort', pwd: 'passwort', passwoert: 'passwort', error: 'fehler', login: 'anmeldung', logon: 'anmeldung', signin: 'anmeldung', mail: 'email' };
// Conservative suffix stripping (DE/EN plurals and inflections), only for words of 6+ letters.
export function stem(t) {
  if (t.length < 6) return t;
  if (t.endsWith('ungen')) return t.slice(0, -2);
  if (t.endsWith('ing')) return t.slice(0, -3);
  if (t.endsWith('en') || t.endsWith('es') || t.endsWith('ed')) return t.slice(0, -2);
  if (t.endsWith('e')) return t.slice(0, -1);
  if (t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}
const fold = (w) => w.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '');
// Words with their normalised token: lower case, umlauts folded (ä → ae), split at anything not a letter/digit,
// no stop words, no pure numbers, stemmed, synonyms merged. `w` keeps the original spelling for topic names.
// Memoized per text (summaries are tokenized again by every topic, similarity and claim check): the cached list is
// frozen, callers get a copy they may change. Bounded – cleared when it grows past 200k texts.
const wordsCache = new Map();
export function words(text) {
  return cachedWords(text).slice();
}
function wordsOf(text) {
  const out = [];
  for (const w of String(text || '').split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    const f = fold(w).replace(/[^a-z0-9]/g, '');
    if (f.length < 2 || /^\d+$/.test(f) || STOP.has(f)) continue;
    const s = stem(f);
    const t = SYN[s] || SYN[f] || s;
    if (STOP.has(t)) continue;
    out.push(Object.freeze({ t, w }));
  }
  return out;
}
const cachedWords = (text) => {
  const key = String(text || '');
  let hit = wordsCache.get(key);
  if (!hit) {
    hit = Object.freeze(wordsOf(key));
    if (wordsCache.size > 200000) wordsCache.clear();
    wordsCache.set(key, hit);
  }
  return hit;
};
export const tokens = (text) => cachedWords(text).map((x) => x.t);

// TF-IDF vectors over a corpus of weighted text parts. idf = ln((N + 1) / (df + 1)) + 1.
function tfidf(docs) {
  const df = new Map();
  const tfs = docs.map((parts) => {
    const tf = new Map();
    for (const [text, w] of parts) for (const t of tokens(text)) tf.set(t, (tf.get(t) || 0) + w);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return tf;
  });
  const N = docs.length;
  return tfs.map((tf) => {
    const v = new Map();
    let norm = 0;
    for (const [t, x] of tf) { const y = x * (Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1); v.set(t, y); norm += y * y; }
    return { v, norm: Math.sqrt(norm) };
  });
}
function cosine(a, b) {
  if (!a.norm || !b.norm) return 0;
  let dot = 0;
  const [s, l] = a.v.size <= b.v.size ? [a.v, b.v] : [b.v, a.v];
  for (const [t, x] of s) { const y = l.get(t); if (y) dot += x * y; }
  return dot / (a.norm * b.norm);
}

// =====================================================================================================
// a) realistic capacity
// =====================================================================================================
export const SUPPORT_P = 0.8;
export const FACTOR_MIN_N = 5; // stories needed for a team's own estimate factor
export const SUPPORT_SPREAD_WEEKS = 4; // a ticket without worklogs: its time spread over up to 4 weeks before resolution

// Weekly support hours per team and per person, from three sources (newest first):
//  - the last 8 full weeks: the measured worklogs of all support tickets (computed.support.teams[].trend, open ones too)
//  - earlier weeks: the resolved tickets of the history (their worklogs, otherwise Time Spent spread evenly over the
//    weeks from creation – at most 4 – to resolution)
//  - nothing measured at all: the plan-vs-actual average of booked support hours (SUP bucket), if stored.
// Weeks without a single hour count as 0 h – that is reality too.
export function supportWeekly({ model, support, history, planActual }) {
  const today = model.today;
  const curMon = mondayOf(today), lastMon = curMon - 7;
  const trendFirst = curMon - 56;
  const trendTeams = (support?.auto?.teams || support?.teams || []).filter((t) => Array.isArray(t.trend) && t.trend.length === 8);
  const hasTrend = !!support && Array.isArray(support.auto?.teams || support.teams);
  const trend = new Map(trendTeams.map((t) => [t.teamId, t.trend]));
  const hist = new Map(), histP = new Map();
  const add = (map, k, m, h) => { if (k == null || !h) return; const x = map.get(k) || map.set(k, new Map()).get(k); x.set(m, (x.get(m) || 0) + h); };
  const rows = Array.isArray(history?.support) ? history.support : null;
  let histFirst = history?.supportSince ? mondayOf(dayIdx(history.supportSince)) : null;
  if (rows) {
    for (const t of rows) {
      const team = t.team?.id || '_none';
      if (Array.isArray(t.worklogs) && t.worklogs.length) {
        for (const wl of t.worklogs) {
          const d = dayIdx(wl.d);
          if (d == null || !(wl.h > 0)) continue;
          const m = mondayOf(d);
          if (m > lastMon) continue;
          add(hist, team, m, wl.h); add(histP, idOf(wl.a), m, wl.h);
          if (!history?.supportSince && (histFirst == null || m < histFirst)) histFirst = m;
        }
        continue;
      }
      const h = +(t.spentH ?? t.ts ?? 0);
      const r = dayIdx(t.resolved), c = dayIdx(t.created) ?? r;
      if (!(h > 0) || r == null) continue;
      const first = mondayOf(Math.max(c, r - (SUPPORT_SPREAD_WEEKS - 1) * 7)), last = mondayOf(r);
      const n = (last - first) / 7 + 1;
      for (let m = first; m <= last; m += 7) {
        if (m > lastMon) continue;
        add(hist, team, m, h / n); add(histP, idOf(t.assignee), m, h / n);
      }
      if (!history?.supportSince && (histFirst == null || first < histFirst)) histFirst = first;
    }
  }
  const hasHist = !!rows && histFirst != null && histFirst <= lastMon;
  const from = Math.min(hasTrend ? trendFirst : Infinity, hasHist ? histFirst : Infinity);
  const teamIds = new Set([...trend.keys(), ...hist.keys(), ...model.teams.keys()]);
  const teams = new Map();
  for (const id of teamIds) {
    const series = [];
    if (Number.isFinite(from)) {
      for (let m = from; m <= lastMon; m += 7) {
        if (hasTrend && m >= trendFirst) series.push({ week: isoOf(m), h: trend.get(id)?.[(m - trendFirst) / 7] || 0, src: 'worklogs' });
        else if (hasHist && m >= histFirst) series.push({ week: isoOf(m), h: hist.get(id)?.get(m) || 0, src: 'history' });
      }
    }
    teams.set(id, statsOf(series));
  }
  // plan vs. actual: booked support hours (SUP) ÷ weeks, per team and per visible person
  const pa = planActualSupport(planActual);
  for (const [id, avg] of pa.teams) {
    const t = teams.get(id);
    if (t && t.weeks === 0) teams.set(id, { ...t, median: avg, p80: avg, mean: avg, source: 'planActual' });
    if (teams.get(id)) teams.get(id).planActualAvg = avg;
  }
  const people = new Map();
  if (hasHist) {
    for (const [pid, wk] of histP) {
      const series = [];
      for (let m = histFirst; m <= lastMon; m += 7) series.push({ week: isoOf(m), h: wk.get(m) || 0, src: 'history' });
      people.set(pid, statsOf(series));
    }
  }
  return { teams, people, personAvg: support?.personWeekly || {}, planActualPeople: pa.people, sources: { worklogs: hasTrend, history: hasHist, planActual: pa.weeks > 0 }, from: Number.isFinite(from) ? isoOf(from) : null, to: isoOf(lastMon) };
}
function statsOf(series) {
  const hs = series.map((x) => x.h);
  const srcs = new Set(series.map((x) => x.src));
  return {
    weeks: series.length, median: median(hs) ?? 0, p80: percentile(hs, SUPPORT_P) ?? 0, mean: hs.length ? sum(hs) / hs.length : 0,
    source: !series.length ? 'none' : srcs.size > 1 ? 'worklogs+history' : [...srcs][0], series: series.map((x) => ({ ...x, h: r1(x.h) })),
  };
}
function planActualSupport(pa) {
  const teams = new Map(), people = new Map();
  const n = pa?.state === 'ready' ? (pa.weeks || []).length : 0;
  if (!n) return { teams, people, weeks: 0 };
  for (const u of pa.units || []) {
    const h = +(u.book?.SUP || 0);
    teams.set(u.teamId, (teams.get(u.teamId) || 0) + h / n);
    if (u.kind === 'person') people.set(u.id, h / n);
  }
  return { teams, people, weeks: n };
}

// Time Spent ÷ Original Estimate of done stories (story totals incl. sub-tasks), trimmed mean per team.
// Stories without an estimate or without booked time say nothing about accuracy and are left out.
// Once per model and history object (realistic capacity in both languages, with and without plan vs. actual, asks the
// same question); the result is shared – read it only.
const factorsMemo = new WeakMap();
export function estimateFactors({ model, history }) {
  if (!model || typeof model !== 'object') return estimateFactorsOf({ model, history });
  const m = factorsMemo.get(model) || factorsMemo.set(model, new Map()).get(model);
  const k = history ?? null;
  if (!m.has(k)) m.set(k, estimateFactorsOf({ model, history }));
  return m.get(k);
}
function estimateFactorsOf({ model, history }) {
  const seen = new Set(), samples = [];
  const take = (s) => {
    const k = s.id ?? s.key;
    if (k == null || seen.has(k)) return;
    seen.add(k);
    if (s.role && s.role !== 'estimate') return;
    if ((s.statusCat ?? s.status?.cat) !== 'done' && !s.resolved) return;
    if (!(s.oe > 0) || !(s.ts > 0)) return;
    samples.push({ team: s.team?.id || null, ratio: s.ts / s.oe, oe: s.oe, ts: s.ts, key: s.key });
  };
  for (const s of history?.stories || []) take(s);
  for (const s of model.ds.issues || []) if (s.role === 'estimate') take(s);
  const all = trimmedMean(samples.map((x) => x.ratio));
  const byTeam = new Map();
  for (const x of samples) if (x.team) (byTeam.get(x.team) || byTeam.set(x.team, []).get(x.team)).push(x.ratio);
  // per team once (realistic capacity asks it for every team and every person)
  const factors = new Map();
  const factorFor = (teamId) => factors.get(teamId) || factors.set(teamId, factorOf(teamId)).get(teamId);
  const factorOf = (teamId) => {
    const own = trimmedMean(byTeam.get(teamId) || []);
    if (own.n >= FACTOR_MIN_N) return { factor: own.mean, n: own.n, trimmed: own.trimmed, source: 'team', confidence: confidenceOf(own.n, [8, 20]) };
    if (all.n >= FACTOR_MIN_N) return { factor: all.mean, n: all.n, trimmed: all.trimmed, teamN: own.n, source: 'all', confidence: 'low' };
    return { factor: 1, n: all.n, trimmed: 0, teamN: own.n, source: 'none', confidence: 'none' };
  };
  return { all: { factor: all.n ? all.mean : null, n: all.n, trimmed: all.trimmed }, factorFor, samples: samples.length };
}

// ---------- realistic capacity: one result per data state ----------
// The same data state (computed result, weeks, history, plan vs. actual) gives the same numbers in every language – only
// the sentences differ. So a result is kept per computed object, and the other language is made from it by writing the
// sentences again (relangCapacity: exactly what a fresh computation gives). The parts that do not depend on history or
// language (the engine's weekly availability, the open work spread over the weeks, each person's weekly availability, the
// estimate factors) are kept per model. Results are shared – read them only.
const RC_ROOM = new WeakMap(); // team / person entry → its unrounded realistic room (the fit sentences use it)
const rcMemo = new WeakMap(); // computed → [{ n, history, planActual, model, support, lang, rc }]
const weeksOfN = (weeks) => Math.max(1, Math.min(26, Math.round(+weeks || 12)));
export function realisticCapacity(computed, { weeks = 12, history = null, planActual = null, lang = 'de' } = {}) {
  const n = weeksOfN(weeks);
  if (!computed || typeof computed !== 'object') return realisticCapacityOf(computed, { n, history, planActual, lang });
  const list = rcMemo.get(computed) || rcMemo.set(computed, []).get(computed);
  const same = (e) => e.n === n && e.history === history && e.planActual === planActual && e.model === computed.model && e.support === computed.support;
  const hit = list.find((e) => same(e) && e.lang === lang);
  if (hit) return hit.rc;
  const other = list.find((e) => same(e) && hasRooms(e.rc));
  const rc = other ? relangCapacity(other.rc, lang) : realisticCapacityOf(computed, { n, history, planActual, lang });
  list.push({ n, history, planActual, model: computed.model, support: computed.support, lang, rc });
  return rc;
}
const hasRooms = (rc) => [...rc.teams, ...rc.people].every((u) => RC_ROOM.has(u));
// The rooms of a result that crossed a thread (the compute worker): the entries in order, teams then people.
export const capacityRooms = (rc) => [...rc.teams, ...rc.people].map((u) => RC_ROOM.get(u) ?? null);
// A result computed elsewhere for exactly this data state (the compute worker), with its rooms – later calls use it.
export function seedRealisticCapacity(computed, { weeks = 12, history = null, planActual = null, lang = 'de' } = {}, rc = null, rooms = null) {
  if (!computed || !rc || !Array.isArray(rooms)) return;
  const units = [...rc.teams, ...rc.people];
  if (rooms.length !== units.length || rooms.some((r) => typeof r !== 'number')) return;
  units.forEach((u, i) => RC_ROOM.set(u, rooms[i]));
  const n = weeksOfN(weeks);
  const list = rcMemo.get(computed) || rcMemo.set(computed, []).get(computed);
  if (!list.some((e) => e.n === n && e.history === history && e.planActual === planActual && e.lang === lang)) list.push({ n, history, planActual, model: computed.model, support: computed.support, lang, rc });
}
// The same result in another language: every sentence written again from the numbers (and the unrounded rooms).
export function relangCapacity(rc, lang) {
  if (!rc || rc.lang === lang) return rc;
  const n = rc.weeks.length;
  const again = (u, sentence) => {
    const room = RC_ROOM.get(u);
    const out = { ...u, projects: u.projects.map((r) => ({ ...r, explain: fitSentence(r, room, lang) })) };
    out.explain = sentence(out, n, lang);
    RC_ROOM.set(out, room);
    return out;
  };
  return { ...rc, lang, teams: rc.teams.map((t) => again(t, teamSentence)), people: rc.people.map((p) => again(p, personSentence)), facts: capacityFacts(lang) };
}
// open remaining estimate per team / person / project and week – the same spread as the engine's weekly view (per model)
const spreadMemo = new WeakMap();
function openSpread(model, n, wks) {
  const m = spreadMemo.get(model) || spreadMemo.set(model, new Map()).get(model);
  if (m.has(n)) return m.get(n);
  const teamProj = new Map(), personProj = new Map();
  const addP = (map, k, ref, w, h) => { const x = map.get(k) || map.set(k, new Map()).get(k); const a = x.get(ref) || x.set(ref, new Array(n).fill(0)).get(ref); a[w] += h; };
  for (const s of model.ds.issues || []) {
    if (s.role !== 'estimate' || !isOpen(s) || !s.re) continue;
    const win = spreadWindow(s, 're', model.today) || [nextWorkday(model.today), nextWorkday(model.today)];
    wks.forEach(([a, b], w) => {
      const h = shareIn(s.re, a, b, win, 'linear');
      if (!h) return;
      const ref = s.rootRef || '_none';
      addP(teamProj, s.team?.id || '_none', ref, w, h);
      if (s.assignee?.id) addP(personProj, s.assignee.id, ref, w, h);
    });
  }
  const out = { teamProj, personProj };
  m.set(n, out);
  return out;
}
// each person's nominal availability per week (no support taken off), per model
const nominalMemo = new WeakMap();
function personNominal(model, p, n, wks) {
  const m = nominalMemo.get(model) || nominalMemo.set(model, new Map()).get(model);
  const byP = m.get(n) || m.set(n, new Map()).get(n);
  if (!byP.has(p.id)) byP.set(p.id, wks.map(([a, b]) => personCapacityIn(model, p, a, b, 0)));
  return byP.get(p.id);
}
function realisticCapacityOf(computed, { n, history, planActual, lang }) {
  const model = computed.model;
  const wu = weeksUtilizationShared(model, null, n); // nominal: support not taken off here (we take the realistic P80 instead)
  const wks = weeksFrom(model.today, n);
  const { teamProj, personProj } = openSpread(model, n, wks);
  const sup = supportWeekly({ model, support: computed.support, history, planActual });
  const est = estimateFactors({ model, history });
  const projName = (ref) => model.itemByRef.get(ref)?.name || null;
  const projRank = (ref) => model.itemByRef.get(ref)?.rank ?? null;
  const byRank = (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || String(a.ref).localeCompare(String(b.ref));
  const weeksOut = wks.map(([a, b]) => ({ from: isoOf(a), to: isoOf(b) }));

  let lastRoom = 0; // the unrounded room of the last unit (kept per entry for relangCapacity)
  const unit = ({ nominal, planMap, supportStats, factor }) => {
    const p80 = supportStats.p80 || 0;
    const projects = [...(planMap || new Map()).entries()].map(([ref, arr]) => ({ ref, rank: projRank(ref), name: projName(ref), weekly: arr.map(r1), weeklyAdj: arr.map((h) => r1(h * factor)), planned: sum(arr), plannedAdj: sum(arr) * factor }));
    projects.sort(byRank);
    const weekly = wks.map((_, w) => {
      const planned = sum(projects, (p) => planMap.get(p.ref)[w]);
      const plannedAdj = planned * factor;
      const room = Math.max(0, nominal[w] - p80);
      const over = Math.max(0, plannedAdj - room);
      return { from: weeksOut[w].from, nominal: r1(nominal[w]), supportMedian: r1(supportStats.median), supportP80: r1(p80), room: r1(room), planned: r1(planned), plannedAdj: r1(plannedAdj), overtime: r1(over), load: room > EPS ? r2(plannedAdj / room) : plannedAdj > EPS ? null : 0, over: plannedAdj > room + EPS };
    });
    const tot = (f) => { let a = 0; for (let w = 0; w < n; w++) a += f(w); return a; };
    const raw = {
      nominal: tot((w) => nominal[w]), room: tot((w) => Math.max(0, nominal[w] - p80)),
      planned: sum(projects, (p) => p.planned), plannedAdj: sum(projects, (p) => p.plannedAdj),
    };
    raw.overtime = tot((w) => Math.max(0, sum(projects, (p) => planMap.get(p.ref)[w]) * factor - Math.max(0, nominal[w] - p80)));
    // waterline over the whole horizon: work may shift between weeks, so only the total room counts
    let cum = 0;
    const rows = projects.map((p) => {
      const prev = cum; cum += p.plannedAdj;
      const status = cum <= raw.room + EPS ? 'ok' : prev >= raw.room - EPS ? 'no' : 'partial';
      return { ref: p.ref, rank: p.rank, name: p.name, planned: r1(p.planned), plannedAdj: r1(p.plannedAdj), cum: r1(cum), fits: status, fitHours: r1(Math.max(0, Math.min(p.plannedAdj, raw.room - prev))), weekly: p.weekly, weeklyAdj: p.weeklyAdj };
    });
    for (const r of rows) r.explain = fitSentence(r, raw.room, lang);
    const firstMiss = rows.find((r) => r.fits !== 'ok');
    lastRoom = raw.room;
    return {
      weekly, projects: rows, overWeeks: weekly.filter((w) => w.over).length,
      totals: { nominal: r1(raw.nominal), room: r1(raw.room), planned: r1(raw.planned), plannedAdj: r1(raw.plannedAdj), overtime: r1(raw.overtime) },
      avg: { nominal: r1(raw.nominal / n), room: r1(raw.room / n), planned: r1(raw.planned / n), plannedAdj: r1(raw.plannedAdj / n), overtime: r1(raw.overtime / n) },
      fitCount: rows.filter((r) => r.fits === 'ok').length, waterRank: firstMiss ? firstMiss.rank : null,
    };
  };

  const teams = [];
  let unassigned = 0;
  for (const t of wu.teams) {
    if (t.teamId === '_none') { unassigned += t.planTotal; continue; }
    const s = sup.teams.get(t.teamId) || statsOf([]);
    const f = est.factorFor(t.teamId);
    const u = unit({ nominal: t.cap, planMap: teamProj.get(t.teamId), supportStats: s, factor: f.factor });
    const room = lastRoom;
    if (u.totals.nominal <= EPS && u.totals.planned <= EPS) continue;
    const supConf = s.source === 'none' ? 'none' : s.source === 'planActual' ? 'low' : confidenceOf(s.weeks, [8, 16]);
    const out = {
      teamId: t.teamId, name: model.teams.get(t.teamId)?.name || t.teamId, ...u,
      support: { median: r1(s.median), p80: r1(s.p80), mean: r1(s.mean), weeks: s.weeks, source: s.source, series: s.series, ...(s.planActualAvg != null ? { planActualAvg: r1(s.planActualAvg) } : {}), ...(computed.support?.overrides?.[t.teamId] != null ? { override: computed.support.overrides[t.teamId] } : {}) },
      estimate: { factor: r2(f.factor), n: f.n, trimmed: f.trimmed, source: f.source, ...(f.teamN != null ? { teamN: f.teamN } : {}) },
      confidence: minConf(supConf === 'none' ? 'low' : supConf, f.confidence === 'none' ? 'low' : f.confidence),
      facts: teamFacts(model, t.teamId, s, f, t.members.length),
    };
    out.explain = teamSentence(out, n, lang);
    RC_ROOM.set(out, room);
    teams.push(out);
  }
  teams.sort((a, b) => b.totals.overtime - a.totals.overtime || String(a.name).localeCompare(String(b.name), 'de'));

  const people = [];
  for (const p of capacityPeople(model).values()) {
    const nominal = personNominal(model, p, n, wks);
    let s = sup.people.get(p.id);
    if (!s || s.weeks === 0 || !sum(s.series, (x) => x.h)) {
      const avg = sup.personAvg[p.id] ?? sup.planActualPeople.get(p.id);
      s = avg > 0 ? { median: avg, p80: avg, mean: avg, weeks: 0, source: sup.personAvg[p.id] != null ? 'average' : 'planActual', series: [] } : (s || statsOf([]));
    }
    const f = est.factorFor(p.teamId); // the team's factor – never a personal accuracy score
    const u = unit({ nominal, planMap: personProj.get(p.id), supportStats: s, factor: f.factor });
    const room = lastRoom;
    if (u.totals.nominal <= EPS && u.totals.planned <= EPS) continue;
    const out = {
      id: p.id, name: model.ds.people?.[p.id]?.name || null, teamId: p.teamId || null, derived: !!p.derived, ...u,
      support: { median: r1(s.median), p80: r1(s.p80), weeks: s.weeks, source: s.source },
      estimate: { factor: r2(f.factor), source: f.source === 'team' ? 'team' : f.source },
    };
    out.explain = personSentence(out, n, lang);
    RC_ROOM.set(out, room);
    people.push(out);
  }
  people.sort((a, b) => b.totals.overtime - a.totals.overtime || String(a.name || a.id).localeCompare(String(b.name || b.id), 'de'));

  return {
    asOf: isoOf(model.today), lang, weeks: weeksOut, teams, people,
    estimate: { factor: est.all.factor == null ? null : r2(est.all.factor), n: est.all.n, trimmed: est.all.trimmed },
    support: { sources: sup.sources, from: sup.from, to: sup.to, percentile: SUPPORT_P },
    unassignedPlanned: r1(unassigned),
    facts: capacityFacts(lang),
  };
}
const capacityFacts = (lang) => [
  T(lang, 'Verfügbar = Wochenstunden nach Feiertagen, Abwesenheiten, Tagesgeschäft und interner Arbeit (wie in der Wochenplanung).', 'Available = weekly hours after holidays, absences, daily business and internal work (as in weekly planning).'),
  T(lang, `Support = P80 der wöchentlichen Support-Stunden (in 4 von 5 Wochen reicht das).`, 'Support = P80 of the weekly support hours (enough in 4 of 5 weeks).'),
  T(lang, 'Schätzfaktor = Gebuchte Zeit ÷ Originalschätzung erledigter Stories, getrimmter Mittelwert; angewandt auf die Restschätzung.', 'Estimate factor = time spent ÷ original estimate of done stories, trimmed mean; applied to the remaining estimate.'),
  T(lang, 'Passt ohne Überstunden = innerhalb des realistischen Raums über den ganzen Zeitraum, nach Rang.', 'Fits without overtime = within the realistic room over the whole period, in rank order.'),
];
function teamFacts(model, teamId, s, f, members) {
  const st = teamSettings(model, teamId);
  return { members, dailyBusinessPct: +st.dailyBusinessPct || 0, internalPct: +st.internalPct || 0, supportWeeks: s.weeks, supportSource: s.source, estimateSample: f.n, estimateTrimmed: f.trimmed, estimateSource: f.source };
}
function fitSentence(r, room, lang) {
  const who = `${rankLabel(r, lang)}${r.name ? ` (${r.name})` : ''}`;
  if (r.fits === 'ok') return T(lang, `${who} passt ohne Überstunden: kumuliert ${fmtH(r.cum, lang)} von ${fmtH(room, lang)} realistischem Raum.`, `${who} fits without overtime: ${fmtH(r.cum, lang)} of ${fmtH(room, lang)} realistic room used so far.`);
  if (r.fits === 'partial') return T(lang, `${who} passt nur teilweise: ${fmtH(r.fitHours, lang)} von ${fmtH(r.plannedAdj, lang)} haben Platz, der Rest ginge in Überstunden.`, `${who} fits only partly: ${fmtH(r.fitHours, lang)} of ${fmtH(r.plannedAdj, lang)} have room, the rest would be overtime.`);
  return T(lang, `${who} passt nicht mehr: alle ${fmtH(r.plannedAdj, lang)} lägen über dem realistischen Raum.`, `${who} no longer fits: all ${fmtH(r.plannedAdj, lang)} would be above the realistic room.`);
}
function teamSentence(t, n, lang) {
  const a = t.avg;
  const f = t.estimate.factor;
  const est = Math.abs(f - 1) < 0.005 ? T(lang, `Geplant sind Ø ${fmtH(a.planned, lang)}.`, `Planned: avg ${fmtH(a.planned, lang)}.`)
    : T(lang, `Geplant sind Ø ${fmtH(a.planned, lang)}; mit dem Schätzfaktor ${fmtF(f, lang)} realistisch ${fmtH(a.plannedAdj, lang)}.`, `Planned: avg ${fmtH(a.planned, lang)}; with the estimate factor ${fmtF(f, lang)} realistically ${fmtH(a.plannedAdj, lang)}.`);
  const ot = t.overWeeks
    ? T(lang, ` In ${t.overWeeks} von ${n} Wochen drohen Überstunden, zusammen ${fmtH(t.totals.overtime, lang)}.`, ` Overtime looms in ${t.overWeeks} of ${n} weeks, ${fmtH(t.totals.overtime, lang)} in total.`)
    : T(lang, ' Das passt ohne Überstunden.', ' That fits without overtime.');
  if (t.support.source === 'none') {
    return T(lang, `${t.name}: Ø ${fmtH(a.nominal, lang)} pro Woche verfügbar; zu Support liegen keine Daten vor. `, `${t.name}: avg ${fmtH(a.nominal, lang)} available per week; no support data. `) + est + ot;
  }
  return T(lang, `${t.name}: Ø ${fmtH(a.nominal, lang)} pro Woche verfügbar, Support braucht realistisch ${fmtH(t.support.p80, lang)} (Median ${fmtH(t.support.median, lang)}) – bleiben ${fmtH(a.room, lang)} für Projekte. `,
    `${t.name}: avg ${fmtH(a.nominal, lang)} available per week, support realistically needs ${fmtH(t.support.p80, lang)} (median ${fmtH(t.support.median, lang)}) – ${fmtH(a.room, lang)} left for projects. `) + est + ot;
}
function personSentence(p, n, lang) {
  const who = p.name || T(lang, 'Diese Person', 'This person');
  const base = T(lang, `${who}: Ø ${fmtH(p.avg.room, lang)} pro Woche realistisch für Projekte, geplant Ø ${fmtH(p.avg.plannedAdj, lang)} (mit Schätzfaktor).`, `${who}: avg ${fmtH(p.avg.room, lang)} per week realistically for projects, planned avg ${fmtH(p.avg.plannedAdj, lang)} (with estimate factor).`);
  return base + (p.overWeeks ? T(lang, ` Über 100 % in ${p.overWeeks} von ${n} Wochen (${fmtH(p.totals.overtime, lang)}).`, ` Above 100 % in ${p.overWeeks} of ${n} weeks (${fmtH(p.totals.overtime, lang)}).`) : '');
}

// =====================================================================================================
// b) similar past work
// =====================================================================================================
export const SIM_MIN_TEXT = 0.12; // below this the summaries share too little to call them similar
export const SIM_BONUS = { team: 0.1, type: 0.05, component: 0.1, label: 0.05 };
const lc = (xs) => new Set((xs || []).map((x) => String(x).toLowerCase()));
const typeName = (t) => String((typeof t === 'object' ? t?.name : t) || '').toLowerCase();

// One TF-IDF index per pool (the pool of done work is the same for every gap and estimate of a dataset): the term
// frequencies of every done story, the document frequencies and an inverted index. A query then weighs only the
// stories that share a word with it – with exactly the numbers the full computation gives (same df/N, same order).
const isDoneWork = (r) => r && (!r.role || r.role === 'estimate') && ((r.statusCat ?? r.status?.cat) === 'done' || r.resolved);
const docParts = (r) => [[r.summary, 1], [r.parentSummary, 0.5]].filter(([t]) => t);
function tfOf(parts) {
  const tf = new Map();
  for (const [text, w] of parts) for (const t of tokens(text)) tf.set(t, (tf.get(t) || 0) + w);
  return tf;
}
const simIndex = new WeakMap(); // pool array → { n, done, tfs, df, inv }
function poolIndex(pool) {
  let x = simIndex.get(pool);
  if (x && x.n === pool.length) return x;
  const done = pool.filter(isDoneWork);
  const tfs = done.map((r) => tfOf(docParts(r)));
  const df = new Map(), inv = new Map();
  tfs.forEach((tf, i) => { for (const t of tf.keys()) { df.set(t, (df.get(t) || 0) + 1); (inv.get(t) || inv.set(t, []).get(t)).push(i); } });
  x = { n: pool.length, done, tfs, df, inv };
  simIndex.set(pool, x);
  return x;
}
// The target's vector and the vectors of the stories that share a word with it, as tfidf() over [target, ...done]
// computes them (null when the target itself is in the pool – then the full computation runs).
function indexedVectors(tg, pool) {
  const ix = poolIndex(pool);
  if (ix.done.some((r) => (tg.id != null && r.id === tg.id) || (tg.key && r.key === tg.key))) return null;
  const ttf = tfOf([[tg.summary, 1], [tg.parentSummary || tg.description, 0.5]].filter(([t]) => t));
  const N = ix.done.length + 1;
  const vecOf = (tf) => {
    const v = new Map();
    let norm = 0;
    for (const [t, x] of tf) { const y = x * (Math.log((N + 1) / (((ix.df.get(t) || 0) + (ttf.has(t) ? 1 : 0)) + 1)) + 1); v.set(t, y); norm += y * y; }
    return { v, norm: Math.sqrt(norm) };
  };
  const cand = new Set();
  for (const t of ttf.keys()) for (const i of ix.inv.get(t) || []) cand.add(i);
  const vec = new Array(ix.done.length);
  for (const i of cand) vec[i] = vecOf(ix.tfs[i]);
  return { done: ix.done, tv: vecOf(ttf), vec };
}

export function similarWork(target, pool, { limit = 8, lang = 'de', minScore = 0.2 } = {}) {
  const tg = typeof target === 'string' ? { summary: target } : { ...(target || {}) };
  const fast = Array.isArray(pool) && pool.length > 200 ? indexedVectors(tg, pool) : null;
  let done, tv, vecAt;
  if (fast) {
    // a story without a shared word has cosine 0, below SIM_MIN_TEXT – skipped exactly as before
    ({ done, tv } = fast);
    vecAt = (i) => fast.vec[i] || { v: new Map(), norm: 0 };
  } else {
    done = (pool || []).filter((r) => r && (!r.role || r.role === 'estimate') && ((r.statusCat ?? r.status?.cat) === 'done' || r.resolved)
      && !(tg.id != null && r.id === tg.id) && !(tg.key && r.key === tg.key));
    // summary counts fully, the parent's summary (epic) half – it adds context without dominating
    const docs = [[[tg.summary, 1], [tg.parentSummary || tg.description, 0.5]], ...done.map((r) => [[r.summary, 1], [r.parentSummary, 0.5]])];
    const vec = tfidf(docs.map((d) => d.filter(([t]) => t)));
    tv = vec[0];
    vecAt = (i) => vec[i + 1];
  }
  const tComp = lc(tg.components), tLab = lc(tg.labels), tType = typeName(tg.type), tTeam = idOf(tg.team);
  const scored = [];
  done.forEach((r, i) => {
    const text = cosine(tv, vecAt(i));
    if (text < SIM_MIN_TEXT) return;
    const why = { text: r2(text) };
    if (tTeam && idOf(r.team) === tTeam) why.team = SIM_BONUS.team;
    if (tType && typeName(r.type) === tType) why.type = SIM_BONUS.type;
    if ([...lc(r.components)].some((c) => tComp.has(c))) why.component = SIM_BONUS.component;
    if ([...lc(r.labels)].some((c) => tLab.has(c))) why.label = SIM_BONUS.label;
    const score = Math.min(1, text + (why.team || 0) + (why.type || 0) + (why.component || 0) + (why.label || 0));
    if (score < minScore) return;
    scored.push({ r, score, why });
  });
  scored.sort((a, b) => b.score - a.score || String(b.r.resolved || '').localeCompare(String(a.r.resolved || '')) || String(a.r.key).localeCompare(String(b.r.key)));
  const items = scored.slice(0, Math.max(1, limit)).map(({ r, score, why }) => {
    const s = dayIdx(r.start) ?? dayIdx(r.created), e = dayIdx(r.resolved);
    const dur = s != null && e != null && e >= s ? e - s : null;
    const cc = Number.isFinite(+r.commentCount) && r.commentCount != null ? +r.commentCount : null;
    return {
      id: r.id, key: r.key, summary: r.summary, team: r.team || null, type: typeof r.type === 'object' ? r.type?.name ?? null : r.type ?? null,
      score: r2(score), why, actualH: r1(r.ts || 0), estimateH: r.oe > 0 ? r1(r.oe) : null,
      overrunPct: r.oe > 0 && r.ts > 0 ? Math.round((r.ts / r.oe - 1) * 100) : null,
      durationDays: dur, durationWorkdays: dur == null ? null : workdays(s, e), durationFrom: dayIdx(r.start) != null ? 'start' : 'created',
      resolved: r.resolved || null, parentKey: r.parentKey || null, comments: cc, hasComments: cc == null ? null : cc > 0,
    };
  });
  const actual = items.filter((x) => x.actualH > 0).map((x) => x.actualH);
  const overrun = items.filter((x) => x.overrunPct != null).map((x) => x.overrunPct);
  const dur = items.filter((x) => x.durationWorkdays != null).map((x) => x.durationWorkdays);
  const stats = {
    n: items.length, withActual: actual.length,
    medianActualH: actual.length ? r1(median(actual)) : null, p80ActualH: actual.length ? r1(percentile(actual, 0.8)) : null,
    typicalOverrunPct: overrun.length ? Math.round(median(overrun)) : null, overrunN: overrun.length,
    medianDurationWorkdays: dur.length ? median(dur) : null, p80DurationWorkdays: dur.length ? percentile(dur, 0.8) : null,
    withComments: items.filter((x) => x.hasComments).length,
  };
  const confidence = items.length >= 6 && items[0].score >= 0.5 ? 'high' : items.length >= 3 ? 'medium' : 'low';
  return { target: { summary: tg.summary || '', key: tg.key || null, estimateH: tg.oe > 0 ? r1(tg.oe) : null }, items, stats, confidence, poolSize: done.length, explain: similarSentence(stats, tg, lang) };
}
function similarSentence(s, tg, lang) {
  if (!s.n) return T(lang, 'Keine ähnliche erledigte Arbeit gefunden.', 'No similar finished work found.');
  const head = T(lang, s.n === 1 ? '1 ähnliche erledigte Aufgabe gefunden.' : `${s.n} ähnliche erledigte Aufgaben gefunden.`, s.n === 1 ? '1 similar finished item found.' : `${s.n} similar finished items found.`);
  const parts = [head];
  if (s.medianActualH != null) parts.push(T(lang, `Typisch: ${fmtH(s.medianActualH, lang)} Aufwand (P80 ${fmtH(s.p80ActualH, lang)}).`, `Typical: ${fmtH(s.medianActualH, lang)} effort (P80 ${fmtH(s.p80ActualH, lang)}).`));
  if (s.typicalOverrunPct != null) {
    const o = s.typicalOverrunPct;
    parts.push(o === 0 ? T(lang, 'Die Schätzung traf typischerweise.', 'The estimate was typically right.')
      : o > 0 ? T(lang, `Typisch ${o} % mehr als geschätzt.`, `Typically ${o} % more than estimated.`)
        : T(lang, `Typisch ${-o} % weniger als geschätzt.`, `Typically ${-o} % less than estimated.`));
  }
  if (s.medianDurationWorkdays != null) parts.push(T(lang, `Dauer typisch ${fmtNum(s.medianDurationWorkdays, 1, lang)} Arbeitstage.`, `Typical duration ${fmtNum(s.medianDurationWorkdays, 1, lang)} working days.`));
  if (tg.oe > 0 && s.medianActualH != null) {
    const d = tg.oe - s.medianActualH;
    if (Math.abs(d) >= Math.max(1, s.medianActualH * 0.1)) parts.push(d < 0 ? T(lang, `Die Schätzung ${fmtH(tg.oe, lang)} liegt unter dem typischen Aufwand.`, `The estimate of ${fmtH(tg.oe, lang)} is below the typical effort.`)
      : T(lang, `Die Schätzung ${fmtH(tg.oe, lang)} liegt über dem typischen Aufwand.`, `The estimate of ${fmtH(tg.oe, lang)} is above the typical effort.`));
  }
  return parts.join(' ');
}

// =====================================================================================================
// c) recurring support topics
// =====================================================================================================
// Words that say nothing about the topic of a support ticket (stemmed like the tokens).
const GENERIC = new Set(['fehler', 'problem', 'probleme', 'issue', 'issues', 'funktioniert', 'geht', 'hilfe', 'help', 'frage', 'anfrage', 'request',
  'kunde', 'kunden', 'benutzer', 'user', 'users', 'defekt', 'broken', 'fail', 'failed', 'fehlgeschlagen', 'moeglich', 'dringend', 'urgent', 'ticket',
  'works', 'working', 'work', 'klappt', 'kaputt', 'support', 'mehr', 'seit', 'heute', 'immer', 'wieder', 'beim', 'bekomme', 'bekommt',
  'bricht', 'abbricht', 'schlaegt', 'fehl', 'leer', 'meldet', 'zeigt', 'laeuft', 'langsam', 'erneut', 'still', 'nichts', 'does', 'doesnt', 'cannot', 'cant', 'unable'].map((w) => SYN[stem(w)] || stem(w)));
export const TOPIC_RECENT_DAYS = 28;

// Memoized per tickets array and options (the Lotse skills, "Heute für dich" and the Ask card ask for the same topics
// on every question; ask.js ticketsOf returns one frozen array per data state). The result is shared – read it only.
const topicsCache = new WeakMap();
const topicsKey = (minCount, lang, t0, minHours) => `${minCount}|${lang}|${t0}|${minHours}`;
// The same topics computed elsewhere for the same frozen tickets list (the compute worker) – see supportTopics.
export function seedSupportTopics(tickets, { minCount = 3, lang = 'de', today = null, minHours = 2 } = {}, value = null) {
  if (!value || !Array.isArray(tickets) || !Object.isFrozen(tickets)) return;
  const t0 = today != null ? (typeof today === 'number' ? today : dayIdx(today)) : todayIdx();
  const m = topicsCache.get(tickets) || topicsCache.set(tickets, new Map()).get(tickets);
  const k = topicsKey(minCount, lang, t0, minHours);
  if (!m.has(k)) m.set(k, value);
}
export function supportTopics(tickets, { minCount = 3, lang = 'de', today = null, minHours = 2 } = {}) {
  const t0 = today != null ? (typeof today === 'number' ? today : dayIdx(today)) : todayIdx();
  if (!Array.isArray(tickets) || !Object.isFrozen(tickets)) return topicsOf(tickets, { minCount, lang, t0, minHours });
  const m = topicsCache.get(tickets) || topicsCache.set(tickets, new Map()).get(tickets);
  const k = topicsKey(minCount, lang, t0, minHours);
  if (!m.has(k)) {
    // the same topics in another language: only the sentences differ (written again from the topic's own numbers)
    const other = m.get(topicsKey(minCount, lang === 'de' ? 'en' : 'de', t0, minHours));
    m.set(k, other ? relangTopics(other, lang, minHours) : topicsOf(tickets, { minCount, lang, t0, minHours }));
  }
  return m.get(k);
}
function relangTopics(st, lang) {
  const topics = st.topics.map((t) => ({ ...t, explain: topicSentence(t, lang) }));
  const pb = topics.filter((x) => x.playbook);
  return { ...st, topics, explain: topicsExplain(topics, st.tickets, pb, lang) };
}
const topicsExplain = (topics, n, pb, lang) => (!topics.length ? T(lang, 'Keine wiederkehrenden Support-Themen gefunden.', 'No recurring support topics found.')
  : T(lang, `${topics.length} Themen in ${n} Tickets; ${pb.length} davon lohnen eine Standardantwort oder einen Hilfeartikel (zusammen ${fmtH(sum(pb, (x) => x.spentTotal), lang)}).`,
    `${topics.length} topics in ${n} tickets; ${pb.length} of them are worth a standard answer or help article (${fmtH(sum(pb, (x) => x.spentTotal), lang)} in total).`));
function topicsOf(tickets, { minCount, lang, t0, minHours }) {
  const seen = new Set();
  const list = [];
  for (const t of tickets || []) {
    const k = t?.id ?? t?.key;
    if (k == null || seen.has(k)) continue;
    seen.add(k);
    const ws = words(t.summary).filter((x) => !GENERIC.has(x.t));
    list.push({ t, ws, toks: [...new Set(ws.map((x) => x.t))] });
  }
  // document frequency of each token over all tickets
  const df = new Map();
  for (const x of list) for (const tok of x.toks) df.set(tok, (df.get(tok) || 0) + 1);
  const category = (t) => t.requestType || (t.components || [])[0] || (t.labels || []).find((l) => !/^support$/i.test(l)) || null;
  // signature: the ticket's most frequent token that recurs (≥ minCount tickets); ties alphabetically
  const groups = new Map();
  for (const x of list) {
    const cand = x.toks.filter((tok) => df.get(tok) >= minCount).sort((a, b) => df.get(b) - df.get(a) || a.localeCompare(b));
    const cat = category(x.t);
    const key = cand.length ? `t:${cand[0]}` : cat ? `c:${String(cat).toLowerCase()}` : null;
    if (!key) continue;
    (groups.get(key) || groups.set(key, []).get(key)).push(x);
  }
  const recentFrom = t0 - TOPIC_RECENT_DAYS + 1;
  const topics = [];
  for (const [key, xs] of groups) {
    const count = xs.length;
    if (count < 2) continue; // recurring = at least twice
    const spent = xs.map((x) => +(x.t.spentH ?? x.t.ts ?? 0) || 0);
    const created = xs.map((x) => dayIdx(x.t.created)).filter((d) => d != null);
    const recent = created.filter((d) => d >= recentFrom && d <= t0).length;
    const before = created.filter((d) => d < recentFrom);
    const beforeWeeks = before.length ? Math.max(1, (recentFrom - Math.min(...before)) / 7) : 0;
    const recentPerWeek = recent / (TOPIC_RECENT_DAYS / 7), beforePerWeek = beforeWeeks ? before.length / beforeWeeks : 0;
    const trend = !before.length ? (recent ? 'new' : 'stable') : recentPerWeek > beforePerWeek * 1.5 && recent >= 2 ? 'rising' : recentPerWeek < beforePerWeek * 0.5 ? 'falling' : 'stable';
    // name: the two most frequent tokens in the group (original spelling), plus the main category
    const tokCount = new Map(), surface = new Map();
    for (const x of xs) for (const tok of new Set(x.ws.map((w) => w.t))) tokCount.set(tok, (tokCount.get(tok) || 0) + 1);
    for (const x of xs) for (const w of x.ws) { const m = surface.get(w.t) || surface.set(w.t, new Map()).get(w.t); m.set(w.w, (m.get(w.w) || 0) + 1); }
    const show = (tok) => [...surface.get(tok).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const main = key.startsWith('t:') ? key.slice(2) : null;
    const top = [...tokCount.entries()].filter(([tok, c]) => tok !== main && c >= Math.max(2, Math.ceil(count / 2))).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const cats = new Map();
    for (const x of xs) { const c = category(x.t); if (c) cats.set(c, (cats.get(c) || 0) + 1); }
    const topCat = [...cats.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
    let name;
    if (main) {
      const n0 = show(main);
      name = top.length ? `${n0} ${show(top[0][0])}` : n0;
      if (topCat && topCat[1] * 2 >= count && !name.toLowerCase().includes(String(topCat[0]).toLowerCase())) name += ` (${topCat[0]})`;
    } else name = String(category(xs[0].t));
    name = name.charAt(0).toUpperCase() + name.slice(1);
    const newest = [...xs].sort((a, b) => String(b.t.created || '').localeCompare(String(a.t.created || '')) || String(b.t.key).localeCompare(String(a.t.key)));
    const total = sum(spent);
    const topic = {
      id: key, name, tokens: main ? [main, ...top.slice(0, 1).map(([tok]) => tok)] : [], category: topCat ? topCat[0] : null,
      categories: Object.fromEntries([...cats.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
      count, open: xs.filter((x) => (x.t.statusCat ? x.t.statusCat !== 'done' : !x.t.resolved)).length,
      spentTotal: r1(total), spentMedian: r1(median(spent) ?? 0), recent, before: before.length,
      recentPerWeek: r2(recentPerWeek), beforePerWeek: r2(beforePerWeek), trend,
      exampleKeys: newest.slice(0, 5).map((x) => x.t.key).filter(Boolean), ids: xs.map((x) => x.t.id).filter((x) => x != null),
      // a group held together only by its request type/component mixes different requests: listed, never a playbook
      kind: main ? 'tokens' : 'category', playbook: !!main && count >= minCount && total >= minHours,
    };
    topic.explain = topicSentence(topic, lang);
    topics.push(topic);
  }
  topics.sort((a, b) => b.playbook - a.playbook || b.count - a.count || b.spentTotal - a.spentTotal || a.name.localeCompare(b.name));
  const pb = topics.filter((x) => x.playbook);
  return {
    asOf: isoOf(t0), tickets: list.length, topics, playbookCount: pb.length,
    explain: topicsExplain(topics, list.length, pb, lang),
  };
}
function topicSentence(t, lang) {
  const tr = { rising: T(lang, 'steigend', 'rising'), falling: T(lang, 'fallend', 'falling'), stable: T(lang, 'stabil', 'stable'), new: T(lang, 'neu', 'new') }[t.trend];
  const base = T(lang, `„${t.name}“: ${t.count} Tickets, zusammen ${fmtH(t.spentTotal, lang)} (Median ${fmtH(t.spentMedian, lang)} pro Ticket), Tendenz ${tr}.`,
    `"${t.name}": ${t.count} tickets, ${fmtH(t.spentTotal, lang)} in total (median ${fmtH(t.spentMedian, lang)} per ticket), trend ${tr}.`);
  const mixed = t.kind === 'category' ? T(lang, ' Verschiedene Anliegen derselben Kategorie.', ' Different requests of the same category.') : '';
  return base + mixed + (t.playbook ? T(lang, ' Kandidat für eine Standardantwort oder einen Hilfeartikel.', ' Candidate for a standard answer or a help article.') : '');
}

// =====================================================================================================
// d) overtime outlook
// =====================================================================================================
// Who is above 100 % realistic load (planned × factor > realistic room) in the next N weeks, by how much, and
// which work to move: the lowest-ranked projects (unranked first) with hours in those weeks, until the overtime is covered.
export function overtimeOutlook(input, { weeks = null, lang = 'de', history = null, planActual = null } = {}) {
  const rc = input?.model ? realisticCapacity(input, { weeks: weeks || 12, history, planActual, lang }) : input;
  const n = Math.max(1, Math.min(rc.weeks.length, weeks || rc.weeks.length));
  const look = (u) => {
    const over = [];
    for (let w = 0; w < n; w++) { const x = u.weekly[w]; if (x.over) over.push({ w, from: x.from, load: x.load, hours: Math.max(0, x.plannedAdj - x.room) }); }
    if (!over.length) return null;
    const hours = sum(over, (x) => x.hours);
    const lowestFirst = [...u.projects].sort((a, b) => (b.rank ?? Infinity) - (a.rank ?? Infinity) || String(b.ref).localeCompare(String(a.ref)));
    let rest = hours;
    const move = [];
    for (const p of lowestFirst) {
      if (rest <= EPS) break;
      const h = sum(over, (x) => p.weeklyAdj[x.w]);
      if (h <= EPS) continue;
      const take = Math.min(h, rest);
      move.push({ ref: p.ref, rank: p.rank, name: p.name, hours: r1(take) });
      rest -= take;
    }
    const loads = over.map((x) => x.load).filter((x) => x != null);
    return { overWeeks: over.map(({ from, load, hours: h }) => ({ from, load, hours: r1(h) })), hours: r1(hours), peakLoad: loads.length ? Math.max(...loads) : null, noRoom: over.some((x) => x.load == null), move };
  };
  const teams = [], people = [];
  for (const t of rc.teams) { const o = look(t); if (o) teams.push({ teamId: t.teamId, name: t.name, ...o }); }
  for (const p of rc.people) { const o = look(p); if (o) people.push({ id: p.id, name: p.name, teamId: p.teamId, ...o }); }
  const byHours = (a, b) => b.hours - a.hours || String(a.name || a.id || a.teamId).localeCompare(String(b.name || b.id || b.teamId), 'de');
  teams.sort(byHours); people.sort(byHours);
  for (const x of [...teams, ...people]) x.explain = outlookSentence(x, n, lang);
  const total = sum(teams, (t) => t.hours);
  return {
    weeks: rc.weeks.slice(0, n), teams, people, hours: r1(total),
    explain: !teams.length && !people.length
      ? T(lang, `In den nächsten ${n} Wochen ist niemand über 100 % realistischer Auslastung.`, `Nobody is above 100 % realistic load in the next ${n} weeks.`)
      : T(lang, `In den nächsten ${n} Wochen: ${teams.length} ${teams.length === 1 ? 'Team' : 'Teams'} und ${people.length} ${people.length === 1 ? 'Person' : 'Personen'} über 100 %; Teams zusammen ${fmtH(total, lang)} zu viel.`,
        `In the next ${n} weeks: ${teams.length} ${teams.length === 1 ? 'team' : 'teams'} and ${people.length} ${people.length === 1 ? 'person' : 'people'} above 100 %; teams ${fmtH(total, lang)} over in total.`),
  };
}
function outlookSentence(x, n, lang) {
  const who = x.name || T(lang, 'Diese Person', 'This person');
  const k = x.overWeeks.length;
  const peak = x.peakLoad != null ? T(lang, ` (Spitze ${fmtPct(x.peakLoad)})`, ` (peak ${fmtPct(x.peakLoad)})`) : '';
  const head = T(lang, `${who}: in ${k} von ${n} Wochen über 100 %${peak}, zusammen ${fmtH(x.hours, lang)} zu viel.`, `${who}: above 100 % in ${k} of ${n} weeks${peak}, ${fmtH(x.hours, lang)} too much in total.`);
  if (!x.move.length) return head;
  const list = x.move.map((m) => `${rankLabel(m, lang)}${m.name ? ` ${m.name}` : ''} (${fmtH(m.hours, lang)})`).join(T(lang, ', ', ', '));
  return `${head} ${T(lang, `Verschieben: ${list}.`, `Move: ${list}.`)}`;
}
