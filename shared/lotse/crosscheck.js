// Lotse – cross-check: every number, percentage, issue key, team, date, quarter and rank a text claims is compared with
// the story's own facts (story.js storyFacts). Pure code, no second model. Used on the AI's reading (lotse.llm) and, in
// strict mode, on Lotse's own sentences (the tests: no number without a source).
//
// crossCheck(story, text) → { agree: 0..1|null, verdict: 'agrees'|'differs'|'unverifiable',
//                             claims: [{ text, kind, verified: true|false|null, expected, found }] }
//   verified true  = the story says so (rounding: ±1 in the last digit or ±1 %; "rund/about" ±5 %)
//   verified false = the story says something else, or names no such key / team / rank
//   verified null  = nothing to compare with (e.g. a bare number without a unit)
import { storyFacts, isoWeekNo } from './story.js';

const MONTHS = [
  ['jan', 'januar', 'january', 'jän', 'jaen'], ['feb', 'februar', 'february'], ['mär', 'maerz', 'märz', 'mrz', 'mar', 'march'], ['apr', 'april'],
  ['mai', 'may'], ['jun', 'juni', 'june'], ['jul', 'juli', 'july'], ['aug', 'august'], ['sep', 'sept', 'september'], ['okt', 'oktober', 'oct', 'october'],
  ['nov', 'november'], ['dez', 'dezember', 'dec', 'december'],
];
const MONTH_RE = MONTHS.flat().sort((a, b) => b.length - a.length).join('|');
const monthNo = (s) => MONTHS.findIndex((m) => m.includes(String(s).toLowerCase().replace(/\.$/, ''))) + 1;
const pad = (n) => String(n).padStart(2, '0');

const UNIT_RE = /^\s?(%|prozentpunkte|prozent|percentage points?|percent|pp\b|h\b|std\b\.?|stunden|hours?\b|hrs?\b|arbeitstagen?|arbeitstage|werktagen?|werktage|working days?|business days?|tagen?\b|tage\b|days?\b|wochen?\b|weeks?\b|€|eur\b|euro\b|personen|people\b|persons?\b|projekten?|projekte\b|projects?\b|teams?\b|stories\b|story\b|tickets?\b|vorgängen?|vorgänge\b|work items?|items?\b|aufgaben\b|tasks?\b|sub-?tasks?\b|konflikten?|konflikte\b|conflicts?\b|lücken\b|gaps?\b|themen\b|topics?\b|meilensteinen?|meilensteine\b|milestones?\b|epics?\b|mitglieder[n]?\b|members?\b|vorschläge[n]?\b|suggestions?\b|wochen\b)/i;
const unitOf = (u) => {
  const s = String(u || '').toLowerCase().trim();
  if (!s) return null;
  if (/^(%|prozent|percent|pp)/.test(s)) return '%';
  if (/^(h|std|stunden|hours?|hrs?)$/.test(s.replace(/\.$/, ''))) return 'h';
  if (/^(arbeitstag|werktag|working|business|tag|day)/.test(s)) return 'd';
  if (/^(woche|week)/.test(s)) return 'w';
  if (/^(€|eur|euro)/.test(s)) return 'eur';
  return 'n';
};
const APPROX_RE = /(rund|etwa|ca\.?|circa|knapp|gut|fast|beinahe|ungefähr|ueber|über|mehr als|weniger als|about|around|approximately|roughly|nearly|almost|over|more than|less than|~)\s*$/i;
// "Team Lead" is not a team: words that follow "Team" in normal sentences
const NOT_A_TEAM = new Set(['lead', 'leads', 'leitung', 'leiter', 'leiterin', 'mitglied', 'mitglieder', 'member', 'members', 'kapazität', 'kapazitaet', 'capacity', 'auslastung', 'load',
  'und', 'and', 'oder', 'or', 'ist', 'is', 'hat', 'has', 'sind', 'are', 'der', 'die', 'das', 'the', 'mit', 'with', 'von', 'of', 'im', 'in', 'fehlen', 'fehlt', 'braucht', 'needs', 'liegt', 'muss', 'must', 'should', 'sollte',
  'kann', 'can', 'bleibt', 'stays', 'schafft', 'wird', 'will', 'würde', 'would', 'trägt', 'carries', 'über', 'over', 'unter', 'under', 'ohne', 'without', 'selbst', 'itself', 'insgesamt', 'overall']);

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function parseNum(raw, lang) {
  let s = raw.replace(/[−–]/g, '-').replace(/\s/g, '');
  const de = lang !== 'en';
  if (de) s = s.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  else s = s.replace(/,(?=\d{3}(\D|$))/g, '');
  const v = Number(s);
  const dot = s.indexOf('.');
  return { v, dp: dot >= 0 ? s.length - dot - 1 : 0 };
}

