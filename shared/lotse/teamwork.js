// Lotse × Forge LLM – teamwork on the SAME task. Where an AI feature and a Lotse skill do the same job, the UI shows ONE
// result: Lotse's verified answer first (instant, no AI), the AI's answer next to it, compared in code:
//   - narratives (briefings, plan vs. actual, what helped, free answers): crossCheck() of every number / key / team /
//     date / rank the AI writes against Lotse's story → agree / differs, per claim ✓ / ✗;
//   - structured suggestions (a gap's value, team and person per ticket, planning picks, health status, comment drafts,
//     the card for a wish, a playbook): Lotse's suggestion vs. the AI's → "Beide schlagen … vor" or both options;
//     the person picks one, applied through the screen's existing write path with its undo.
// AI off or budget stopped → Lotse alone, same shapes. Pure: no AI, no network, no randomness.
//
//   lotseDraft(feature, payload, ctx)  → { feature, skill, story|null, result|null }   result = the AI's result shape
//   compareDrafts(feature, lotse, ai)  → { verdict: 'same'|'differs'|'partial'|'lotseOnly'|'aiOnly'|'none', same, total, items }
//   textCheck(story, ai, lang)         → crossCheck of the AI's text (+ points) against the story
import { AI_PARITY } from './parity.js';
import { crossCheck } from './crosscheck.js';
import { SKILLS } from './skills/index.js';
import { computedOf } from './kit.js';
import { fmtOf } from './narrate.js';
import { draftHealth } from './skills/healthDraft.js';
import { suggestFor } from './skills/gapsFix.js';
import { draftComments } from './skills/bookingComments.js';
import { lessonsOf } from './skills/similarSummary.js';
import { playbookOf } from './skills/playbookDraft.js';
import { ticketTokens } from '../dispatch.js';
import { mapWish } from './skills/intentMap.js';
import { pickSuggestions } from './skills/planningAdvice.js';
import { ticketsOf } from '../ask.js';

const T = (lang, de, en) => (lang === 'en' ? en : de);
const NARRATIVE = new Set(['ask', 'reportSummary', 'teamBrief', 'projectBrief', 'planActual', 'similarSummary', 'lotse']);
export const isNarrative = (feature) => NARRATIVE.has(feature);
const safeRun = (skill, params, ctx) => { try { const s = SKILLS[skill]?.run(ctx, params || {}, ctx.lang === 'en' ? 'en' : 'de'); return s || null; } catch { return null; } };
const briefResult = (s) => (s ? { text: s.headline, points: (s.findings || []).slice(0, 3).map((f) => f.text), reasoning: s.how?.text || '', confidence: s.confidence, source: 'lotse' } : null);

