// Recurring support topics (shared/insights.js supportTopics) and, for the top candidate, a playbook to start from
// (shared/playbooks.js playbookTemplate). Topic names come from ticket summaries: they are listed in entities.texts so
// the AI only sees them when the admin allows texts.
import { supportTopics } from '../../insights.js';
import { ticketsOf } from '../../ask.js';
import { playbookTemplate } from '../../playbooks.js';
import { dsOf, newStory, kpi, ev, finding, action, follow, done, infoStory, sum, r1, T, say, worst, todayIso } from '../kit.js';
import { plural } from '../narrate.js';

const TREND = { rising: ['steigend', 'rising'], falling: ['fallend', 'falling'], stable: ['stabil', 'stable'], new: ['neu', 'new'] };

export default {
  id: 'supportTopics',
  title: (L) => T(L, 'Wiederkehrende Support-Themen', 'Recurring support topics'),
  params: ['playbook'],
  match: [/wiederkehrend|recurring|immer (wieder )?(die )?gleiche|haeufig(ste)?n? (support|ticket|fragen|themen|probleme)|(most )?(common|frequent|repeated) (support|tickets?|issues?|questions?|topics?)|playbooks?|hilfe ?artikel|help ?articles?|\bfaq\b|standard ?antwort|standard (reply|answer)|support[- ]?themen|support topics|(anfragen|tickets|fragen|themen|probleme) wiederholen sich|wiederholen sich (immer|oft|staendig)|(repeat(ing|ed)?|recurring) (requests|questions|tickets)/],
  run(ctx, p, L) {
    const tickets = ticketsOf({ ...ctx, ds: dsOf(ctx) });
    if (!tickets.length) return infoStory(ctx, { skill: 'supportTopics', lang: L, subject: { kind: 'topic', ref: 'support', name: 'Support' }, headline: T(L, 'Es sind keine Support-Tickets geladen.', 'No support tickets are loaded.'), finding: T(L, 'Wiederkehrende Themen braucht gelöste Tickets aus dem Verlauf oder offene Tickets der Service-Projekte.', 'Recurring topics need resolved tickets from the history or open tickets of the service projects.') });
    const st = supportTopics(tickets, { minCount: 3, lang: L, today: todayIso(ctx) });
    const s = newStory(ctx, { skill: 'supportTopics', subject: { kind: 'topic', ref: 'support', name: 'Support' }, lang: L });
    const F = s.fmt;
    s.entities.texts = [];
    const pb = st.topics.filter((x) => x.playbook);
    const pbHours = sum(pb, (x) => x.spentTotal);
    s.kpis.push(kpi('topics', T(L, 'Themen', 'Topics'), st.topics.length, 'n', { tone: 'ink' }));
    s.kpis.push(kpi('playbooks', T(L, 'Playbook-Kandidaten', 'Playbook candidates'), pb.length, 'n', { tone: pb.length ? 'warn' : 'ok' }));
    s.kpis.push(kpi('hours', T(L, 'Zeit in Kandidaten', 'Time in candidates'), pbHours, 'h'));
    s.kpis.push(kpi('tickets', T(L, 'Tickets', 'Tickets'), st.tickets, 'n'));
    if (!st.topics.length) {
      s.visual = { kind: 'donut', data: { unit: 'n', total: st.tickets, items: [{ label: T(L, 'Einzelfälle', 'one-offs'), value: st.tickets, tone: 'muted' }] }, caption: T(L, 'Alle Tickets sind Einzelfälle – kein Thema kommt wieder.', 'All tickets are one-offs – no topic recurs.') };
      s.findings.push(finding(T(L, `In ${st.tickets} Tickets kommt kein Thema mindestens zweimal vor.`, `No topic occurs at least twice in ${st.tickets} tickets.`), 'ok', 10, [ev(T(L, 'Tickets', 'tickets'), st.tickets, 'n')]));
    } else {
      const top = st.topics.slice(0, 10);
      for (const x of top) s.entities.texts.push(x.name);
      s.visual = { kind: 'bars', data: { unit: 'n', items: top.map((x) => ({ label: x.name.slice(0, 80), value: x.count, tone: x.trend === 'rising' ? 'warn' : x.playbook ? 'ink' : 'muted', sub: `${F.h(x.spentTotal)} · ${TREND[x.trend][L === 'en' ? 1 : 0]}` })) },
        caption: T(L, 'Wiederkehrende Themen nach Anzahl Tickets; gelb = steigend, dunkel = Kandidat für eine Standardantwort.', 'Recurring topics by number of tickets; yellow = rising, dark = candidate for a standard reply.') };
      for (const x of top.slice(0, 3)) s.findings.push(finding(T(L, `„${x.name}“: ${x.count} Tickets, zusammen ${F.h(x.spentTotal)}, Tendenz ${TREND[x.trend][0]}${x.playbook ? ' – lohnt eine Standardantwort' : ''}.`, `"${x.name}": ${x.count} tickets, ${F.h(x.spentTotal)} in total, trend ${TREND[x.trend][1]}${x.playbook ? ' – worth a standard reply' : ''}.`),
        x.trend === 'rising' ? 'warn' : 'info', Math.min(90, 40 + x.count * 1.5 + (x.trend === 'rising' ? 15 : 0)),
        [ev(T(L, 'Tickets', 'tickets'), x.count, 'n'), ev(T(L, 'Zeit', 'time'), x.spentTotal, 'h'), ev(T(L, 'Median je Ticket', 'median per ticket'), x.spentMedian, 'h'), ...x.exampleKeys.slice(0, 3).map((k) => ev(T(L, 'Beispiel', 'example'), undefined, null, { key: k }))]));
      if (pb.length) s.findings.push(finding(T(L, `${pb.length} ${plural(pb.length, 'Thema lohnt', 'Themen lohnen')} ein Playbook – zusammen ${F.h(pbHours)} Support-Zeit.`, `${pb.length} ${plural(pb.length, 'topic is', 'topics are')} worth a playbook – ${F.h(pbHours)} of support time together.`), 'warn', 60, [ev(T(L, 'Kandidaten', 'candidates'), pb.length, 'n'), ev(T(L, 'Zeit', 'time'), r1(pbHours), 'h')]));
    }
    const rising = st.topics.filter((x) => x.trend === 'rising');
    s.tone = worst(rising.length ? 'warn' : 'ok');
    s.headline = !st.topics.length ? T(L, `${st.tickets} Tickets, keine wiederkehrenden Themen.`, `${st.tickets} tickets, no recurring topics.`)
      : say(s.id, 'h', [T(L, `${st.topics.length} wiederkehrende Themen in ${st.tickets} Tickets – ${pb.length} lohnen eine Standardantwort (${F.h(pbHours)}).`, `${st.topics.length} recurring topics in ${st.tickets} tickets – ${pb.length} are worth a standard reply (${F.h(pbHours)}).`),
        T(L, `Am häufigsten: „${st.topics[0].name}“ mit ${st.topics[0].count} Tickets; insgesamt ${st.topics.length} wiederkehrende Themen.`, `Most frequent: "${st.topics[0].name}" with ${st.topics[0].count} tickets; ${st.topics.length} recurring topics in total.`)]);
    const cand = pb[0];
    if (cand) {
      const tpl = playbookTemplate(cand, { tickets, lang: L });
      s.actions.push(action('playbook', T(L, 'Playbook anlegen', 'Create playbook'), 'navigate', { view: 'support', tab: 'playbooks', topicId: cand.id }, T(L, `Entwurf „${tpl.title}“: ${tpl.steps.length} Schritte und eine Standardantwort – gespeichert wird erst per Klick.`, `Draft "${tpl.title}": ${tpl.steps.length} steps and a standard reply – saved only on click.`)));
    }
    s.actions.push(action('open', T(L, 'Support öffnen', 'Open support'), 'navigate', { view: 'support' }, T(L, 'Öffnet die Support-Ansicht.', 'Opens the support view.')));
    s.followUps.push(follow(T(L, 'Tickets verteilen', 'Dispatch'), T(L, 'Wer soll die neuen Tickets bekommen?', 'Who should take the new tickets?')), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Realistische Kapazität', 'Real capacity'), T(L, 'Wie viel Kapazität bleibt nach Support?', 'How much capacity is left after support?')));
    s.how = { text: T(L, 'Ein Thema = Tickets mit demselben markanten Wort im Titel (mindestens 3 Tickets), sonst gleiche Anfrageart oder Komponente. Kandidat für ein Playbook ab 3 Tickets und 2 h Zeit. Tendenz: letzte 4 Wochen gegen davor.', 'A topic = tickets sharing the same distinctive word in the title (at least 3 tickets), otherwise the same request type or component. Playbook candidate from 3 tickets and 2 h of time. Trend: last 4 weeks against before.'),
      inputs: [[T(L, 'Tickets', 'Tickets'), String(st.tickets)], [T(L, 'Stand', 'As of'), F.date(st.asOf)]] };
    s.confidence = st.tickets >= 50 ? 'high' : st.tickets >= 15 ? 'medium' : 'low';
    s.sources = ['Jira Service Management', T(L, 'Verlauf', 'History')];
    if (!s.entities.texts.length) delete s.entities.texts;
    return done(s);
  },
};
