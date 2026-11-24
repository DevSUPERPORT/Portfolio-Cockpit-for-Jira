// Waterline (engine.js waterline): from which rank team capacity no longer covers the demand, per quarter.
// With a team: that team's stack against its capacity. Without: every project's worst status across its teams.
import { teamIds } from '../../team.js';
import { computedOf, newStory, addProject, addTeam, kpi, ev, finding, action, follow, done, r1, sum, T, say, worst, teamName } from '../kit.js';
import { wlName, plural } from '../narrate.js';
import { pickTeam } from './teamBrief.js';

export default {
  id: 'waterline',
  title: (L) => T(L, 'Wasserlinie', 'Waterline'),
  params: ['team', 'quarter'],
  match: [/wasserlinie|waterline|ab welchem rang|from which rank|besetzbar|staffable|reicht (die )?kapazitaet|kapazitaet reicht|capacity (runs out|enough)|enough capacity|engpass|bottleneck|nicht (mehr )?(voll )?besetz|(alles|alle|voll) besetzen|not (fully )?staff|cannot staff|bis zu welchem rang|up to which rank/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const { model, wl } = c;
    const q = p?.quarter && wl.quarters.includes(p.quarter) ? p.quarter : wl.quarters[0];
    const tid = pickTeam(ctx, p);
    const cells = (tid ? [tid] : teamIds(c)).map((t) => wl.cells[t]?.[q]).filter(Boolean);
    const short = cells.filter((x) => x.waterRank != null || x.demand > x.capacity + 0.5).map((x) => ({ ...x, missing: Math.max(0, x.demand - x.capacity) })).sort((a, b) => b.missing - a.missing);
    const missing = sum(short, (x) => x.missing);
    const s = newStory(ctx, { skill: 'waterline', subject: tid ? { kind: 'team', ref: tid, name: teamName(model, tid) } : { kind: 'portfolio', ref: null, name: 'Portfolio' }, lang: L });
    s.id = `waterline:${tid || 'portfolio'}:${q}`;
    const F = s.fmt;
    const ranks = short.map((x) => x.waterRank).filter((r) => r != null);
    const firstRank = ranks.length ? Math.min(...ranks) : null;
    s.kpis.push(kpi('teams', T(L, `Teams mit Engpass ${F.quarter(q)}`, `Teams short ${F.quarter(q)}`), short.length, 'n', { tone: short.length ? 'bad' : 'ok' }));
    s.kpis.push(kpi('missing', T(L, 'Fehlende Stunden', 'Missing hours'), missing, 'h', { tone: missing > 0 ? 'bad' : 'ok' }));
    if (firstRank != null) s.kpis.push(kpi('firstRank', T(L, 'Erster Engpass ab Rang', 'First bottleneck from rank'), firstRank, 'n', { tone: 'warn' }));
    s.kpis.push(kpi('projects', T(L, 'Projekte mit Bedarf', 'Projects with demand'), Object.keys(wl.projectQ).filter((r) => wl.projectQ[r][q]).length, 'n'));
    const cell = tid ? wl.cells[tid]?.[q] : null;
    if (cell) {
      const tn = addTeam(s, model, tid);
      s.visual = { kind: 'waterline', data: { unit: 'h', capacity: r1(cell.capacity), support: r1(cell.support), team: tn, quarter: q, waterRank: cell.waterRank ?? null,
        items: cell.rows.filter((r) => r.kind === 'project').slice(0, 24).map((r) => { const it = model.itemByRef.get(r.ref); addProject(s, it); return { label: it?.name || r.ref, rank: r.rank, ref: r.ref, ...(it?.key ? { key: it.key } : {}), value: r1(r.demand), cum: r1(r.cum), status: r.status }; }) },
        caption: T(L, `Team ${tn}, ${F.quarter(q)}: Bedarf nach Rang gestapelt gegen die Kapazität (inkl. Support-Reserve).`, `Team ${tn}, ${F.quarter(q)}: demand stacked by rank against capacity (incl. the support reserve).`) };
    } else {
      let cum = 0;
      const items = model.items.filter((it) => wl.projectQ[it.ref]?.[q]).slice(0, 24).map((it) => {
        addProject(s, it);
        const v = wl.projectQ[it.ref][q];
        const d = sum(v.teams, (t) => t.demand);
        cum += d;
        return { label: it.name, rank: it.rank, ref: it.ref, ...(it.key ? { key: it.key } : {}), value: r1(d), cum: r1(cum), status: v.status };
      });
      s.visual = items.length ? { kind: 'waterline', data: { unit: 'h', capacity: null, quarter: q, waterRank: firstRank, items },
        caption: T(L, `Alle Projekte in ${F.quarter(q)} nach Rang: Bedarf über alle Teams; Farbe = schlechtester Status ihrer Teams.`, `All projects in ${F.quarter(q)} by rank: demand across all teams; colour = the worst status of their teams.`) }
        : { kind: 'donut', data: { unit: 'n', total: 0, items: [{ label: T(L, 'kein Bedarf', 'no demand'), value: 0, tone: 'muted' }] }, caption: T(L, `In ${F.quarter(q)} gibt es keinen Projektbedarf.`, `There is no project demand in ${F.quarter(q)}.`) };
    }
    for (const x of short.slice(0, 3)) {
      const tn = addTeam(s, model, x.teamId);
      if (!tn) continue;
      const first = x.waterRank != null ? model.items.find((it) => it.rank === x.waterRank) : null;
      if (first) addProject(s, first);
      const okN = x.rows.filter((r) => r.kind === 'project' && r.status === 'ok').length;
      s.findings.push(finding(first
        ? (first.rank > 1 && okN ? T(L, `Team ${tn}: bis Rang ${first.rank - 1} besetzbar, ab Rang ${first.rank} (${first.name}) fehlen ${F.h(x.missing)}.`, `Team ${tn}: staffable up to rank ${first.rank - 1}, from rank ${first.rank} (${first.name}) ${F.h(x.missing)} are missing.`)
          : T(L, `Team ${tn}: schon Rang ${first.rank} (${first.name}) ist nicht voll besetzbar – es fehlen ${F.h(x.missing)}.`, `Team ${tn}: already rank ${first.rank} (${first.name}) cannot be fully staffed – ${F.h(x.missing)} are missing.`))
        : T(L, `Team ${tn}: schon die Support-Reserve übersteigt die Kapazität um ${F.h(x.missing)}.`, `Team ${tn}: the support reserve alone exceeds capacity by ${F.h(x.missing)}.`),
        'bad', Math.min(95, 60 + x.missing / 20),
        [ev(T(L, 'Kapazität', 'capacity'), x.capacity, 'h', { ref: `team:${x.teamId}` }), ev(T(L, 'Bedarf', 'demand'), x.demand, 'h'), ev(T(L, 'fehlt', 'missing'), x.missing, 'h'), ev(T(L, 'Quartal', 'quarter'), q, 'quarter'), ...(first ? [ev(T(L, 'erster Engpass', 'first bottleneck'), undefined, null, { ref: first.ref, ...(first.key ? { key: first.key } : {}) }), ev(T(L, 'Rang davor', 'rank before'), first.rank - 1, 'n')] : [])]));
    }
    if (short.length > 3) s.findings.push(finding(T(L, `Dazu ${short.length - 3} ${plural(short.length - 3, 'weiteres Team', 'weitere Teams')} mit Engpass in ${F.quarter(q)}.`, `Plus ${short.length - 3} more ${plural(short.length - 3, 'team', 'teams')} short in ${F.quarter(q)}.`), 'warn', 40, [ev(T(L, 'weitere', 'more'), short.length - 3, 'n'), ev(T(L, 'Quartal', 'quarter'), q, 'quarter')]));
    if (!s.findings.length) s.findings.push(finding(T(L, `In ${F.quarter(q)} sind alle Projekte besetzbar.`, `In ${F.quarter(q)} every project can be staffed.`), 'ok', 10, [ev(T(L, 'Quartal', 'quarter'), q, 'quarter')]));
    s.tone = worst(...s.findings.map((f) => f.tone));
    const firstIt = firstRank != null ? model.items.find((it) => it.rank === firstRank) : null;
    if (firstIt) addProject(s, firstIt);
    s.headline = !short.length ? T(L, `${F.quarter(q)}: alle Projekte sind besetzbar.`, `${F.quarter(q)}: every project can be staffed.`)
      : say(s.id, 'h', [T(L, `${F.quarter(q)}: ab Rang ${firstRank} (${firstIt?.name}) reicht die Kapazität nicht – ${short.length} ${plural(short.length, 'Team', 'Teams')}, ${F.h(missing)} fehlen.`, `${F.quarter(q)}: from rank ${firstRank} (${firstIt?.name}) capacity runs out – ${short.length} ${plural(short.length, 'team', 'teams')}, ${F.h(missing)} missing.`),
        T(L, `In ${F.quarter(q)} fehlen ${F.h(missing)} bei ${short.length} ${plural(short.length, 'Team', 'Teams')}; der erste Engpass beginnt bei Rang ${firstRank}.`, `In ${F.quarter(q)} ${F.h(missing)} are missing in ${short.length} ${plural(short.length, 'team', 'teams')}; the first bottleneck starts at rank ${firstRank}.`)]);
    if (firstIt) s.actions.push(action('whatIfRank', T(L, `Rang ${firstIt.rank} nach hinten?`, `Rank ${firstIt.rank} to the end?`), 'whatIf', { change: { kind: 'rank', ref: firstIt.ref, toRank: model.items.length } }, T(L, `Rechnet durch, was es ändert, wenn ${firstIt.name} ans Ende rückt – nichts wird gespeichert.`, `Works out what changes if ${firstIt.name} moves to the end – nothing is saved.`)));
    s.actions.push(action('capacity', T(L, 'Wasserlinie öffnen', 'Open waterline'), 'navigate', { view: 'capacity', quarter: q, ...(tid ? { teamId: tid } : {}) }, T(L, `Öffnet die Wasserlinie für ${F.quarter(q)}.`, `Opens the waterline for ${F.quarter(q)}.`)));
    s.followUps.push(follow(T(L, 'Nächstes Quartal', 'Next quarter'), T(L, 'und im nächsten Quartal?', 'and the next quarter?')), follow(T(L, 'Was passt realistisch?', 'What fits realistically?'), T(L, 'Was passt ohne Überstunden?', 'What fits without overtime?')), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')));
    s.how = { text: T(L, 'Je Team und Quartal: Kapazität = Wochenstunden × 12 × Projektanteil × (1 − Ausfallquote); zuerst die Support-Reserve, dann der Bedarf der Projekte in Rang-Reihenfolge (Restschätzung + offene T-Shirt Size). Ab dem Rang, an dem die Summe die Kapazität übersteigt, ist nicht mehr voll besetzbar.', 'Per team and quarter: capacity = weekly hours × 12 × project share × (1 − absence rate); first the support reserve, then the projects\' demand in rank order (remaining estimate + open T-shirt size). From the rank where the running total exceeds capacity, work cannot be fully staffed.'),
      inputs: [[T(L, 'Quartal', 'Quarter'), F.quarter(q)], [T(L, 'Teams', 'Teams'), String(cells.length)], [T(L, 'Status', 'Status'), short.length ? wlName('no', L) : wlName('ok', L)]] };
    s.confidence = 'high';
    s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity'), 'Support'];
    return done(s);
  },
};