// Lotse's answer to the same payload the AI gets.
export function lotseDraft(feature, payload = {}, ctx = {}) {
  const L = ctx.lang === 'en' ? 'en' : 'de';
  const p = payload && typeof payload === 'object' ? payload : {};
  const skill = AI_PARITY[feature] || null;
  const out = (story, result) => ({ feature, skill, story: story || null, result: result || null });
  try {
    switch (feature) {
      case 'teamBrief': { const s = safeRun('teamBrief', { team: p.teamId }, ctx); return out(s, briefResult(s)); }
      case 'projectBrief': { const s = safeRun('projectBrief', { ref: p.ref }, ctx); return out(s, briefResult(s)); }
      case 'reportSummary': case 'ask': case 'lotse': { const s = safeRun(skill, p.ref ? { ref: p.ref } : {}, ctx); return out(s, briefResult(s)); }
      case 'planActual': { const team = p.teamId || ctx.teamId || null; const s = ctx.planActual ? safeRun('planActualExplain', team ? { team } : {}, ctx) : null; return out(s, briefResult(s)); }
      case 'healthDraft': {
        const c = computedOf(ctx);
        const it = c.model.itemByRef.get(p.ref);
        if (!it) return out(null, null);
        const d = draftHealth(ctx, it, L, fmtOf(ctx, L));
        return out(safeRun('healthDraft', { ref: p.ref }, ctx), { status: d.status, comment: d.comment, source: 'lotse' });
      }
      case 'gaps': {
        const g = p.gap || {};
        const c = computedOf(ctx);
        const gap = (c.dq?.gaps || []).find((x) => x.id === g.id) || null;
        const v = gap ? suggestFor(ctx, gap) : null;
        if (v && v.value != null) return out(null, { suggestion: { usage: g.usage, value: v.value }, why: T(L, `Lotse: aus ${v.basis === 'similar' ? 'ähnlicher erledigter Arbeit' : v.basis === 'parent' ? 'dem übergeordneten Vorgang' : v.basis === 'stories' ? 'den Terminen der Stories' : 'den Geschwistern'} (${v.n}).`, `Lotse: from ${v.basis === 'similar' ? 'similar finished work' : v.basis === 'parent' ? 'the parent' : v.basis === 'stories' ? 'the stories\' dates' : 'the siblings'} (${v.n}).`), basedOn: v.keys || [], source: 'lotse' });
        const r = p.rule && p.rule.value != null ? p.rule : null;
        return out(null, r ? { suggestion: { usage: g.usage, value: r.value }, why: r.why || T(L, 'Regel der App.', 'App rule.'), basedOn: [], source: 'lotse' } : { suggestion: null, why: T(L, 'Lotse findet keine belastbare Grundlage.', 'Lotse finds no sound basis.'), basedOn: [], source: 'lotse' });
      }
      case 'dispatch': {
        const teams = new Map((p.teams || []).map((t) => [t.id, t]));
        // every ticket Lotse gives someone counts 4 h for them (as in the table's suggestions) – so a batch is spread
        const extra = new Map();
        const loadOf = (x) => x.load + (x.cap > 0 ? (extra.get(x.id) || 0) / x.cap : 0);
        // near-identical tickets in one batch (≥ 3 shared words and ≥ 75 % of the shorter one): one person takes the topic
        const seenTopics = [];
        const twinOf = (t) => {
          const tok = ticketTokens(t);
          if (tok.length < 3) return null;
          for (const s of seenTopics) {
            const shared = tok.filter((w) => s.tok.includes(w)).length;
            if (shared >= 3 && shared >= 0.75 * Math.min(tok.length, s.tok.length)) return s;
          }
          seenTopics.push({ tok, item: null, key: t.key });
          return null;
        };
        const items = (p.tickets || []).map((t) => {
          const twin = twinOf(t);
          if (twin?.item) return { issueId: String(t.id), key: t.key, teamId: twin.item.teamId, accountId: twin.item.accountId, why: T(L, `Gleiches Thema wie ${twin.key} – dieselbe Person nimmt beide.`, `Same topic as ${twin.key} – the same person takes both.`) };
          const teamId = t.suggestedTeamId || t.teamId;
          if (!teamId) return null;
          const remember = (it) => { const s = seenTopics.find((x) => x.key === t.key); if (s) s.item = it; return it; };
          const m = (teams.get(teamId)?.members || []).filter((x) => !x.absent && Number.isFinite(x.load)).sort((a, b) => loadOf(a) - loadOf(b) || String(a.id).localeCompare(String(b.id)))[0];
          // nobody beyond 100 %: when everyone in the team is full, Lotse proposes the team only and says so
          // (live 2026-11-17: a one-person team got 60 tickets)
          if (m && loadOf(m) >= 1) {
            return remember({ issueId: String(t.id), key: t.key, teamId, accountId: null, why: T(L, `Team ${teams.get(teamId)?.name || ''}: alle Mitglieder sind diese Woche schon bei ${Math.round(loadOf(m) * 100)} % oder mehr – nur das Team, die Person entscheidet das Team.`, `Team ${teams.get(teamId)?.name || ''}: every member is already at ${Math.round(loadOf(m) * 100)} % or more this week – team only, the team decides who.`) });
          }
          const mLoad = m ? loadOf(m) : null;
          if (m) extra.set(m.id, (extra.get(m.id) || 0) + 4);
          const w = (t.suggestionWords || []).slice(0, 2).map((x) => `„${x}“`).join(', ');
          const src = t.suggestionSource === 'mapping' ? T(L, 'Komponente zugeordnet', 'component mapping') : t.suggestionSource === 'history' ? T(L, 'löst solche Tickets meist', 'usually resolves such tickets')
            : t.suggestionSource === 'similar' ? T(L, `ähnlich wie ${t.suggestionBasis}${w ? ` (${w})` : ''}`, `similar to ${t.suggestionBasis}${w ? ` (${w})` : ''}`)
              : t.suggestionSource === 'assignee' ? T(L, 'Team der Person am Ticket', 'team of the person on the ticket')
                : t.suggestionSource === 'capacity' ? T(L, 'kein Hinweis am Ticket – Team mit der meisten freien Zeit diese Woche', 'no hint on the ticket – team with the most free time this week')
                  : T(L, 'Team am Ticket', 'team on the ticket');
          return remember({ issueId: String(t.id), key: t.key, teamId, accountId: m ? m.id : null, why: `${src.charAt(0).toUpperCase()}${src.slice(1)}${m ? T(L, `; geringste Auslastung ${Math.round(mLoad * 100)} %`, `; lowest load ${Math.round(mLoad * 100)} %`) : ''}.` });
        }).filter(Boolean);
        return out(null, { items, rejected: 0, source: 'lotse' });
      }
      case 'planning': {
        const all = { smooth: { suggestions: [] }, rebalance: { suggestions: [] }, sooner: { suggestions: [] } };
        for (const x of p.suggestions || []) if (all[x.mode]) all[x.mode].suggestions.push(x);
        const why = { smooth: T(L, 'nimmt Überlast heraus', 'removes overload'), rebalance: T(L, 'Kolleg:in hat Luft', 'a colleague has room'), sooner: T(L, 'früher fertig, ohne Überlast', 'done sooner without overload') };
        const picks = pickSuggestions(all).map((x) => ({ id: x.id, why: why[x.mode] }));
        return out(null, { text: T(L, `Lotse wählt ${picks.length} von ${(p.suggestions || []).length} Vorschlägen: je Aufgabe höchstens einer, Überlast zuerst, niedriger Rang zuerst.`, `Lotse picks ${picks.length} of ${(p.suggestions || []).length} suggestions: at most one per task, overload first, low rank first.`), picks, rejected: 0, source: 'lotse' });
      }
      case 'myWeek': return out(ctx.computed || ctx.ds ? safeRun('bookingComments', {}, ctx) : null, draftComments({ cells: p.cells, events: p.events }, L));
      case 'similarSummary': {
        const les = lessonsOf({ items: p.items, stats: p.stats, comments: ctx.comments || null }, L);
        return out(null, { text: les.text, points: les.points, basedOn: les.basedOn, keywords: les.keywords, reasoning: '', confidence: les.confidence, source: 'lotse' });
      }
      case 'playbookDraft': {
        const t = p.topic || {};
        const examples = (p.examples || []).filter((x) => x && x.key);
        let tickets = examples;
        try { const all = ticketsOf({ ...ctx, ds: ctx.ds || computedOf(ctx).model.ds }); if (all.length) tickets = all; } catch { /* the examples are enough */ }
        const topic = { id: t.id || null, name: t.name || '', count: t.count || examples.length, spentTotal: t.spentTotal || 0, spentMedian: t.spentMedian || 0, trend: t.trend, exampleKeys: examples.map((x) => x.key), ids: t.ids || [] };
        let teamName = (id) => id;
        try { const { model } = computedOf(ctx); teamName = (id) => model.teams.get(id)?.name || id; } catch { /* ids */ }
        const pb = playbookOf(topic, { tickets, lang: L, teamName });
        return out(null, { draft: pb.draft, reasoning: pb.reasoning, confidence: pb.confidence, source: 'lotse' });
      }
      case 'intent': {
        const m = mapWish(p.wish, ctx, L);
        return out(null, { card: m.card, skill: m.skill, teamId: m.teamId, projectRef: m.projectRef, subject: m.subject, why: m.why, confidence: m.confidence, source: 'lotse' });
      }
      default: return out(null, null);
    }
  } catch { return out(null, null); }
}

