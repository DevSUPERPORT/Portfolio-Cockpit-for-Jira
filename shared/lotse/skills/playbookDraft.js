// Playbook draft (Lotse's equivalent of the AI feature "playbookDraft"): a help article and a standard reply for one
// recurring support topic, built from its tickets – the app template (shared/playbooks.js playbookTemplate), improved
// with what the tickets themselves say: the component / request type most of them share, how long they usually stay
// open, which team usually resolves them, and the example tickets to learn the fix from. Steps the data cannot know
// stay clearly marked placeholders in [brackets]. The reply never carries internal figures. Nothing is saved here.
//
// playbookOf(topic, { tickets, lang, teamName }) works on the AI's payload (topic + example tickets) or a full topic of
// shared/insights.js supportTopics and returns the AI's result shape ({ draft: { title, symptoms, steps, reply } }).
import { supportTopics, median } from '../../insights.js';
import { ticketsOf } from '../../ask.js';
import { playbookTemplate } from '../../playbooks.js';
import { computedOf, dsOf, newStory, kpi, ev, finding, action, follow, done, infoStory, r1, T, say, teamName as teamNameOf, todayIso } from '../kit.js';
import { plural } from '../narrate.js';

const KEY_RE = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0] || null;

// What the topic's tickets share: component / request type, resolution time, resolving team.
export function topicFacts(topic, tickets = []) {
  const ids = new Set((topic?.ids || []).map(String));
  const keys = new Set(topic?.exampleKeys || []);
  const mine = (tickets || []).filter((t) => t && (ids.has(String(t.id)) || keys.has(t.key)));
  const comp = new Map(), rt = new Map(), team = new Map();
  const hours = [];
  for (const t of mine) {
    for (const c of t.components || []) { const n = typeof c === 'string' ? c : c?.name; if (n) comp.set(n, (comp.get(n) || 0) + 1); }
    if (t.requestType) rt.set(t.requestType, (rt.get(t.requestType) || 0) + 1);
    if (t.resolved && t.created) {
      const h = (Date.parse(t.resolved) - Date.parse(t.created)) / 3600e3;
      if (Number.isFinite(h) && h >= 0) { hours.push(h); if (t.team?.id) team.set(t.team.id, (team.get(t.team.id) || 0) + 1); }
    }
  }
  const c = top(comp), r = top(rt), tm = top(team);
  return {
    n: mine.length, resolved: hours.length,
    component: c && c[1] * 2 >= mine.length ? { name: c[0], n: c[1] } : null,
    requestType: r && r[1] * 2 >= mine.length ? { name: r[0], n: r[1] } : null,
    medianHours: hours.length ? r1(median(hours)) : null,
    team: tm && tm[1] * 2 >= hours.length ? { id: tm[0], n: tm[1] } : null,
  };
}

export function playbookOf(topic, { tickets = [], lang = 'de', teamName = (id) => id } = {}) {
  const L = lang === 'en' ? 'en' : 'de';
  const base = playbookTemplate(topic, { tickets, lang: L });
  const f = topicFacts(topic, tickets);
  const ex = (base.keys || []).filter((k) => KEY_RE.test(k)).slice(0, 2);
  const steps = [base.steps[0]];
  if (f.component) steps.push(T(L, `Komponente „${f.component.name}“ prüfen – betrifft ${f.component.n} von ${f.n} Tickets.`, `Check the component "${f.component.name}" – it affects ${f.component.n} of ${f.n} tickets.`));
  else if (f.requestType) steps.push(T(L, `Anfrageart „${f.requestType.name}“ prüfen – ${f.requestType.n} von ${f.n} Tickets.`, `Check the request type "${f.requestType.name}" – ${f.requestType.n} of ${f.n} tickets.`));
  else steps.push(base.steps[1]);
  steps.push(ex.length ? T(L, `[Lösungsschritt ergänzen – was hat in ${ex.join(' und ')} geholfen?]`, `[Add the fix – what helped in ${ex.join(' and ')}?]`) : base.steps[2]);
  steps.push(base.steps[3]);
  if (f.team) {
    const tn = teamName(f.team.id) || f.team.id;
    steps.push(f.medianHours != null ? T(L, `Nach mehr als ${f.medianHours} h offen (so lange dauert es typisch) an Team ${tn} geben – es löste ${f.team.n} von ${f.resolved}.`, `Open for more than ${f.medianHours} h (the typical time): hand to team ${tn} – it resolved ${f.team.n} of ${f.resolved}.`)
      : T(L, `Bei Bedarf an Team ${tn} geben – es löste ${f.team.n} von ${f.resolved}.`, `If needed, hand to team ${tn} – it resolved ${f.team.n} of ${f.resolved}.`));
  } else if (f.medianHours != null) steps.push(T(L, `Typisch nach ${f.medianHours} h gelöst – länger offen: [an wen eskalieren?]`, `Typically resolved after ${f.medianHours} h – open longer: [escalate to whom?]`));
  else steps.push(base.steps[4]);
  return { draft: { title: base.title, symptoms: base.symptoms, steps: steps.slice(0, 6), reply: base.reply }, facts: f, reasoning: base.why, confidence: f.n >= 5 ? 'medium' : 'low', source: 'lotse', keys: base.keys };
}

