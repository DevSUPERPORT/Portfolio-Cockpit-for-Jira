// "Warum?" – explains the last story: its top finding with the evidence behind it, the next findings, and how Lotse
// computed it. Recomputes the last skill first, so the explanation never rests on stale numbers.
import { newStory, ev, finding, follow, done, infoStory, T } from '../kit.js';
import { SKILLS } from './index.js';

export default {
  id: 'why',
  title: (L) => T(L, 'Warum?', 'Why?'),
  params: ['story'],
  match: [/^(und )?(warum|wieso|weshalb|weswegen|why|how come|begruend|erklaer|explain)\b/],
  run(ctx, p, L) {
    const last = p?.skill && SKILLS[p.skill] && p.skill !== 'why' && p.skill !== 'today' ? SKILLS[p.skill].run(ctx, p.params || {}, L) : p?.story;
    if (!last?.findings?.length) return infoStory(ctx, { skill: 'why', lang: L, headline: T(L, 'Wozu „warum“? Frag zuerst etwas, dann erklärt Lotse die Antwort.', 'Why what? Ask something first, then Lotse explains the answer.'), finding: T(L, 'Es gibt noch keine vorherige Antwort in diesem Gespräch.', 'There is no previous answer in this conversation yet.'),
      followUps: [follow(T(L, 'Heute für mich', 'Today for me'), T(L, 'Was ist heute wichtig?', 'What matters today?'))] });
    const top = last.findings[0];
    const s = newStory(ctx, { skill: 'why', subject: last.subject, lang: L });
    s.id = `why:${last.id}`;
    s.entities = last.entities ? JSON.parse(JSON.stringify(last.entities)) : { projects: [], teams: [], people: [] };
    for (const k of ['projects', 'teams', 'people']) s.entities[k] ||= [];
    s.kpis = last.kpis;
    const nums = top.evidence.filter((e) => typeof e.value === 'number');
    const unit = nums[0]?.unit;
    const same = nums.filter((e) => e.unit === unit);
    s.visual = same.length >= 2
      ? { kind: 'bars', data: { unit: unit || 'n', items: same.slice(0, 12).map((e) => ({ label: `${e.key ? `${e.key} · ` : ''}${e.label}`.slice(0, 80), value: e.value, ...(e.key ? { key: e.key } : {}), tone: top.tone === 'bad' ? 'bad' : top.tone === 'warn' ? 'warn' : 'ink' })) },
        caption: T(L, 'Die Zahlen hinter dem wichtigsten Punkt.', 'The numbers behind the most important point.') }
      : last.visual;
    s.findings.push(finding(top.text, top.tone, 100, top.evidence));
    for (const f of last.findings.slice(1, 4)) s.findings.push(finding(f.text, f.tone, Math.min(99, f.impact), f.evidence));
    s.tone = last.tone;
    s.headline = T(L, `Hauptgrund: ${top.text}`, `Main reason: ${top.text}`);
    s.actions = last.actions || [];
    s.followUps = (last.followUps || []).filter((f) => !/^(warum|why)/i.test(f.text));
    if (s.followUps.length < 2) s.followUps.push(follow(T(L, 'Heute für mich', 'Today for me'), T(L, 'Was ist heute wichtig?', 'What matters today?')));
    s.how = { text: last.how?.text || '', inputs: [...(last.how?.inputs || []), [T(L, 'Erklärt', 'Explains'), SKILLS[last.skill]?.title(L) || last.skill]].slice(0, 10) };
    if (!s.how.text) s.how.text = T(L, 'Die Belege stammen aus derselben Rechnung wie die vorige Antwort.', 'The evidence comes from the same calculation as the previous answer.');
    s.confidence = last.confidence;
    s.sources = last.sources;
    if (top.evidence.length) s.findings[0].evidence = [...top.evidence];
    else s.findings[0].evidence = [ev(T(L, 'Quelle', 'Source'), undefined, null)];
    return done(s);
  },
};
