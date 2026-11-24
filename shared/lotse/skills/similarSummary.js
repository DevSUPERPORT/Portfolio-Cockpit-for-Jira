// What helped in similar finished work (Lotse's equivalent of the AI feature "similarSummary"): from the similar DONE
// items (shared/insights.js similarWork) – their hours, overruns, durations and comment counts – and, only when the
// comment texts were loaded (insights.comments returns texts only when the admin allowed texts), the words that keep
// coming back in those comments. Counting and keyword extraction, no AI.
//
// lessonsOf({ subject, items, stats, comments }, lang) works on the same payload the AI gets (Ask › "Was half damals?")
// and returns the AI's result shape ({ text, points, basedOn }) plus the keywords it found.
import { similarWork, words, median } from '../../insights.js';
import { poolOf } from '../../ask.js';
import { computedOf, dsOf, newStory, addProject, kpi, ev, finding, action, follow, done, infoStory, r1, T, say } from '../kit.js';
import { plural } from '../narrate.js';

// words that say nothing about what helped (stemmed tokens of insights.words)
const DULL = new Set(['vorher', 'nachher', 'gelost', 'geloest', 'haben', 'hatte', 'hatten', 'erst', 'jedes', 'jahr', 'seite', 'gebraucht', 'brauch', 'bestehend', 'letzt', 'letzten', 'runde', 'runden', 'early', 'first', 'later', 'again', 'still', 'done', 'fixed']);

// Keywords of the comment texts: document frequency over the comments, words of 5+ letters, the original spelling.
export function commentKeywords(texts, n = 5) {
  const df = new Map();
  for (const t of texts || []) {
    const seen = new Set();
    for (const { t: tok, w } of words(t)) {
      if (tok.length < 5 || DULL.has(tok) || /\d/.test(tok) || seen.has(tok)) continue;
      seen.add(tok);
      const e = df.get(tok) || df.set(tok, { word: w, n: 0 }).get(tok);
      e.n++;
      if (w.length < e.word.length) e.word = w;
    }
  }
  return [...df.values()].filter((x) => x.n >= 2 || (texts || []).length <= 2).sort((a, b) => b.n - a.n || a.word.localeCompare(b.word)).slice(0, n);
}

const textsOf = (items, comments) => (items || []).flatMap((x) => (comments?.[String(x.id)]?.last || []).map((c) => (typeof c === 'string' ? c : c?.text)).filter(Boolean));
const countOf = (x, comments) => (comments?.[String(x.id)]?.count ?? (Number.isFinite(+x.comments) && x.comments != null ? +x.comments : null));

