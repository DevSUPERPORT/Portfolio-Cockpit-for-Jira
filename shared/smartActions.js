// Smart actions: what the cockpit can DO from one sentence (German or English), what an assistant's actions would
// do – without any AI. parseAction() only reads and explains; nothing happens until the person confirms, and every
// action runs through the app's normal permission-checked writes and can be undone.
import { fold, fixTypos, findProject, findTeam } from './ask.js';
import { roughUnits } from './engine.js';
import { dayIdx, ymdIdx, isoOf, dow, isWeekday } from './dates.js';

const T = (lang, de, en) => (lang === 'de' ? de : en);
const HEALTH = [['onTrack', /im plan|on track|gruen|green|\bok\b|gut\b|good/], ['atRisk', /gefaehrdet|at risk|gelb|yellow|riskant|risky/], ['critical', /kritisch|critical|\brot\b|\bred\b/]];
const hName = (s, L) => ({ onTrack: T(L, 'Im Plan', 'On track'), atRisk: T(L, 'Gefährdet', 'At risk'), critical: T(L, 'Kritisch', 'Critical') }[s]);

// The original wording after the first ":" or " – " is the comment (kept as typed, not folded).
function commentOf(text) {
  const m = /\s*(?::|–|—| - )\s*(.+)$/.exec(text);
  return m ? m[1].trim().slice(0, 300) : '';
}