const near = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= Math.max(0.5, 0.1 * Math.max(Math.abs(a), Math.abs(b))) : JSON.stringify(a) === JSON.stringify(b));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
const verdictOf = (same, total, lotseN, aiN) => (!lotseN && !aiN ? 'none' : !aiN ? 'lotseOnly' : !lotseN ? 'aiOnly' : same === total ? 'same' : same ? 'partial' : 'differs');

// Lotse's suggestion vs. the AI's, per item. lotse / ai: results in the AI's shape (lotseDraft().result, ai.assist).
export function compareDrafts(feature, lotse, ai) {
  const l = lotse || null, a = ai || null;
  const res = (items) => {
    const same = items.filter((x) => x.same).length;
    const lN = items.filter((x) => x.lotse != null).length, aN = items.filter((x) => x.ai != null).length;
    return { verdict: verdictOf(same, items.length, lN, aN), same, total: items.length, items };
  };
  switch (feature) {
    case 'gaps': {
      const lv = l?.suggestion?.value ?? null, av = a?.suggestion?.value ?? null;
      return res(lv == null && av == null ? [] : [{ id: 'value', lotse: lv, ai: av, same: lv != null && av != null && near(lv, av) }]);
    }
    case 'healthDraft': {
      const ls = l?.status || null, as = a?.status || null;
      return res(!ls && !as ? [] : [{ id: 'status', lotse: ls, ai: as, same: !!ls && ls === as }]);
    }
    case 'intent': {
      const lc = l?.card || null, ac = a?.card || null;
      return res(!lc && !ac ? [] : [{ id: 'card', lotse: lc, ai: ac, same: !!lc && lc === ac }]);
    }
    case 'dispatch': {
      const ids = [...new Set([...(l?.items || []), ...(a?.items || [])].map((x) => String(x.issueId)))];
      return res(ids.map((id) => {
        const x = (l?.items || []).find((y) => String(y.issueId) === id) || null, y = (a?.items || []).find((z) => String(z.issueId) === id) || null;
        const sameTeam = !!x && !!y && x.teamId === y.teamId;
        const samePerson = !!x && !!y && (x.accountId || null) === (y.accountId || null);
        return { id, key: (x || y).key, lotse: x ? { teamId: x.teamId, accountId: x.accountId || null } : null, ai: y ? { teamId: y.teamId, accountId: y.accountId || null } : null, sameTeam, samePerson, same: sameTeam && samePerson };
      }));
    }
    case 'planning': {
      const lp = new Set((l?.picks || []).map((x) => x.id)), ap = new Set((a?.picks || []).map((x) => x.id));
      return res([...new Set([...lp, ...ap])].map((id) => ({ id, lotse: lp.has(id) ? id : null, ai: ap.has(id) ? id : null, same: lp.has(id) && ap.has(id) })));
    }
    case 'myWeek': {
      const lc = new Map((l?.comments || []).map((x) => [x.cell, x])), ac = new Map((a?.comments || []).map((x) => [x.cell, x]));
      return res([...new Set([...lc.keys(), ...ac.keys()])].map((cell) => ({ id: cell, key: (lc.get(cell) || ac.get(cell)).key, lotse: lc.get(cell)?.comment ?? null, ai: ac.get(cell)?.comment ?? null, same: lc.has(cell) && ac.has(cell) && norm(lc.get(cell).comment) === norm(ac.get(cell).comment) })));
    }
    case 'playbookDraft': {
      const ld = l?.draft, ad = a?.draft;
      if (!ld && !ad) return res([]);
      const steps = (d) => (d?.steps || []).length;
      return res([{ id: 'steps', lotse: ld ? steps(ld) : null, ai: ad ? steps(ad) : null, same: !!ld && !!ad && steps(ld) === steps(ad) }, { id: 'title', lotse: ld?.title ?? null, ai: ad?.title ?? null, same: !!ld && !!ad && norm(ld.title) === norm(ad.title) }]);
    }
    default: return res([]);
  }
}

// The AI's narrative checked against Lotse's story (numbers, keys, teams, dates, ranks) – pure code, no second model.
export function textCheck(story, ai, lang) {
  if (!story || !ai) return null;
  const text = [ai.text, ...(ai.points || [])].filter(Boolean).join(' ');
  if (!text.trim()) return null;
  return crossCheck(story, text, { lang: lang || story.lang });
}

// The result the person picked ('lotse' | 'ai'), in the AI's shape, for the screen's existing apply path.
export function pickResult(lotse, ai, choice) {
  const r = choice === 'ai' ? ai : lotse;
  return r ? { ...r, source: choice === 'ai' ? (ai?.source || 'ai') : 'lotse' } : null;
}