// All claims of a text, in reading order. entities = story.entities (names are masked so "Mobile App 2.0" is no number).
export function textClaims(text, { lang = 'de', entities = null } = {}) {
  const src = String(text || '');
  let t = src;
  const claims = [];
  const mask = (start, len) => { t = t.slice(0, start) + ' '.repeat(len) + t.slice(start + len); };
  const scan = (re, fn) => { for (const m of [...t.matchAll(re)]) { const r = fn(m); if (r !== false) mask(m.index, m[0].length); } };
  // names first: project / person names (anchors for ranks), known team names (verified team mentions)
  const anchors = [];
  const names = [
    ...(entities?.projects || []).flatMap((p) => [[p.name, p], ...(p.key ? [[p.key, p]] : [])]).map(([n, p]) => ({ n, kind: 'project', p })),
    ...(entities?.people || []).map((p) => ({ n: p.name, kind: 'person', p })),
    ...(entities?.teams || []).map((p) => ({ n: p.name, kind: 'team', p })),
    ...(entities?.texts || []).map((t) => ({ n: t, kind: 'text', p: null })),
  ].filter((x) => x.n && x.n.length >= 2).sort((a, b) => b.n.length - a.n.length);
  for (const x of names) {
    if (!t.includes(x.n)) continue; // the regex below needs the literal name – most entities are not in the text
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${esc(x.n)})(?![\\p{L}\\p{N}])`, 'gu');
    for (const m of [...t.matchAll(re)]) {
      const start = m.index + m[1].length;
      if (x.kind === 'project') {
        anchors.push({ start, end: start + x.n.length, p: x.p });
        if (x.n === x.p.key) { claims.push({ at: start, text: x.n, kind: 'key', found: x.n }); }
      } else if (x.kind === 'team') claims.push({ at: start, text: x.n, kind: 'team', found: x.n, known: true });
      mask(start, x.n.length);
    }
  }
  scan(/\b[A-Z][A-Z0-9_]{1,19}-\d{1,9}\b/g, (m) => claims.push({ at: m.index, text: m[0], kind: 'key', found: m[0] }));
  scan(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => claims.push({ at: m.index, text: m[0], kind: 'date', found: m[0], y: +m[1], m: +m[2], d: +m[3] }));
  scan(/\b(?:Q([1-4])\s*\/?\s*(\d{4})|(\d{4})\s*-?\s*Q([1-4]))\b/g, (m) => claims.push({ at: m.index, text: m[0], kind: 'quarter', found: `${m[2] || m[3]}-Q${m[1] || m[4]}` }));
  scan(/\bQ([1-4])\b/g, (m) => claims.push({ at: m.index, text: m[0], kind: 'quarter', found: `Q${m[1]}` }));
  scan(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})?(?!\d)/g, (m) => (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31 ? claims.push({ at: m.index, text: m[0], kind: 'date', found: m[0], y: m[3] ? +m[3] : null, m: +m[2], d: +m[1] }) : false));
  scan(new RegExp(`\\b(\\d{1,2})\\.?\\s+(${MONTH_RE})\\.?(?:\\s+(\\d{4}))?(?![\\p{L}])`, 'giu'), (m) => claims.push({ at: m.index, text: m[0], kind: 'date', found: m[0], y: m[3] ? +m[3] : null, m: monthNo(m[2]), d: +m[1] }));
  scan(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'giu'), (m) => claims.push({ at: m.index, text: m[0], kind: 'date', found: m[0], y: m[3] ? +m[3] : null, m: monthNo(m[1]), d: +m[2] }));
  scan(/\b(?:KW|CW|W|week|Woche)\s?(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?\b/gi, (m) => { claims.push({ at: m.index, text: m[0], kind: 'week', found: +m[1] }); if (m[2]) claims.push({ at: m.index, text: m[0], kind: 'week', found: +m[2] }); });
  scan(/#\s?(\d{1,3})\b/g, (m) => claims.push({ at: m.index, text: m[0], kind: 'rank', found: +m[1] }));
  scan(/\b(?:Rang|Rangs|Ranges|rank|ranked|Platz|position)\s*#?\s*(\d{1,3})\b/gi, (m) => claims.push({ at: m.index, text: m[0], kind: 'rank', found: +m[1] }));
  scan(/\bTeams?\s+([A-ZÄÖÜ][\p{L}0-9-]{1,30})/gu, (m) => (NOT_A_TEAM.has(m[1].toLowerCase()) ? false : claims.push({ at: m.index, text: m[0], kind: 'team', found: m[1] })));
  const NUM = lang === 'en' ? /(?<![\p{L}\p{N}.,])[-−+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu : /(?<![\p{L}\p{N}.,])[-−+]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?/gu;
  const nums = [...t.matchAll(NUM)].map((m) => {
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 24);
    const u = UNIT_RE.exec(after);
    const { v, dp } = parseNum(m[0], lang);
    return { at: m.index, raw: m[0], v, dp, unit: u ? unitOf(u[1]) : null, unitText: u ? u[0] : '', approx: APPROX_RE.test(src.slice(Math.max(0, m.index - 16), m.index)) };
  });
  // "12–15 h": the first number takes the unit of the second
  for (let i = 0; i < nums.length - 1; i++) if (!nums[i].unit && nums[i + 1].unit && /^\s*(–|-|bis|to)\s*$/.test(t.slice(nums[i].at + nums[i].raw.length, nums[i + 1].at))) nums[i].unit = nums[i + 1].unit;
  for (const n of nums) {
    if (!Number.isFinite(n.v)) continue;
    if (!n.unit && n.dp === 0 && n.v >= 1990 && n.v <= 2100) continue; // a year
    claims.push({ at: n.at, text: `${n.raw}${n.unitText}`.trim(), kind: n.unit === '%' ? 'percent' : 'number', found: Math.abs(n.v), unit: n.unit, dp: n.dp, approx: n.approx });
  }
  claims.sort((a, b) => a.at - b.at);
  return { claims, anchors };
}

const fmtExpected = (x, lang) => {
  const v = Math.round(x.value * 10) / 10;
  const s = lang === 'en' ? String(v) : String(v).replace('.', ',');
  return x.unit === 'n' ? s : x.unit === '%' ? `${s} %` : `${s} ${x.unit}`;
};

// opts.derived (default true): differences / sums / shares of two story numbers count as verified.
// opts.strict: a bare number must be found too (Lotse's own sentences).
export function crossCheck(story, text, opts = {}) {
  const lang = opts.lang || story?.lang || 'de';
  const facts = storyFacts(story || {}, { derived: opts.derived !== false });
  const src = String(text || '');
  const { claims, anchors } = textClaims(src, { lang, entities: story?.entities || null });
  const out = [];
  const byUnit = (u) => facts.numbers.filter((x) => x.unit === u);
  const units = new Set(facts.numbers.map((x) => x.unit));
  for (const c of claims) {
    let verified = null, expected = null;
    switch (c.kind) {
      case 'key': verified = facts.keys.has(c.found); break;
      case 'team': {
        const known = c.known || facts.teams.has(String(c.found).toLowerCase());
        verified = known ? true : false;
        if (!known) expected = [...facts.teams.values()].slice(0, 3).join(', ') || null;
        break;
      }
      case 'quarter': verified = c.found.startsWith('Q') ? [...facts.quarters].some((q) => q.endsWith(c.found)) : facts.quarters.has(c.found); break;
      case 'week': verified = facts.weeks.has(c.found) ? true : null; break;
      case 'date': {
        const md = `${pad(c.m)}-${pad(c.d)}`;
        verified = [...facts.dates].some((d) => (c.y ? d === `${c.y}-${md}` : d.slice(5) === md));
        if (!verified) expected = [...facts.dates].sort().find((d) => d.slice(5, 7) === pad(c.m)) || null;
        break;
      }
      case 'rank': {
        // the project named right next to the rank is the one it is about: "Name (#3)", "Name, Rang 3", "#3 Name", "Rang 3 Name"
        const before = anchors.filter((a) => a.end <= c.at && /^[\s(,:–-]{0,4}$/.test(src.slice(a.end, c.at))).sort((a, b) => b.end - a.end)[0];
        const after = anchors.find((a) => a.start >= c.at + c.text.length && /^\s{0,2}$/.test(src.slice(c.at + c.text.length, a.start)));
        const p = (after || before)?.p;
        if (p && Number.isFinite(p.rank)) { verified = p.rank === c.found; if (!verified) expected = `#${p.rank}`; } else verified = facts.ranks.has(c.found);
        break;
      }
      case 'percent': case 'number': {
        const u = c.unit;
        const pool = (u === null || u === 'n' ? facts.numbers : u === 'w' ? [...byUnit('n'), ...byUnit('w')] : u === 'd' ? [...byUnit('d'), ...byUnit('n')] : byUnit(u))
          .filter((x) => opts.derived !== false || x.direct);
        const tolOf = (f) => Math.max(c.dp > 0 ? 10 ** -c.dp : 1, 0.01 * Math.abs(f), c.approx ? 0.05 * Math.abs(f) : 0, u === '%' ? 1 : 0) + 1e-9;
        const hit = pool.find((x) => Math.abs(Math.abs(x.value) - c.found) <= tolOf(x.value));
        if (hit) verified = true;
        else if (u && u !== 'n' && units.has(u === 'w' ? 'n' : u)) verified = false;
        else if (u === 'w' && units.has('n')) verified = false;
        else if (u === 'n' && units.has('n')) verified = false;
        else verified = opts.strict ? false : null;
        if (verified === false) {
          const same = (u && u !== 'n' ? byUnit(u === 'w' ? 'n' : u) : facts.numbers).filter((x) => x.direct);
          const near = same.sort((a, b) => Math.abs(Math.abs(a.value) - c.found) - Math.abs(Math.abs(b.value) - c.found))[0];
          if (near) expected = fmtExpected(near, lang);
        }
        break;
      }
      default: break;
    }
    out.push({ text: c.text, kind: c.kind === 'percent' ? 'percent' : c.kind, verified, expected, found: c.found });
  }
  const yes = out.filter((c) => c.verified === true).length, no = out.filter((c) => c.verified === false).length;
  return {
    agree: yes + no ? Math.round((yes / (yes + no)) * 100) / 100 : null,
    verdict: yes + no === 0 ? 'unverifiable' : no ? 'differs' : 'agrees',
    claims: out,
  };
}

// Lotse's own text: every number, key, date, quarter, team and rank must stand in kpis / visual / evidence (directly).
export function selfCheck(story) {
  const texts = [story.headline, ...(story.findings || []).map((f) => f.text)];
  const bad = [];
  for (const s of texts) {
    const r = crossCheck(story, s, { derived: false, strict: true });
    for (const c of r.claims) if (c.verified !== true && c.kind !== 'week') bad.push({ sentence: s, claim: c.text, kind: c.kind, expected: c.expected });
  }
  return bad;
}
export { isoWeekNo };