// The AI-shaped lesson: numbers first, then what the comment counts and – when loaded – the comment words say.
export function lessonsOf({ items = [], stats = {}, comments = null } = {}, lang = 'de') {
  const L = lang === 'en' ? 'en' : 'de';
  const nf = (v) => (L === 'en' ? String(v) : String(v).replace('.', ','));
  const xs = (Array.isArray(items) ? items : []).filter((x) => x && x.key);
  const n = xs.length;
  const med = stats.medianActualH ?? null, p80 = stats.p80ActualH ?? null, over = stats.typicalOverrunPct ?? null, dur = stats.medianDurationWorkdays ?? stats.medianWorkdays ?? null;
  const parts = [n ? T(L, `${n} ähnliche erledigte ${plural(n, 'Aufgabe', 'Aufgaben')}.`, `${n} similar finished ${plural(n, 'item', 'items')}.`) : T(L, 'Keine ähnliche erledigte Arbeit.', 'No similar finished work.')];
  if (med != null) parts.push(T(L, `Typisch ${nf(med)} h, sicher ${nf(p80)} h (P80).`, `Typically ${nf(med)} h, safely ${nf(p80)} h (P80).`));
  if (over) parts.push(over > 0 ? T(L, `Meist ${over} % über der Schätzung.`, `Usually ${over} % over the estimate.`) : T(L, `Meist ${-over} % unter der Schätzung.`, `Usually ${-over} % under the estimate.`));
  if (dur != null) parts.push(T(L, `Dauer typisch ${nf(r1(dur))} Arbeitstage.`, `Typical duration ${r1(dur)} working days.`));
  const points = [];
  const withO = xs.filter((x) => Number.isFinite(x.overrunPct));
  const overN = withO.filter((x) => x.overrunPct > 10).length;
  if (withO.length >= 2) points.push(overN ? T(L, `${overN} von ${withO.length} lagen über der Schätzung – ${over > 0 ? `${over} % Puffer` : 'einen Puffer'} einplanen.`, `${overN} of ${withO.length} ran over the estimate – plan ${over > 0 ? `a ${over} % buffer` : 'a buffer'}.`) : T(L, `Alle ${withO.length} blieben im Rahmen der Schätzung – die Schätzweise passt.`, `All ${withO.length} stayed within the estimate – the way of estimating fits.`));
  // a lot of alignment (3+ comments) vs. little: what the hours say
  const cc = xs.map((x) => ({ x, c: countOf(x, comments) })).filter((y) => y.c != null && y.x.actualH > 0);
  const many = cc.filter((y) => y.c >= 3), few = cc.filter((y) => y.c < 3);
  let talk = null;
  if (many.length && few.length) {
    talk = { many: r1(median(many.map((y) => y.x.actualH))), few: r1(median(few.map((y) => y.x.actualH))), nMany: many.length, nFew: few.length };
    points.push(talk.many > talk.few ? T(L, `Mit viel Abstimmung (3+ Kommentare) brauchte es typisch ${nf(talk.many)} h statt ${nf(talk.few)} h – Klärung früh einplanen.`, `With a lot of alignment (3+ comments) it typically took ${talk.many} h instead of ${talk.few} h – plan clarification early.`)
      : T(L, `Viel Abstimmung (3+ Kommentare) kostete keine Zeit: typisch ${nf(talk.many)} h gegen ${nf(talk.few)} h ohne.`, `A lot of alignment (3+ comments) cost no time: typically ${talk.many} h against ${talk.few} h without.`));
  }
  const texts = textsOf(xs, comments);
  const keywords = texts.length ? commentKeywords(texts) : [];
  if (keywords.length) points.push(T(L, `In den Kommentaren immer wieder: ${keywords.slice(0, 3).map((k) => k.word).join(', ')}.`, `Recurring in the comments: ${keywords.slice(0, 3).map((k) => k.word).join(', ')}.`));
  const basedOn = [...xs].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3).map((x) => x.key);
  return { text: parts.join(' '), points: points.slice(0, 3), basedOn, keywords, talk, overN, withO: withO.length, texts: texts.length, reasoning: '', confidence: n >= 6 ? 'high' : n >= 3 ? 'medium' : 'low', source: 'lotse' };
}