// ---------- dates in plain words (DE/EN) → a day index; always shown back as a full date before anything happens ----------
const WEEKDAYS = [['sonntag', 'sunday', 'sun'], ['montag', 'monday', 'mon'], ['dienstag', 'tuesday', 'tue'], ['mittwoch', 'wednesday', 'wed'], ['donnerstag', 'thursday', 'thu'], ['freitag', 'friday', 'fri'], ['samstag', 'saturday', 'sat']];
const MONTHS = [['januar', 'january', 'jan', 'jaenner'], ['februar', 'february', 'feb'], ['maerz', 'march', 'mar', 'mrz'], ['april', 'apr'], ['mai', 'may'], ['juni', 'june', 'jun'], ['juli', 'july', 'jul'], ['august', 'aug'], ['september', 'sept', 'sep'], ['oktober', 'october', 'okt', 'oct'], ['november', 'nov'], ['dezember', 'december', 'dez', 'dec']];
const monthOf = (w) => MONTHS.findIndex((m) => m.includes(w));
const MONTH_RE = MONTHS.flat().sort((a, b) => b.length - a.length).join('|');
export const localToday = (now = new Date()) => ymdIdx(now.getFullYear(), now.getMonth() + 1, now.getDate());
const validYmd = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
// a date without a year: this year, or next year once it has passed
function nextYmd(today, m, d) {
  const y = new Date(today * 864e5).getUTCFullYear();
  for (const yy of [y, y + 1]) if (validYmd(yy, m, d) && ymdIdx(yy, m, d) >= today) return ymdIdx(yy, m, d);
  return null;
}
const fullYear = (y) => (y < 100 ? 2000 + y : y);
export function parseDay(q, today) {
  let m;
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(q))) return validYmd(+m[1], +m[2], +m[3]) ? ymdIdx(+m[1], +m[2], +m[3]) : null;
  if ((m = /(?:^|[^\d.])(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?![\d.])/.exec(q))) {
    if (m[3]) { const y = fullYear(+m[3]); return validYmd(y, +m[2], +m[1]) ? ymdIdx(y, +m[2], +m[1]) : null; }
    return nextYmd(today, +m[2], +m[1]);
  }
  const dm = new RegExp(`\\b(\\d{1,2})\\.?\\s+(${MONTH_RE})\\b\\.?(?:\\s+(\\d{4}))?`).exec(q);
  const md = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b,?(?:\\s+(\\d{4}))?`).exec(q);
  const hit = dm ? { d: +dm[1], mo: monthOf(dm[2]) + 1, y: dm[3] } : md ? { d: +md[2], mo: monthOf(md[1]) + 1, y: md[3] } : null;
  if (hit) return hit.y ? (validYmd(+hit.y, hit.mo, hit.d) ? ymdIdx(+hit.y, hit.mo, hit.d) : null) : nextYmd(today, hit.mo, hit.d);
  if (/\b(uebermorgen|day after tomorrow)\b/.test(q)) return today + 2;
  if (/\b(morgen|tomorrow)\b/.test(q)) return today + 1;
  if (/\b(heute|today)\b/.test(q)) return today;
  if ((m = /\bin\s+(\d{1,3})\s+(tag(?:en)?|days?|wochen?|weeks?)\b/.exec(q))) return today + +m[1] * (m[2][0] === 'w' ? 7 : 1);
  if (/\b(ende (der|dieser) woche|end of (the |this )?week)\b/.test(q)) { let d = today; while (dow(d) !== 5) d++; return d; }
  if (/\b(monatsende|ende (des|dieses) monats|end of (the |this )?month)\b/.test(q)) { const t = new Date(today * 864e5); return ymdIdx(t.getUTCFullYear(), t.getUTCMonth() + 2, 1) - 1; }
  if (/\b(quartalsende|ende (des|dieses) quartals|end of (the |this )?quarter)\b/.test(q)) { const t = new Date(today * 864e5); return ymdIdx(t.getUTCFullYear(), Math.floor(t.getUTCMonth() / 3) * 3 + 4, 1) - 1; }
  const wd = WEEKDAYS.findIndex((names) => names.some((n) => new RegExp(`\\b${n}\\b`).test(q)));
  if (wd >= 0) { let d = today + 1; while (dow(d) !== wd) d++; return d; } // the next one, never today
  return null;
}
export function fmtDay(idx, lang = 'de') {
  if (idx == null) return '';
  return new Date(idx * 864e5).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { weekday: 'short', day: lang === 'de' ? '2-digit' : 'numeric', month: lang === 'de' ? '2-digit' : 'short', year: 'numeric', timeZone: 'UTC' });
}

// work items named by key ("PCX-47"): only what the cockpit has loaded – nothing outside its scope is ever changed
const KEY_RE = /\b([A-Za-z][A-Za-z0-9_]{0,9}-\d{1,7})\b/g;
const keysIn = (raw) => [...new Set([...raw.matchAll(KEY_RE)].map((m) => m[1].toUpperCase()))];
function byKey(model, key) {
  const issue = (model.ds.issues || []).find((i) => i.key === key);
  if (issue) return { kind: 'issue', issue };
  const item = model.items.find((p) => p.key === key);
  if (item) return { kind: 'item', item };
  const ext = [...model.external.values()].find((x) => x.key === key);
  return ext ? { kind: 'external', issue: ext } : null;
}

function dueAction(raw, model, L, today) {
  if (/\?\s*$/.test(raw)) return null; // a question about due dates belongs to Ask
  const q = fold(raw);
  if (!/\b(due|faellig\w*|faelligkeit\w*|deadline|frist|enddatum|end ?date|termin)\b/.test(q)) return null;
  const keys = keysIn(raw);
  let target = null, name = '', prev = null, itemDue = null;
  if (keys.length) {
    const hit = byKey(model, keys[0]);
    if (!hit || hit.kind === 'external') return { kind: 'due', ok: false, label: T(L, `Fälligkeit für ${keys[0]}`, `Due date for ${keys[0]}`), detail: T(L, `${keys[0]} ist nicht im Cockpit (nicht im Portfolio-Umfang) – nichts wird geändert.`, `${keys[0]} is not in the cockpit (outside the portfolio scope) – nothing will change.`) };
    if (hit.kind === 'issue') { target = { issueId: hit.issue.id }; name = hit.issue.key; prev = hit.issue.due || null; itemDue = model.itemByRef.get(hit.issue.rootRef)?.due || null; }
    else { const it = hit.item; target = it.kind === 'space' ? { ref: it.ref } : { issueId: it.id }; name = it.name; prev = it.due || null; }
  } else {
    const project = findProject(fixTypos(q), model);
    if (!project) return null;
    target = project.kind === 'space' ? { ref: project.ref } : { issueId: project.id };
    name = project.name; prev = project.due || null;
  }
  const day = parseDay(q.replace(KEY_RE, ' '), today);
  if (day == null && !keys.length) return null; // no key and no date: most likely a question, not an action
  const label = T(L, `Fälligkeit von ${name}${day != null ? ` auf ${fmtDay(day, L)}` : ''} setzen`, `Set the due date of ${name}${day != null ? ` to ${fmtDay(day, L)}` : ''}`);
  if (day == null) return { kind: 'due', ...target, ok: false, label, detail: T(L, 'Welches Datum? z. B. „auf Freitag“, „15.12.“, „in 2 Wochen“, „Monatsende“.', 'Which date? e.g. "to Friday", "Dec 15", "in 2 weeks", "end of month".') };
  if (day < today) return { kind: 'due', ...target, ok: false, label, detail: T(L, 'Das Datum liegt in der Vergangenheit – nichts wird geändert.', 'That date is in the past – nothing will change.') };
  const iso = isoOf(day);
  if (prev === iso) return { kind: 'due', ...target, value: iso, ok: false, label, detail: T(L, 'Steht schon auf diesem Datum.', 'Already set to that date.') };
  const notes = [prev ? T(L, `Bisher: ${fmtDay(dayIdx(prev), L)}`, `Currently: ${fmtDay(dayIdx(prev), L)}`) : T(L, 'Bisher kein Fälligkeitsdatum', 'No due date yet')];
  if (!isWeekday(day)) notes.push(T(L, 'Achtung: Wochenende', 'Note: weekend'));
  if (itemDue && dayIdx(itemDue) < day) notes.push(T(L, `liegt nach dem Projekttermin ${fmtDay(dayIdx(itemDue), L)}`, `after the project due date ${fmtDay(dayIdx(itemDue), L)}`));
  return { kind: 'due', ...target, key: keys[0] || null, name, value: iso, when: fmtDay(day, L), ok: true, label, detail: notes.join(' · ') };
}

// "PCX-12 blockiert PCX-47" / "PCX-47 hängt ab von PCX-12" – with the configured dependency link type, as the person
function linkAction(raw, model, L) {
  const keys = keysIn(raw);
  if (keys.length !== 2) return null;
  const q = fold(raw);
  const passive = /\b(wird blockiert|is blocked by|blocked by)\b/.test(q);
  const blocks = !passive && /\b(blockiert|blocks|blockt|ist voraussetzung fuer|is a prerequisite (for|of)|muss vor)\b/.test(q);
  const waits = passive || /\b(haengt ab von|abhaengig von|depends on|dependent on|wartet auf|waits (on|for)|braucht|needs)\b/.test(q);
  if (!blocks && !waits) return null;
  const [a, b] = keys;
  const [preKey, depKey] = blocks ? [a, b] : [b, a];
  const label = T(L, `Abhängigkeit: ${preKey} blockiert ${depKey}`, `Dependency: ${preKey} blocks ${depKey}`);
  const no = (de, en) => ({ kind: 'link', ok: false, preKey, depKey, label, detail: T(L, de, en) });
  const types = (model.cfg.dependencies?.linkTypeIds || []).map(String);
  if (!types.length) return no('Kein Verknüpfungstyp für Abhängigkeiten konfiguriert (Konfiguration → Abhängigkeiten).', 'No link type configured for dependencies (Configuration → Dependencies).');
  const pre = byKey(model, preKey), dep = byKey(model, depKey);
  const miss = [[preKey, pre], [depKey, dep]].filter(([, h]) => !h || h.kind === 'item').map(([k]) => k);
  if (miss.length) return no(`${miss.join(', ')} nicht im Cockpit gefunden – nichts wird geändert.`, `${miss.join(', ')} not found in the cockpit – nothing will change.`);
  if (pre.kind === 'external' && dep.kind === 'external') return no('Mindestens eines der beiden muss im Portfolio-Umfang liegen.', 'At least one of the two must be in the portfolio scope.');
  const P = pre.issue, D = dep.issue;
  const reversed = new Set((model.cfg.dependencies?.reversedLinkTypeIds || []).map(String));
  const pairs = [P, D].flatMap((x) => (x.links || []).filter((l) => types.includes(String(l.typeId))).map((l) => {
    const fwd = reversed.has(String(l.typeId)) ? !l.outward : l.outward;
    return fwd ? [x.id, l.otherId] : [l.otherId, x.id];
  }));
  if (pairs.some(([x, y]) => x === P.id && y === D.id)) return no('Diese Abhängigkeit besteht schon.', 'This dependency already exists.');
  if (pairs.some(([x, y]) => x === D.id && y === P.id)) return no(`${depKey} blockiert schon ${preKey} – das wäre ein Kreis.`, `${depKey} already blocks ${preKey} – that would be a cycle.`);
  const pd = dayIdx(P.due), sd = dayIdx(D.start);
  const detail = [`${preKey} ${(P.summary || '').slice(0, 40)} → ${depKey} ${(D.summary || '').slice(0, 40)}`];
  if (pd != null && sd != null && pd > sd) detail.push(T(L, `Konflikt: ${preKey} endet ${fmtDay(pd, L)}, ${depKey} startet ${fmtDay(sd, L)}`, `Conflict: ${preKey} ends ${fmtDay(pd, L)}, ${depKey} starts ${fmtDay(sd, L)}`));
  return { kind: 'link', preId: P.id, depId: D.id, preKey, depKey, typeId: types[0], ok: true, label, detail: detail.join(' · ') };
}

export function parseAction(text, { model, sizes = [], lang = 'de', today = localToday() } = {}) {
  const raw = String(text || '').trim();
  if (raw.length < 6 || !model) return null;
  // sentences that name work items by key come first: a key would otherwise be read as a project name
  const link = linkAction(raw, model, lang);
  if (link) return link;
  const due = dueAction(raw, model, lang, today);
  if (due) return due;
  const head = raw.split(/\s*(?::|–|—| - )\s*/)[0];
  const q = fixTypos(fold(head).replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim());
  const L = lang;
  const project = findProject(q, model);

  // Health: "setze X auf gefährdet: …" / "set X to at risk: …" / "mark X critical"
  if (/^(setze?|stell\w*|set|mark|markier\w*|health)\b/.test(q) || /\bhealth\b/.test(q)) {
    const status = HEALTH.find(([, re]) => re.test(q))?.[0];
    if (project && status) {
      const comment = commentOf(raw);
      return {
        kind: 'health', ref: project.ref, status, comment, ok: comment.length > 0,
        label: T(L, `Health von ${project.name} auf „${hName(status, L)}“ setzen`, `Set the health of ${project.name} to "${hName(status, L)}"`),
        detail: comment ? `„${comment}“` : T(L, 'Bitte einen Kommentar nach „:“ anfügen (ein Satz).', 'Please add a comment after ":" (one sentence).'),
      };
    }
  }
  // Rank: "ERP auf Rang 2" / "move ERP to rank 2" / "ERP nach ganz oben" / "ERP to the top"
  const rankM = /\b(?:auf|to|nach)\s+(?:den\s+)?(?:rang|rank|platz|position)\s*#?(\d{1,3})\b|#(\d{1,3})\s*$/.exec(q);
  const top = /(nach |ganz )?(oben|top)\b|an die spitze|to the top|first place/.test(q);
  if (project && (rankM || top) && /rang|rank|platz|position|move|schieb|verschieb|oben|top|spitze|first/.test(q)) {
    const n = model.items.length;
    const to = Math.min(n, Math.max(1, top ? 1 : +(rankM[1] || rankM[2])));
    return {
      kind: 'rank', ref: project.ref, to, ok: project.rank !== to,
      label: T(L, `${project.name} von Rang ${project.rank} auf Rang ${to}`, `Move ${project.name} from rank ${project.rank} to rank ${to}`),
      detail: project.rank === to ? T(L, 'Steht schon dort.', 'Already there.') : T(L, 'Die Wasserlinie rechnet sofort neu.', 'The waterline recalculates at once.'),
    };
  }
  // Team for every story without a team: "Team Web für alle Stories ohne Team (in X)"
  if (/(ohne team|without (a )?team|no team)/.test(q)) {
    const team = findTeam(q.replace(/(ohne team|without (a )?team|no team)/, ' '), model);
    // a named scope ("… in X") that is not a known project: refuse instead of widening to every project
    // read from the original sentence, so the message quotes the person's own spelling
    const scope = /(?:^|\s)(?:in|im|bei|for project|für projekt|fuer projekt)\s+([\p{L}\p{N}][\p{L}\p{N}\s_-]{1,60})$/iu.exec(head.replace(/[?!.]+$/, '').replace(/(ohne team|without (a )?team|no team)/i, ' ').trim());
    if (team && scope && !project) {
      return { kind: 'teamFill', teamId: team.id, ref: null, issueIds: [], ok: false,
        label: T(L, `Team ${team.name} für Stories ohne Team in „${scope[1].trim()}“`, `Team ${team.name} for stories without a team in "${scope[1].trim()}"`),
        detail: T(L, `Kein Projekt „${scope[1].trim()}“ gefunden – nichts wird geändert.`, `No project "${scope[1].trim()}" found – nothing will change.`) };
    }
    if (team) {
      const stories = (model.ds.issues || []).filter((i) => i.role === 'estimate' && !i.team && (i.status?.cat ?? 'new') !== 'done' && (!project || i.rootRef === project.ref));
      return {
        kind: 'teamFill', teamId: team.id, ref: project?.ref || null, issueIds: stories.map((i) => i.id), ok: stories.length > 0,
        label: T(L, `Team ${team.name} für ${stories.length} offene Stories ohne Team${project ? ` in ${project.name}` : ''} setzen`, `Set team ${team.name} on ${stories.length} open stories without a team${project ? ` in ${project.name}` : ''}`),
        detail: stories.length ? stories.slice(0, 4).map((i) => i.key).join(', ') + (stories.length > 4 ? ` … +${stories.length - 4}` : '') : T(L, 'Keine offenen Stories ohne Team.', 'No open stories without a team.'),
      };
    }
  }
  // T-shirt size: "T-Shirt M für X" / "size L for X" / "X Größe S"
  const sizeKeys = sizes.map((s) => fold(String(s.key)));
  const sizeM = /\b(?:t-?shirt(?: size)?|groesse|size)\s+([a-z]{1,3})\b|\b([a-z]{1,3})\s+(?:als\s+)?(?:t-?shirt|groesse|size)\b/.exec(q);
  const size = sizeM ? (sizeM[1] || sizeM[2]) : null;
  if (project && size && sizeKeys.includes(size)) {
    const key = sizes[sizeKeys.indexOf(size)].key;
    const hours = sizes[sizeKeys.indexOf(size)].hours;
    // the size belongs on the project only when it carries the rough estimate itself (epics as portfolio items)
    const onItem = !!roughUnits(model, project)[0]?.isItem;
    if (!onItem) return { kind: 'tshirt', ref: project.ref, size: key, ok: false, label: T(L, `T-Shirt Size für ${project.name}`, `T-shirt size for ${project.name}`), detail: T(L, 'Die T-Shirt Size gehört hier auf die Epics darunter – Datenqualität zeigt sie mit Vorschlag.', 'Here the T-shirt size belongs on the epics below – Data quality lists them with a suggestion.') };
    return {
      kind: 'tshirt', ref: project.ref, size: key, ok: true,
      label: T(L, `T-Shirt Size ${key} (${hours} h) für ${project.name} setzen`, `Set T-shirt size ${key} (${hours} h) for ${project.name}`),
      detail: project.tshirt ? T(L, `Bisher: ${project.tshirt}`, `Currently: ${project.tshirt}`) : T(L, 'Bisher keine T-Shirt Size – danach gibt es eine Reife.', 'No T-shirt size yet – afterwards there is a maturity.'),
    };
  }
  return null;
}