export default {
  id: 'playbookDraft',
  title: (L) => T(L, 'Playbook-Entwurf', 'Playbook draft'),
  params: ['topic'],
  match: [/(entw|draft|schreib|write|erstell|formulier)[a-z]* .*(playbook|standard ?antwort|standard (reply|answer)|hilfe ?artikel|help article)|(playbook|standard ?antwort|hilfe ?artikel)[a-z]* .*(entw|draft|schreib|formulier)/, /playbook ?(entwurf|entwerfen|schreiben|vorschlag|erstellen)|(entwirf|schreib|erstelle) (ein|mir ein|uns ein)?\s?playbook|draft (a |the )?playbook|write (a |the )?playbook|standard ?antwort (entwerfen|schreiben|formulieren)|(draft|write) (a |the )?standard (reply|answer)|hilfe ?artikel (entwerfen|schreiben)|(draft|write) (a |the )?help article/],
  run(ctx, p, L) {
    computedOf(ctx);
    const tickets = ticketsOf({ ...ctx, ds: dsOf(ctx) });
    if (!tickets.length) return infoStory(ctx, { skill: 'playbookDraft', lang: L, subject: { kind: 'topic', ref: 'support', name: 'Support' }, headline: T(L, 'Für einen Playbook-Entwurf sind keine Support-Tickets geladen.', 'No support tickets are loaded for a playbook draft.'), finding: T(L, 'Ein Playbook entsteht aus wiederkehrenden Tickets der Service-Projekte.', 'A playbook comes from recurring tickets of the service projects.'),
      followUps: [follow(T(L, 'Support-Themen', 'Support topics'), T(L, 'Welche Support-Themen kommen immer wieder?', 'Which support topics keep coming back?'))] });
    const st = supportTopics(tickets, { minCount: 3, lang: L, today: todayIso(ctx) });
    const topic = (p?.topic && st.topics.find((x) => x.id === p.topic)) || st.topics.find((x) => x.playbook) || st.topics[0];
    if (!topic) return infoStory(ctx, { skill: 'playbookDraft', lang: L, subject: { kind: 'topic', ref: 'support', name: 'Support' }, headline: T(L, `In ${st.tickets} Tickets kommt kein Thema wieder – kein Playbook nötig.`, `No topic recurs in ${st.tickets} tickets – no playbook needed.`), finding: T(L, 'Ein Playbook lohnt sich ab drei Tickets zum selben Thema.', 'A playbook pays off from three tickets on the same topic.'), evidence: [ev(T(L, 'Tickets', 'tickets'), st.tickets, 'n')],
      followUps: [follow(T(L, 'Support-Themen', 'Support topics'), T(L, 'Welche Support-Themen kommen immer wieder?', 'Which support topics keep coming back?'))] });
    const { model } = computedOf(ctx);
    const pb = playbookOf(topic, { tickets, lang: L, teamName: (id) => teamNameOf(model, id) });
    const f = pb.facts;
    const s = newStory(ctx, { skill: 'playbookDraft', subject: { kind: 'topic', ref: topic.id.slice(0, 140), name: topic.name.slice(0, 100) }, lang: L });
    const F = s.fmt;
    s.entities.texts = [topic.name.slice(0, 100), ...(f.component ? [f.component.name] : []), ...(f.requestType ? [f.requestType.name] : [])];
    const tn = f.team ? teamNameOf(model, f.team.id) : null;
    if (tn) s.entities.teams.push({ id: f.team.id, name: tn });
    const placeholders = pb.draft.steps.filter((x) => /\[[^\]]+\]/.test(x)).length;
    s.kpis.push(kpi('tickets', T(L, 'Tickets im Thema', 'Tickets in topic'), topic.count, 'n', { tone: 'ink' }));
    s.kpis.push(kpi('hours', T(L, 'Support-Zeit', 'Support time'), topic.spentTotal, 'h', { tone: topic.trend === 'rising' ? 'warn' : undefined }));
    s.kpis.push(kpi('steps', T(L, 'Schritte', 'Steps'), pb.draft.steps.length, 'n'));
    s.kpis.push(kpi('open', T(L, 'Noch zu ergänzen', 'Still to fill in'), placeholders, 'n', { tone: placeholders ? 'warn' : 'ok' }));
    s.visual = {
      kind: 'donut',
      data: { unit: 'n', total: pb.draft.steps.length, items: [{ label: T(L, 'aus den Tickets', 'from the tickets'), value: pb.draft.steps.length - placeholders, tone: 'ink' }, { label: T(L, 'zu ergänzen', 'to fill in'), value: placeholders, tone: 'warn' }] },
      caption: T(L, 'Die Schritte des Entwurfs: was Lotse aus den Tickets weiß, und was ihr in [Klammern] ergänzt.', 'The draft\'s steps: what Lotse knows from the tickets, and what you fill in [brackets].'),
    };
    s.findings.push(finding(T(L, `„${topic.name}“: ${topic.count} Tickets, zusammen ${F.h(topic.spentTotal)} – Entwurf mit ${pb.draft.symptoms.length} Symptomen und ${pb.draft.steps.length} Schritten.`, `"${topic.name}": ${topic.count} tickets, ${F.h(topic.spentTotal)} in total – a draft with ${pb.draft.symptoms.length} symptoms and ${pb.draft.steps.length} steps.`), topic.trend === 'rising' ? 'warn' : 'info', 80,
      [ev(T(L, 'Tickets', 'tickets'), topic.count, 'n'), ev(T(L, 'Zeit', 'time'), topic.spentTotal, 'h'), ev(T(L, 'Symptome', 'symptoms'), pb.draft.symptoms.length, 'n'), ...topic.exampleKeys.slice(0, 3).map((k) => ev(T(L, 'Beispiel', 'example'), undefined, null, { key: k }))]));
    if (f.component || f.requestType) {
      const x = f.component || f.requestType;
      s.findings.push(finding(T(L, `${x.n} von ${f.n} Tickets betreffen „${x.name}“ – das ist der erste Prüfschritt.`, `${x.n} of ${f.n} tickets concern "${x.name}" – that is the first check.`), 'info', 60, [ev(x.name, x.n, 'n'), ev(T(L, 'Tickets', 'tickets'), f.n, 'n')]));
    }
    if (f.team && tn) s.findings.push(finding(T(L, `Team ${tn} löste ${f.team.n} von ${f.resolved}${f.medianHours != null ? `, typisch nach ${F.h(f.medianHours, 1)}` : ''} – dorthin eskalieren.`, `Team ${tn} resolved ${f.team.n} of ${f.resolved}${f.medianHours != null ? `, typically after ${F.h(f.medianHours, 1)}` : ''} – escalate there.`), 'info', 50,
      [ev(T(L, 'gelöst von Team', 'resolved by team'), f.team.n, 'n', { ref: f.team.id }), ev(T(L, 'gelöst', 'resolved'), f.resolved, 'n'), ...(f.medianHours != null ? [ev(T(L, 'typische Dauer', 'typical time'), f.medianHours, 'h')] : [])]));
    if (placeholders) s.findings.push(finding(T(L, `${placeholders} ${plural(placeholders, 'Schritt bleibt', 'Schritte bleiben')} in [Klammern] – das weiß nur euer Support-Team.`, `${placeholders} ${plural(placeholders, 'step stays', 'steps stay')} in [brackets] – only your support team knows that.`), 'warn', 40, [ev(T(L, 'zu ergänzen', 'to fill in'), placeholders, 'n')]));
    s.tone = topic.trend === 'rising' ? 'warn' : 'info';
    s.headline = say(s.id, 'h', [
      T(L, `Playbook-Entwurf für „${topic.name}“: ${pb.draft.steps.length} Schritte und eine Standardantwort aus ${topic.count} Tickets.`, `Playbook draft for "${topic.name}": ${pb.draft.steps.length} steps and a standard reply from ${topic.count} tickets.`),
      T(L, `„${topic.name}“ kam ${topic.count}-mal – Lotse hat einen Hilfeartikel mit ${pb.draft.steps.length} Schritten entworfen.`, `"${topic.name}" came up ${topic.count} times – Lotse drafted a help article with ${pb.draft.steps.length} steps.`)]);
    s.actions.push(action('playbook', T(L, 'Als Playbook anlegen', 'Create as playbook'), 'navigate', { view: 'support', tab: 'playbooks', topicId: topic.id }, T(L, `Öffnet die Playbooks mit dem Entwurf „${pb.draft.title}“ – gespeichert wird erst per Klick, mit Rückgängig.`, `Opens the playbooks with the draft "${pb.draft.title}" – saved only on click, undoable.`)));
    s.followUps.push(follow(T(L, 'Support-Themen', 'Support topics'), T(L, 'Welche Support-Themen kommen immer wieder?', 'Which support topics keep coming back?')), follow(T(L, 'Tickets verteilen', 'Dispatch'), T(L, 'Wer soll die neuen Tickets bekommen?', 'Who should take the new tickets?')), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')));
    s.how = { text: T(L, 'Symptome = die häufigsten Ticket-Titel des Themas. Schritte: Abgleich, die gemeinsame Komponente oder Anfrageart (ab der Hälfte der Tickets), die Beispiel-Tickets für die Lösung, Standardantwort, Eskalation an das Team, das die meisten gelöst hat. Die Antwort an Kunden enthält keine internen Zahlen.', 'Symptoms = the topic\'s most frequent ticket titles. Steps: check, the shared component or request type (from half of the tickets), the example tickets for the fix, standard reply, escalation to the team that resolved most. The reply to customers carries no internal figures.'),
      inputs: [[T(L, 'Thema', 'Topic'), topic.name.slice(0, 100)], [T(L, 'Tickets', 'Tickets'), String(topic.count)]] };
    s.confidence = pb.confidence;
    s.sources = ['Jira Service Management', T(L, 'Verlauf', 'History')];
    s.draft = { draft: pb.draft, reasoning: pb.reasoning, confidence: pb.confidence, source: 'lotse' };
    return done(s);
  },
};