export default {
  id: 'similarSummary',
  title: (L) => T(L, 'Was bei ähnlicher Arbeit half', 'What helped in similar work'),
  params: ['text', 'key'],
  match: [/was (hat )?(damals|frueher|bisher|beim letzten mal) geholfen|was half (damals|frueher)|what helped|lessons? learned|lehren aus|erfahrungen aus (aehnlich|frueher)|was lief (gut|schlecht) bei aehnlich/],
  run(ctx, p, L) {
    const { model } = computedOf(ctx);
    const i = p?.key ? (dsOf(ctx).issues || []).find((x) => x.key === p.key) : null;
    const text = i ? i.summary : String(p?.text || '').trim();
    if (!text) return infoStory(ctx, { skill: 'similarSummary', lang: L, headline: T(L, 'Für welche Aufgabe soll Lotse ähnliche Arbeit auswerten?', 'Which task should Lotse look up similar work for?'), finding: T(L, 'Nenne die Aufgabe in Worten oder einen Jira-Key, z. B. „Was half damals bei Login mit SSO?“.', 'Name the task in words or a Jira key, e.g. "What helped back then with login with SSO?".'),
      followUps: [follow(T(L, 'Beispiel', 'Example'), T(L, 'Schätze wie früher: Login mit SSO', 'Estimate like before: login with SSO'))] });
    const target = i ? { id: i.id, key: i.key, summary: i.summary, team: i.team, type: i.type, oe: i.oe, components: i.components, labels: i.labels } : { summary: text, team: p?.team ? { id: p.team } : null };
    const sim = similarWork(target, poolOf(ctx), { limit: 8, lang: L });
    const s = newStory(ctx, { skill: 'similarSummary', subject: i ? { kind: 'ticket', ref: i.key, name: i.key } : { kind: 'topic', ref: null, name: text.slice(0, 100) }, lang: L });
    s.id = `similarSummary:${i ? i.key : text.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').slice(0, 60)}`;
    const F = s.fmt;
    s.entities.texts = [text.slice(0, 100)];
    if (i) { const it = model.itemByRef.get(i.rootRef); if (it) addProject(s, it); }
    const label = i ? i.key : T(L, `„${text.slice(0, 60)}“`, `"${text.slice(0, 60)}"`);
    if (!sim.stats.n) return infoStory(ctx, { skill: 'similarSummary', lang: L, subject: s.subject, headline: T(L, `Für ${label} findet Lotse keine ähnliche erledigte Arbeit.`, `Lotse finds no similar finished work for ${label}.`), finding: T(L, `Geprüft: ${sim.poolSize} erledigte Stories. Das Fachwort aus Jira hilft oft.`, `Checked: ${sim.poolSize} finished stories. The term used in Jira often helps.`), evidence: [ev(T(L, 'erledigte Stories', 'finished stories'), sim.poolSize, 'n')],
      followUps: [follow(T(L, 'Schätzen wie früher', 'Estimate like before'), T(L, `Schätze wie früher: ${text.slice(0, 60)}`, `Estimate like before: ${text.slice(0, 60)}`))] });
    const items = sim.items.map((x) => ({ ...x, comments: x.comments }));
    const les = lessonsOf({ items, stats: sim.stats, comments: ctx.comments || null }, L);
    const st = sim.stats;
    if (st.medianActualH != null) s.kpis.push(kpi('median', T(L, 'Typisch (Median)', 'Typical (median)'), st.medianActualH, 'h', { tone: 'ink' }));
    if (st.typicalOverrunPct != null) s.kpis.push(kpi('overrun', T(L, 'Typischer Überzug', 'Typical overrun'), st.typicalOverrunPct, '%', { tone: st.typicalOverrunPct > 10 ? 'warn' : 'ok' }));
    s.kpis.push(kpi('similar', T(L, 'Ähnliche', 'Similar'), st.n, 'n'));
    if (les.withO >= 2) s.kpis.push(kpi('over', T(L, 'Über Schätzung', 'Over estimate'), les.overN, 'n', { tone: les.overN ? 'warn' : 'ok' }));
    else if (st.medianDurationWorkdays != null) s.kpis.push(kpi('days', T(L, 'Dauer (Median)', 'Duration (median)'), st.medianDurationWorkdays, 'd'));
    if (s.kpis.length < 2) s.kpis.push(kpi('pool', T(L, 'Vergleichsbasis', 'Pool'), sim.poolSize, 'n'));
    s.visual = {
      kind: 'bars',
      data: { unit: 'h', items: items.map((x) => ({ label: x.key, key: x.key, value: x.actualH, tone: x.overrunPct != null && x.overrunPct > 10 ? 'warn' : 'ink', sub: `${x.overrunPct != null ? T(L, `${x.overrunPct > 0 ? '+' : ''}${x.overrunPct} % zur Schätzung`, `${x.overrunPct > 0 ? '+' : ''}${x.overrunPct} % vs. estimate`) : T(L, 'ohne Schätzung', 'no estimate')}${countOf(x, ctx.comments) != null ? ` · ${countOf(x, ctx.comments)} ${T(L, 'Kommentare', 'comments')}` : ''}` })) },
      caption: T(L, 'Gebuchte Stunden der ähnlichsten erledigten Aufgaben; gelb = über der Schätzung.', 'Logged hours of the most similar finished work; yellow = over the estimate.'),
    };
    for (const x of items) s.entities.texts.push(String(x.summary || '').slice(0, 100));
    if (st.medianActualH != null) s.findings.push(finding(T(L, `Typisch ${F.h(st.medianActualH, 1)}, sicher ${F.h(st.p80ActualH, 1)} (P80) aus ${st.withActual} ähnlichen erledigten Aufgaben.`, `Typically ${F.h(st.medianActualH, 1)}, safely ${F.h(st.p80ActualH, 1)} (P80) from ${st.withActual} similar finished items.`), 'info', 70,
      [ev(T(L, 'Median', 'median'), st.medianActualH, 'h'), ev('P80', st.p80ActualH, 'h'), ev(T(L, 'mit Buchungen', 'with bookings'), st.withActual, 'n'), ev('80', 80, 'n'), ...les.basedOn.map((k) => ev(T(L, 'Vergleich', 'comparison'), undefined, null, { key: k }))]));
    if (les.withO >= 2) s.findings.push(finding(les.overN ? T(L, `${les.overN} von ${les.withO} lagen über der Schätzung${st.typicalOverrunPct > 0 ? `, typisch um ${st.typicalOverrunPct} %` : ''} – mit Puffer planen.`, `${les.overN} of ${les.withO} ran over the estimate${st.typicalOverrunPct > 0 ? `, typically by ${st.typicalOverrunPct}%` : ''} – plan a buffer.`) : T(L, `Alle ${les.withO} blieben im Rahmen der Schätzung.`, `All ${les.withO} stayed within the estimate.`),
      les.overN ? 'warn' : 'ok', 60, [ev(T(L, 'über Schätzung', 'over estimate'), les.overN, 'n'), ev(T(L, 'mit Schätzung', 'with estimate'), les.withO, 'n'), ...(st.typicalOverrunPct != null ? [ev(T(L, 'Überzug', 'overrun'), Math.abs(st.typicalOverrunPct), '%')] : [])]));
    if (les.talk) s.findings.push(finding(les.talk.many > les.talk.few ? T(L, `Mit viel Abstimmung (3 und mehr Kommentare) brauchte es typisch ${F.h(les.talk.many, 1)} statt ${F.h(les.talk.few, 1)} – Klärung früh einplanen.`, `With a lot of alignment (3 or more comments) it typically took ${F.h(les.talk.many, 1)} instead of ${F.h(les.talk.few, 1)} – plan clarification early.`)
      : T(L, `Viel Abstimmung (3 und mehr Kommentare) kostete keine Zeit: ${F.h(les.talk.many, 1)} gegen ${F.h(les.talk.few, 1)}.`, `A lot of alignment (3 or more comments) cost no time: ${F.h(les.talk.many, 1)} against ${F.h(les.talk.few, 1)}.`), les.talk.many > les.talk.few ? 'warn' : 'info', 55,
      [ev(T(L, 'viel Abstimmung', 'much alignment'), les.talk.many, 'h'), ev(T(L, 'wenig Abstimmung', 'little alignment'), les.talk.few, 'h'), ev(T(L, 'Aufgaben mit 3+ Kommentaren', 'items with 3+ comments'), les.talk.nMany, 'n'), ev(T(L, 'Kommentare', 'comments'), 3, 'n')]));
    if (les.keywords.length) {
      s.findings.push(finding(T(L, `In den Kommentaren immer wieder: ${les.keywords.slice(0, 3).map((k) => `„${k.word}“`).join(', ')}.`, `Recurring in the comments: ${les.keywords.slice(0, 3).map((k) => `"${k.word}"`).join(', ')}.`), 'info', 50,
        les.keywords.slice(0, 4).map((k) => ev(k.word, k.n, 'n'))));
      for (const k of les.keywords) s.entities.texts.push(k.word);
    } else if (st.medianDurationWorkdays != null) s.findings.push(finding(T(L, `Dauer typisch ${F.n(st.medianDurationWorkdays, 1)} Arbeitstage.`, `Typical duration ${F.n(st.medianDurationWorkdays, 1)} working days.`), 'info', 30, [ev(T(L, 'Arbeitstage', 'working days'), st.medianDurationWorkdays, 'd')]));
    s.entities.texts = [...new Set(s.entities.texts.filter(Boolean))].slice(0, 20);
    s.tone = s.findings.some((f) => f.tone === 'warn') ? 'warn' : 'ok';
    s.headline = st.medianActualH != null
      ? say(s.id, 'h', [T(L, `${label}: ähnliche Arbeit brauchte typisch ${F.h(st.medianActualH, 1)}${les.withO >= 2 && les.overN ? `, ${les.overN} von ${les.withO} lagen über der Schätzung` : ''}.`, `${label}: similar work typically took ${F.h(st.medianActualH, 1)}${les.withO >= 2 && les.overN ? `, ${les.overN} of ${les.withO} ran over the estimate` : ''}.`),
        T(L, `Was bei ${label} half: ${st.n} ähnliche erledigte Aufgaben, typisch ${F.h(st.medianActualH, 1)}.`, `What helped with ${label}: ${st.n} similar finished items, typically ${F.h(st.medianActualH, 1)}.`)])
      : T(L, `${st.n} ähnliche erledigte Aufgaben für ${label}, aber ohne gebuchte Zeit.`, `${st.n} similar finished items for ${label}, but without logged time.`);
    s.actions.push(action('similar', T(L, 'Ähnliche ansehen', 'See similar work'), 'navigate', { view: 'ask', card: 'similarWork', text }, T(L, 'Öffnet die Karte „Schätzen wie früher“ mit allen Vergleichen.', 'Opens the "estimate like before" card with every comparison.')));
    s.followUps.push(follow(T(L, 'Schätzen wie früher', 'Estimate like before'), T(L, `Schätze wie früher: ${text.slice(0, 60)}`, `Estimate like before: ${text.slice(0, 60)}`)), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Passt das noch?', 'Does it fit?'), T(L, 'Was passt ohne Überstunden?', 'What fits without overtime?')));
    s.how = { text: T(L, 'Ähnlich wie bei „Schätzen wie früher“. Ausgewertet: gebuchte Zeit, Überzug gegen die Schätzung, Dauer und Anzahl der Kommentare; die Wörter der Kommentare nur, wenn Texte geladen werden dürfen (KI & Datenschutz). Gezählt, nicht interpretiert – ohne KI.', 'Similar as in "estimate like before". Evaluated: logged time, overrun against the estimate, duration and number of comments; the words of the comments only when texts may be loaded (AI & data protection). Counted, not interpreted – without AI.'),
      inputs: [[T(L, 'Vergleichsbasis', 'Pool'), T(L, `${sim.poolSize} erledigte Stories`, `${sim.poolSize} finished stories`)], [T(L, 'Kommentartexte', 'Comment texts'), String(les.texts)]] };
    s.confidence = sim.confidence;
    s.sources = ['Jira', T(L, 'Verlauf', 'History'), ...(les.texts ? [T(L, 'Kommentare', 'Comments')] : [])];
    s.draft = { text: les.text, points: les.points, basedOn: les.basedOn, reasoning: '', confidence: les.confidence, source: 'lotse' };
    return done(s);
  },
};
