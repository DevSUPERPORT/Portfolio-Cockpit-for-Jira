// Wish routing (Lotse's equivalent of the AI feature "intent"): which answer a free wish ("Ich will …") gets – Lotse's
// own understanding (understand.js: typo-tolerant DE/EN rules, the names in the question, approved learned phrases)
// next to the app's wish rules (shared/wishCatalog.js ruleWish). Shows the chosen answer, the alternatives and the
// signals behind them. When Lotse cannot map a wish, it says so – that is where the AI may help, and where an approved
// AI mapping later teaches Lotse (shared/lotse/learn.js).
import { fold, ruleWish, wishSubject, closestQuestions } from '../../ask.js';
import { understand, normalize } from '../understand.js';
import { CARD_SKILL } from '../learn.js';
import { computedOf, newStory, kpi, ev, finding, follow, done, infoStory, T, say, teamName } from '../kit.js';
import { SKILLS, questionFor } from './index.js';

const foldWish = (s) => fold(s).replace(/[?!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
// the card of the catalogue a skill stands for (the first card that maps to it)
const SKILL_CARD = Object.entries(CARD_SKILL).reduce((m, [card, skill]) => (m[skill] ? m : { ...m, [skill]: card }), {});

// Lotse's mapping in the AI's result shape: { card, skill, params, teamId, projectRef, subject, why, confidence }.
export function mapWish(text, ctx, lang = 'de') {
  const L = lang === 'en' ? 'en' : 'de';
  const wish = String(text || '').slice(0, 300);
  const u = understand(wish, ctx, {});
  const rule = ruleWish(foldWish(wish));
  const skill = u.skill && u.skill !== 'guard' && u.skill !== 'intentMap' ? u.skill : rule ? CARD_SKILL[rule] || null : null;
  const params = u.skill === skill ? u.params || {} : {};
  const card = rule && CARD_SKILL[rule] === skill ? rule : SKILL_CARD[skill] || rule || null;
  const confidence = !skill ? null : u.skill === skill ? u.confidence : 'medium';
  return {
    card, skill, params, teamId: params.team || null, projectRef: params.ref || null, subject: card === 'similarWork' ? wishSubject(wish) || null : null, learned: !!u.learned,
    alternatives: (u.alternatives || []).filter((a) => a.skill !== skill).slice(0, 3).map((a) => a.skill),
    why: !skill ? T(L, 'Lotse kennt dafür noch keine sichere Antwort.', 'Lotse knows no sure answer for this yet.') : u.learned ? T(L, 'Gelernte Formulierung (von einem Admin freigegeben).', 'Learned phrasing (approved by an admin).') : T(L, 'Lotses Regeln: Stichworte und Namen im Wunsch.', 'Lotse\'s rules: keywords and names in the wish.'),
    confidence, source: 'lotse',
  };
}

export default {
  id: 'intentMap',
  title: (L) => T(L, 'Wunsch zuordnen', 'Map a wish'),
  params: ['text'],
  match: [/welche (karte|antwort|auswertung) (passt|zeigt|beantwortet)|which (card|answer|analysis) (fits|shows|answers)|wie frage ich (nach|das)|how (do|should) i ask (for|about)|ordne (meinen )?wunsch|map (my )?wish/],
  run(ctx, p, L) {
    const { model } = computedOf(ctx);
    const text = String(p?.text || '').trim();
    if (!text) return infoStory(ctx, { skill: 'intentMap', lang: L, headline: T(L, 'Welchen Wunsch soll Lotse zuordnen?', 'Which wish should Lotse map?'), finding: T(L, 'Schreib ihn in deinen Worten, z. B. „Ich will wissen, wer bald Überstunden macht“.', 'Write it in your own words, e.g. "I want to know who will soon work overtime".'),
      followUps: [follow(T(L, 'Beispiel', 'Example'), T(L, 'Wer macht bald Überstunden?', 'Who is heading for overtime?')), follow(T(L, 'Heute für mich', 'Today for me'), T(L, 'Was ist heute wichtig?', 'What matters today?'))] });
    const m = mapWish(text, ctx, L);
    const q = normalize(text);
    const s = newStory(ctx, { skill: 'intentMap', subject: { kind: 'topic', ref: null, name: text.slice(0, 100) }, lang: L });
    s.id = `intentMap:${q.replace(/[^a-z0-9]+/g, '-').slice(0, 80) || 'wish'}`;
    s.entities.texts = [text.slice(0, 100)];
    // the signals: how many of each candidate's phrasings the wish hits (plus 1 for a named project / team it needs)
    const signals = (id) => (SKILLS[id]?.match || []).filter((re) => re.test(q)).length + ((SKILLS[id]?.params || []).some((x) => (x === 'project' && m.projectRef) || (x === 'team' && m.teamId)) ? 1 : 0);
    const cands = [...new Set([m.skill, ...m.alternatives].filter(Boolean))];
    const label = (id) => SKILLS[id]?.title(L) || id;
    if (!m.skill) {
      const qs = (() => { try { return closestQuestions(text, { ...ctx, lang: L }, 3); } catch { return []; } })();
      s.kpis.push(kpi('cands', T(L, 'Kandidaten', 'Candidates'), 0, 'n', { tone: 'warn' }), kpi('similar', T(L, 'Ähnliche Fragen', 'Similar questions'), qs.length, 'n'));
      s.visual = { kind: 'donut', data: { unit: 'n', total: 1, items: [{ label: T(L, 'nicht zugeordnet', 'not mapped'), value: 1, tone: 'warn' }] }, caption: T(L, 'Lotse hat für diesen Wunsch keine sichere Antwort gefunden.', 'Lotse found no sure answer for this wish.') };
      s.findings.push(finding(T(L, 'Lotse kennt diese Formulierung noch nicht. Ist die KI an, kann sie eine Antwortkarte wählen – gibt ein Admin das frei, lernt Lotse die Formulierung für alle.', 'Lotse does not know this phrasing yet. With AI on, it can pick an answer card – once an admin approves it, Lotse learns the phrasing for everyone.'), 'warn', 60, []));
      s.tone = 'warn';
      s.headline = T(L, `Lotse kann „${text.slice(0, 60)}“ noch nicht sicher zuordnen.`, `Lotse cannot map "${text.slice(0, 60)}" for sure yet.`);
      s.followUps.push(...qs.map((x) => follow(x.length > 60 ? `${x.slice(0, 57)}…` : x, x)), follow(T(L, 'Heute für mich', 'Today for me'), T(L, 'Was ist heute wichtig?', 'What matters today?')));
      if (s.followUps.length < 2) s.followUps.push(follow(T(L, 'Wasserlinie', 'Waterline'), T(L, 'Ab welchem Rang reicht die Kapazität nicht?', 'From which rank does capacity run out?')));
      s.confidence = 'low';
    } else {
      const sig = Object.fromEntries(cands.map((id) => [id, signals(id)]));
      s.kpis.push(kpi('signals', T(L, 'Signale', 'Signals'), sig[m.skill], 'n', { tone: 'ink' }));
      s.kpis.push(kpi('alternatives', T(L, 'Alternativen', 'Alternatives'), m.alternatives.length, 'n'));
      s.visual = { kind: 'bars', data: { unit: 'n', items: cands.map((id) => ({ label: label(id), value: sig[id], tone: id === m.skill ? 'ink' : 'muted', sub: id === m.skill ? T(L, 'gewählt', 'chosen') : T(L, 'Alternative', 'alternative') })) }, caption: T(L, 'Wie viele Formulierungen und Namen des Wunsches zu jeder Antwort passen.', 'How many phrasings and names of the wish fit each answer.') };
      const tn = m.teamId ? teamName(model, m.teamId) : null;
      if (tn) s.entities.teams.push({ id: m.teamId, name: tn });
      const it = m.projectRef ? model.itemByRef.get(m.projectRef) : null;
      if (it) s.entities.projects.push({ ref: it.ref, key: it.key || null, rank: it.rank ?? null, name: it.name });
      s.findings.push(finding(T(L, `Antwort: „${label(m.skill)}“${tn ? ` für Team ${tn}` : it ? ` für ${it.name}` : ''} – ${m.why}`, `Answer: "${label(m.skill)}"${tn ? ` for team ${tn}` : it ? ` for ${it.name}` : ''} – ${m.why}`), 'ok', 80, [ev(T(L, 'Signale', 'signals'), sig[m.skill], 'n')]));
      if (m.alternatives.length) s.findings.push(finding(T(L, `Ebenfalls möglich: ${m.alternatives.map((a) => `„${label(a)}“`).join(', ')}.`, `Also possible: ${m.alternatives.map((a) => `"${label(a)}"`).join(', ')}.`), 'info', 30, [ev(T(L, 'Alternativen', 'alternatives'), m.alternatives.length, 'n')]));
      s.tone = 'ok';
      s.headline = say(s.id, 'h', [T(L, `„${text.slice(0, 60)}“ beantwortet Lotse mit „${label(m.skill)}“.`, `Lotse answers "${text.slice(0, 60)}" with "${label(m.skill)}".`), T(L, `Für „${text.slice(0, 60)}“ passt „${label(m.skill)}“ am besten.`, `For "${text.slice(0, 60)}" the best fit is "${label(m.skill)}".`)]);
      const subj = it ? { kind: 'project', name: it.name } : tn ? { kind: 'team', name: tn } : { kind: 'portfolio', name: '' };
      s.followUps.push(follow(label(m.skill), questionFor(m.skill, subj, L)), ...m.alternatives.slice(0, 2).map((a) => follow(label(a), questionFor(a, subj, L))), follow(T(L, 'Heute für mich', 'Today for me'), T(L, 'Was ist heute wichtig?', 'What matters today?')));
      s.confidence = m.confidence || 'medium';
    }
    s.how = { text: T(L, 'Lotse liest den Wunsch selbst: Stichworte je Antwort (deutsch und englisch, tippfehlertolerant), Namen von Projekten, Teams und Personen, dazu die Wunsch-Regeln der App und von Admins freigegebene gelernte Formulierungen. Ohne KI.', 'Lotse reads the wish itself: keywords per answer (German and English, typo tolerant), names of projects, teams and people, plus the app\'s wish rules and learned phrasings approved by admins. Without AI.'),
      inputs: [[T(L, 'Wunsch', 'Wish'), text.slice(0, 120)], [T(L, 'Regel der App', 'App rule'), m.card ? T(L, 'passt', 'fits') : '–']] };
    s.sources = [T(L, 'Lotses Regeln', 'Lotse\'s rules')];
    s.draft = { card: m.card, skill: m.skill, params: m.params, teamId: m.teamId, projectRef: m.projectRef, subject: m.subject, why: m.why, confidence: m.confidence, learned: m.learned, source: 'lotse' };
    return done(s);
  },
};
