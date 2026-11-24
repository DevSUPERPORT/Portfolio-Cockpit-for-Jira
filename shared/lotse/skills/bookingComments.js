// Booking comments (Lotse's equivalent of the AI feature "myWeek"): a short worklog comment for every booked cell of
// the person's week that has none yet – drafted deterministically from the person's OWN Jira activity of that day on
// that task (shared/mineSuggest.js evidence: status changes, comments, links, other edits), otherwise from the task
// itself. Never overwrites a comment the person wrote; nothing is saved before the person confirms ("Meine Arbeit").
//
// draftComments({ cells, events }, lang) works on the same payload the AI gets (shared/aiPayload.js myWeekPayload) and
// returns the AI's result shape ({ text, comments: [{ cell, issueId, key, d, h, comment, previous, basis }] }).
import { weekOf } from '../../mine.js';
import { computedOf, newStory, kpi, ev, finding, action, follow, done, infoStory, r1, sum, T, say, personName, todayIso } from '../kit.js';
import { plural } from '../narrate.js';
import { weekData } from './myWeek.js';

const MAX_COMMENT = 200;
const short = (s, n = 48) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trim()}…` : t; };

// One comment from the day's events on the task: the last status change first, then comments, links, edits.
export function commentFor(cell, events, lang = 'de') {
  const L = lang === 'en' ? 'en' : 'de';
  const mine = (events || []).filter((e) => String(e.issueId) === String(cell.issueId) && e.d === cell.d);
  const st = mine.filter((e) => e.kind === 'status' && (e.to || e.from));
  const nC = mine.filter((e) => e.kind === 'comment').length;
  const nL = mine.filter((e) => e.kind === 'link').length;
  const nE = mine.filter((e) => e.kind === 'edit').length;
  const bits = [];
  let basis = 'task';
  if (st.length) {
    const a = st[0].from, b = st.at(-1).to;
    bits.push(a && b ? T(L, `Status ${a} → ${b}`, `Status ${a} → ${b}`) : T(L, `Status auf ${b || a}`, `Status to ${b || a}`));
    basis = 'status';
  }
  if (nC) { bits.push(T(L, nC === 1 ? 'Abstimmung im Kommentar' : `${nC} Kommentare zur Abstimmung`, nC === 1 ? 'alignment in a comment' : `${nC} comments for alignment`)); if (basis === 'task') basis = 'comment'; }
  if (nL) { bits.push(T(L, nL === 1 ? 'Abhängigkeit verknüpft' : `${nL} Verknüpfungen gepflegt`, nL === 1 ? 'dependency linked' : `${nL} links maintained`)); if (basis === 'task') basis = 'link'; }
  if (!bits.length && nE) { bits.push(T(L, 'Vorgang aktualisiert', 'Work item updated')); basis = 'edit'; }
  if (!bits.length) bits.push(cell.summary ? T(L, `Arbeit an „${short(cell.summary)}“`, `Work on "${short(cell.summary)}"`) : T(L, `Arbeit an ${cell.key}`, `Work on ${cell.key}`));
  const text = bits.join('; ');
  return { comment: (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, MAX_COMMENT), basis, counts: { status: st.length, comments: nC, links: nL, edits: nE } };
}

// The AI-shaped draft for a myWeek payload: one comment per booked cell without a comment.
export function draftComments({ cells = [], events = [] } = {}, lang = 'de') {
  const L = lang === 'en' ? 'en' : 'de';
  const list = (Array.isArray(cells) ? cells : []).filter((c) => c && c.issueId && c.d && c.h > 0);
  const comments = list.filter((c) => !String(c.comment || '').trim()).map((c) => {
    const x = commentFor(c, events, L);
    return { cell: `${c.issueId}|${c.d}`, issueId: String(c.issueId), key: c.key, d: c.d, h: r1(c.h), comment: x.comment, previous: '', basis: x.basis, counts: x.counts };
  });
  const total = sum(list, (c) => c.h);
  const tasks = new Set(list.map((c) => c.key)).size;
  const fromActivity = comments.filter((c) => c.basis !== 'task').length;
  const text = T(L, `Diese Woche: ${r1(total)} h auf ${tasks} ${plural(tasks, 'Aufgabe', 'Aufgaben')} gebucht; ${comments.length} ${plural(comments.length, 'Buchung', 'Buchungen')} ohne Kommentar – ${fromActivity} ${plural(fromActivity, 'Vorschlag stützt', 'Vorschläge stützen')} sich auf deine Jira-Aktivität.`,
    `This week: ${r1(total)} h booked on ${tasks} ${plural(tasks, 'task', 'tasks')}; ${comments.length} ${plural(comments.length, 'booking', 'bookings')} without a comment – ${fromActivity} ${plural(fromActivity, 'suggestion rests', 'suggestions rest')} on your Jira activity.`);
  return { text, comments, rejected: 0, source: 'lotse' };
}

// The booked cells of the week from the mine.week shape (worklogs carry their comment in c).
export function cellsOf(data, from, to) {
  const byId = new Map((data?.issues || []).map((i) => [String(i.id), i]));
  const cells = new Map();
  for (const w of data?.worklogs || []) {
    if (w.d < from || w.d > to) continue;
    const k = `${w.issueId}|${w.d}`;
    const c = cells.get(k) || cells.set(k, { issueId: String(w.issueId), d: w.d, h: 0, comment: '' }).get(k);
    c.h += w.h || 0;
    if (w.c) c.comment = c.comment ? `${c.comment} / ${w.c}` : w.c;
  }
  return [...cells.values()].filter((c) => c.h > 0 && byId.has(c.issueId)).sort((a, b) => a.d.localeCompare(b.d) || a.issueId.localeCompare(b.issueId))
    .map((c) => { const i = byId.get(c.issueId); return { ...c, key: i.key, summary: i.summary || null }; });
}

export default {
  id: 'bookingComments',
  title: (L) => T(L, 'Buchungskommentare', 'Booking comments'),
  params: ['person'],
  match: [/(kommentar|comment)[a-z]* .*(buchung|worklog|booking|gebucht|booked)|(buchung|worklog|booking)[a-z]* .*(kommentar|comment)/, /buchungskommentar|kommentare? (fuer|zu|in) (meine[nr]? )?(buchungen|worklogs?|stunden)|worklog ?comments?|booking comments?|comments? (for|on) my (bookings|worklogs|hours)|was habe ich (gemacht|getan)|what did i (do|work on)|wochentext|week text/],
  run(ctx, p, L) {
    computedOf(ctx);
    const me = p?.person || ctx.me?.id;
    if (!me) return infoStory(ctx, { skill: 'bookingComments', lang: L, subject: { kind: 'person', ref: null, name: T(L, 'Ich', 'Me') }, headline: T(L, 'Lotse weiß nicht, wer du bist.', 'Lotse does not know who you are.'), finding: T(L, 'Buchungskommentare gibt es nur für die eigenen Buchungen der angemeldeten Person.', 'Booking comments exist only for the signed-in person\'s own bookings.'),
      followUps: [follow(T(L, 'Heute für mich', 'Today for me'), T(L, 'Was ist heute wichtig?', 'What matters today?'))] });
    const today = todayIso(ctx);
    const wk = weekOf(today || new Date().toISOString().slice(0, 10));
    const data = ctx.mine?.from && ctx.mine?.issues ? ctx.mine : weekData(ctx, me, wk.from, wk.to);
    const from = data.from || wk.from, to = data.to || wk.to;
    const cells = cellsOf(data, from, to);
    const events = (ctx.evidence?.events || []).filter((e) => e.d >= from && e.d <= to);
    const name = personName(ctx, me) || T(L, 'Ich', 'Me');
    if (!cells.length) return infoStory(ctx, { skill: 'bookingComments', lang: L, subject: { kind: 'person', ref: `person:${me}`, name }, headline: T(L, 'Diese Woche gibt es noch keine Buchungen, die einen Kommentar brauchen.', 'There are no bookings this week that need a comment yet.'), finding: T(L, 'Sobald du Zeit buchst, schlägt Lotse zu jeder Buchung einen kurzen Kommentar aus deiner Jira-Aktivität vor.', 'As soon as you log time, Lotse suggests a short comment for each booking from your Jira activity.'),
      followUps: [follow(T(L, 'Meine Woche', 'My week'), T(L, 'Meine Woche', 'My week')), follow(T(L, 'Heute für mich', 'Today for me'), T(L, 'Was ist heute wichtig?', 'What matters today?'))] });
    const draft = draftComments({ cells, events }, L);
    const s = newStory(ctx, { skill: 'bookingComments', subject: { kind: 'person', ref: `person:${me}`, name }, lang: L });
    s.id = `bookingComments:${from}`;
    const F = s.fmt;
    const withC = cells.filter((c) => String(c.comment || '').trim()).length;
    const act = draft.comments.filter((c) => c.basis !== 'task').length;
    const task = draft.comments.length - act;
    const hours = r1(sum(cells, (c) => c.h));
    s.kpis.push(kpi('cells', T(L, 'Buchungen', 'Bookings'), cells.length, 'n', { tone: 'ink' }));
    s.kpis.push(kpi('drafts', T(L, 'Vorschläge', 'Suggestions'), draft.comments.length, 'n', { tone: draft.comments.length ? 'warn' : 'ok' }));
    s.kpis.push(kpi('activity', T(L, 'Aus Aktivität', 'From activity'), act, 'n'));
    s.kpis.push(kpi('hours', T(L, 'Gebucht', 'Logged'), hours, 'h'));
    s.visual = {
      kind: 'donut',
      data: { unit: 'n', total: cells.length, items: [{ label: T(L, 'mit Kommentar', 'with comment'), value: withC, tone: 'ok' }, { label: T(L, 'Vorschlag aus Aktivität', 'suggestion from activity'), value: act, tone: 'ink' }, { label: T(L, 'Vorschlag aus der Aufgabe', 'suggestion from the task'), value: task, tone: 'muted' }] },
      caption: T(L, 'Deine gebuchten Zellen dieser Woche: schon kommentiert, Vorschlag aus deiner Jira-Aktivität, Vorschlag aus der Aufgabe selbst.', 'Your booked cells this week: already commented, suggestion from your Jira activity, suggestion from the task itself.'),
    };
    if (draft.comments.length) {
      s.findings.push(finding(T(L, `${draft.comments.length} von ${cells.length} ${plural(cells.length, 'Buchung hat', 'Buchungen haben')} noch keinen Kommentar – Lotse schlägt für jede einen vor, ${act} davon aus deiner Jira-Aktivität.`, `${draft.comments.length} of ${cells.length} ${plural(cells.length, 'booking has', 'bookings have')} no comment yet – Lotse suggests one for each, ${act} of them from your Jira activity.`), 'warn', 80,
        [ev(T(L, 'ohne Kommentar', 'without comment'), draft.comments.length, 'n'), ev(T(L, 'Buchungen', 'bookings'), cells.length, 'n'), ev(T(L, 'aus Aktivität', 'from activity'), act, 'n')]));
      for (const c of [...draft.comments].sort((a, b) => (a.basis === 'task') - (b.basis === 'task') || b.h - a.h).slice(0, 2)) {
        const n = c.counts.comments > 1 ? [ev(T(L, 'Kommentare', 'comments'), c.counts.comments, 'n')] : [];
        const links = c.counts.links > 1 ? [ev(T(L, 'Verknüpfungen', 'links'), c.counts.links, 'n')] : [];
        s.findings.push(finding(T(L, `${c.key}, ${F.date(c.d)}: „${c.comment}“`, `${c.key}, ${F.date(c.d)}: "${c.comment}"`), 'info', c.basis === 'task' ? 30 : 50,
          [ev(T(L, 'gebucht', 'logged'), c.h, 'h', { key: c.key }), ev(T(L, 'Tag', 'day'), c.d, 'date'), ...n, ...links]));
      }
    } else s.findings.push(finding(T(L, `Alle ${cells.length} Buchungen dieser Woche haben schon einen Kommentar.`, `All ${cells.length} bookings of this week already have a comment.`), 'ok', 20, [ev(T(L, 'Buchungen', 'bookings'), cells.length, 'n')]));
    s.tone = draft.comments.length ? 'warn' : 'ok';
    s.headline = say(s.id, 'h', [
      T(L, `${draft.comments.length} Kommentarvorschläge für deine Woche – ${act} aus deiner Jira-Aktivität, nichts wird ohne deinen Klick gespeichert.`, `${draft.comments.length} comment suggestions for your week – ${act} from your Jira activity, nothing is saved without your click.`),
      T(L, `Deine Woche: ${cells.length} Buchungen, ${draft.comments.length} davon ohne Kommentar – Lotse hat Entwürfe.`, `Your week: ${cells.length} bookings, ${draft.comments.length} without a comment – Lotse has drafts.`)]);
    s.actions.push(action('book', T(L, 'In „Meine Arbeit“ prüfen', 'Review in "My work"'), 'navigate', { view: 'mine', week: from }, T(L, 'Öffnet „Meine Arbeit“ für diese Woche – dort werden die Kommentare einzeln übernommen, jeder mit Rückgängig.', 'Opens "My work" for this week – the comments are taken there one by one, each undoable.')));
    s.followUps.push(follow(T(L, 'Meine Woche', 'My week'), T(L, 'Meine Woche', 'My week')), follow(T(L, 'Was blockiert mich?', 'What blocks me?'), T(L, 'Was blockiert meine Aufgaben?', 'What blocks my tasks?')), follow(T(L, 'Heute für mich', 'Today for me'), T(L, 'Was ist heute wichtig?', 'What matters today?')));
    s.how = { text: T(L, 'Je gebuchter Zelle ohne Kommentar: deine Statuswechsel, Kommentare, Verknüpfungen und Änderungen an dieser Aufgabe an diesem Tag (wie „Woche vervollständigen“); ohne Aktivität der Titel der Aufgabe. Eigene Kommentare werden nie überschrieben.', 'Per booked cell without a comment: your status changes, comments, links and edits on that task that day (as in "complete the week"); without activity the task\'s title. Your own comments are never overwritten.'),
      inputs: [[T(L, 'Woche', 'Week'), `${F.date(from)} – ${F.date(to)}`], [T(L, 'Ereignisse', 'Events'), String(events.length)]] };
    s.confidence = act ? 'high' : 'medium';
    s.sources = ['Jira', T(L, 'Buchungen', 'Worklogs'), T(L, 'Deine Aktivität', 'Your activity')];
    s.entities.texts = [...new Set(cells.map((c) => c.summary).filter(Boolean).map((x) => String(x).slice(0, 100)))].slice(0, 20);
    if (!s.entities.texts.length) delete s.entities.texts;
    s.draft = draft;
    return done(s);
  },
};
