// Local design work: believable KI-Assistent answers (open the app with ?mock&ai=on). The facts are built exactly as on
// the server (shared/aiAssist.js – same minimisation, so "Was wurde gesendet?" shows the real thing); the "model" is
// the cockpit's own rules plus some hand-written wording. Never part of a production bundle (see lib/api.js).
import { buildFacts, fallbackFor, finish, ASSIST_FEATURES } from '@shared/aiAssist.js';

const de = (lang) => lang !== 'en';
export function mockAssist(p, { config, dataset, comments = null }) {
  const feature = p?.feature;
  if (!ASSIST_FEATURES.includes(feature) || config.ai?.enabled !== true || config.ai.features?.[feature] === false) return { ok: false, error: { code: 'AI_DISABLED', message: 'AI_DISABLED' } };
  const lang = p.lang === 'en' ? 'en' : 'de';
  const D = de(lang);
  const share = { names: config.ai.shareNames === true, texts: config.ai.shareTexts === true };
  let built;
  const ids = feature === 'similarSummary' && share.texts ? (p.items || []).map((x) => String(x?.id ?? '')).filter((x) => /^d{1,18}$/.test(x)) : [];
  try { built = buildFacts(feature, p, { share, ds: feature === 'teamBrief' || feature === 'projectBrief' ? { ...dataset(), config } : null, comments: ids.length && comments ? comments(ids) : null }); }
  catch (e) { return { ok: false, error: { code: e.code || 'INVALID', message: e.message } }; }
  const f = built.facts;
  const r = fallbackFor(built, lang);
  switch (feature) {
    case 'planning': {
      const over = f.notes.length;
      r.text = D
        ? `Diese Woche ist vor allem ${f.suggestions.find((s) => s.mode === 'smooth')?.who || 'ein Teammitglied'} überlastet. Am meisten bringt es, zuerst die Überlast zu glätten und erst danach zu beschleunigen – so bleibt der Plan ruhig.${over ? ` ${over} Überlast-Hinweis${over === 1 ? '' : 'e'} lassen sich so nicht lösen.` : ''}`
        : `This week ${f.suggestions.find((s) => s.mode === 'smooth')?.who || 'one team member'} is overloaded most. Smoothing the overload first and speeding up afterwards gives the calmest plan.${over ? ` ${over} overload note${over === 1 ? '' : 's'} cannot be solved this way.` : ''}`;
      r.reasoning = D ? 'Glätten entlastet die Wochen über dem Ziel; Umverteilen nur an Personen mit Luft in allen Wochen; Beschleunigungen zuletzt, damit keine neue Überlast entsteht.' : 'Smoothing relieves the weeks above target; rebalancing only to people with room in every week; speed-ups last so no new overload appears.';
      r.confidence = 'medium';
      break;
    }
    case 'gaps': {
      if (!r.suggestion && f.gap.usage === 'tshirt' && f.sizes.length) r.suggestion = { usage: 'tshirt', value: f.sizes[Math.min(1, f.sizes.length - 1)].key };
      if (!r.suggestion && (f.gap.usage === 'startDate' || f.gap.usage === 'dueDate') && f.dateOptions.length) r.suggestion = { usage: f.gap.usage, value: f.gap.usage === 'startDate' ? f.dateOptions[0] : f.dateOptions.at(-1) };
      r.basedOn = f.similar.slice(0, 3).map((x) => x.key);
      r.why = D ? `Ähnliche Vorgänge (${r.basedOn.join(', ') || '–'}) liegen in derselben Größenordnung.` : `Similar work items (${r.basedOn.join(', ') || '–'}) are of the same order.`;
      r.reasoning = D ? 'Geschwister unter demselben Parent sind am aussagekräftigsten; Ausreißer zählen weniger. Termine stammen nur aus vorhandenen Daten.' : 'Siblings under the same parent say the most; outliers count less. Dates only come from existing data.';
      r.confidence = r.suggestion ? 'medium' : null;
      break;
    }
    case 'dispatch':
      r.reasoning = D ? 'Dringendste SLA zuerst; Team über Komponente und Verlauf, Person mit der geringsten Auslastung, niemand Abwesendes.' : 'Most urgent SLA first; team via component and history, the person with the lowest load, nobody absent.';
      break;
    case 'planActual': {
      const k = f.kpis, top = f.shortfalls[0], sup = f.rows.find((x) => x.kind === 'support');
      r.text = D
        ? `Von ${k.plannedH} h geplanter Zeit sind ${k.asPlannedPct ?? 0} % dort gelandet, wo sie geplant waren. ${k.divertedH} h sind abgeflossen${sup && sup.diffH > 0 ? `, vor allem in den Support (+${sup.diffH} h über der Reserve)` : ''}.${top ? ` Am stärksten getroffen hat es ${top.project} mit ${top.diffH} h.` : ''}`
        : `Of ${k.plannedH} h planned, ${k.asPlannedPct ?? 0}% landed where planned. ${k.divertedH} h went elsewhere${sup && sup.diffH > 0 ? `, mostly into support (+${sup.diffH} h above the reserve)` : ''}.${top ? ` ${top.project} was hit hardest with ${top.diffH} h.` : ''}`;
      r.points = D ? ['Support-Reserve an den tatsächlichen Bedarf der letzten vier Wochen anpassen.', top ? `Für ${top.project} die betroffenen Personen in der nächsten Wochenplanung entlasten.` : 'Wochenplanung beibehalten.', 'Ungeplante Abwesenheiten früher in der Kapazität eintragen.']
        : ['Adjust the support reserve to the actual need of the last four weeks.', top ? `Relieve the people affected on ${top.project} in the next weekly plan.` : 'Keep the weekly plan.', 'Enter unplanned absences earlier in capacity.'];
      r.reasoning = D ? 'Die Verschiebung erklärt sich zum größten Teil aus Support über der Reserve; der Rest aus Abwesenheiten.' : 'The shift is mostly support above the reserve; the rest absences.';
      r.confidence = 'high';
      break;
    }
    case 'teamBrief': {
      const [q, c] = Object.entries(f.quarters)[0] || [];
      r.text = D
        ? `${f.team.name} trägt ${f.projects.length} Projekte mit ${f.people} Personen.${q ? ` Im ${q} liegt die Auslastung bei ${c.utilPct} %${c.freeH < 0 ? ` – es fehlen ${-c.freeH} h, Projekte mit niedrigem Rang werden nicht voll besetzt` : ''}.` : ''} ${f.blocked} Aufgaben sind blockiert, ${f.pastDue} überfällig (bis ${f.maxDaysPastDue} Tage). Der größte Hebel: Blockaden lösen, bevor neue Arbeit startet.`
        : `${f.team.name} carries ${f.projects.length} projects with ${f.people} people.${q ? ` In ${q} utilization is ${c.utilPct}%${c.freeH < 0 ? ` – ${-c.freeH} h are missing, low-ranked projects are not fully staffed` : ''}.` : ''} ${f.blocked} tasks are blocked, ${f.pastDue} past due (up to ${f.maxDaysPastDue} days). Biggest lever: clear blockers before starting new work.`;
      r.points = D ? ['Blockierte Aufgaben im Daily klären.', 'Überfällige Termine neu planen oder abschließen.', 'Kapazität für das nächste Quartal mit dem Portfolio abstimmen.'] : ['Clear blocked tasks in the daily.', 'Re-plan or finish past-due work.', 'Align next quarter\'s capacity with the portfolio.'];
      r.reasoning = D ? 'Auslastung und Blockaden zusammen bestimmen, ob die Termine der höher priorisierten Projekte halten.' : 'Load and blockers together decide whether higher-ranked projects keep their dates.';
      r.confidence = 'medium';
      break;
    }
    case 'projectBrief':
      r.text = D
        ? `${f.project} steht bei ${f.progressPct} % Fortschritt${f.health ? ` (Health: ${{ onTrack: 'im Plan', atRisk: 'gefährdet', critical: 'kritisch' }[f.health.status]})` : ''}. ${f.overdueItems ? `${f.overdueItems} Stories sind über dem Due Date. ` : ''}Die Datenqualität liegt bei ${f.dataQualityPct} %; ${f.actions.length} offene Punkte stehen in der Liste – die wichtigsten zuerst angehen.`
        : `${f.project} is at ${f.progressPct}% progress${f.health ? ` (health: ${f.health.status})` : ''}. ${f.overdueItems ? `${f.overdueItems} stories are past due. ` : ''}Data quality is ${f.dataQualityPct}%; ${f.actions.length} open points are listed – tackle the most important first.`;
      r.points = f.actions.slice(0, 3).map((a) => (D ? `${{ overdue: 'Überfällig', conflict: 'Terminkonflikt', capacity: 'Kapazität', gap: 'Lücke' }[a.kind] || a.kind}${a.task ? ` ${a.task}` : ''}${a.team ? ` (${a.team})` : ''} klären` : `Resolve ${a.kind}${a.task ? ` ${a.task}` : ''}${a.team ? ` (${a.team})` : ''}`));
      r.reasoning = D ? 'Überfällige Arbeit und Engpässe im nächsten Quartal gefährden den Termin am stärksten.' : 'Past-due work and next quarter\'s bottlenecks threaten the date most.';
      r.confidence = 'medium';
      break;
    case 'myWeek': {
      r.comments = [...built.index.cells.entries()].filter(([, c]) => !c.comment).slice(0, 6).map(([h, c], i) => ({ cell: h, issueId: c.issueId, key: c.key, d: c.d, h: c.h, previous: '', comment: (D ? ['Umsetzung und Abstimmung mit dem Fachbereich', 'Review-Anmerkungen eingearbeitet', 'Tests ergänzt, Fehler behoben', 'Feldliste fertiggestellt'] : ['Implementation and alignment with the business', 'Review comments addressed', 'Tests added, bugs fixed', 'Field list finished'])[i % 4] }));
      r.text = D ? `${r.text} Schwerpunkt war die Umsetzung mit Abstimmungen im Fachbereich; Review-Anmerkungen sind eingearbeitet.` : `${r.text} The focus was implementation with alignment in the business; review comments are addressed.`;
      r.reasoning = D ? 'Aus deinen Statuswechseln und Kommentaren der jeweiligen Tage abgeleitet.' : 'Derived from your status changes and comments on those days.';
      r.confidence = 'medium';
      break;
    }
    case 'similarSummary':
      r.text = D ? `${r.text} Bei ähnlicher Arbeit hat vor allem geholfen, früh mit dem Fachbereich abzustimmen und vorhandene Bausteine wiederzuverwenden.` : `${r.text} What helped most in similar work: aligning early with the business and reusing existing building blocks.`;
      r.points = D ? ['Puffer für die Abnahme einplanen.', 'Vorhandene Services wiederverwenden statt neu bauen.'] : ['Plan a buffer for acceptance.', 'Reuse existing services instead of building new ones.'];
      r.reasoning = D ? 'Aus Stunden, Überzug und – wenn erlaubt – den letzten Kommentaren der ähnlichen Vorgänge.' : 'From hours, overrun and – if allowed – the last comments of the similar items.';
      r.confidence = 'medium';
      break;
    case 'playbookDraft':
      r.reasoning = D ? 'Symptome aus den Beispiel-Tickets; Schritte, die die Tickets nicht hergeben, sind als [Platzhalter] markiert.' : 'Symptoms from the example tickets; steps the tickets do not tell are marked as [placeholders].';
      r.confidence = 'medium';
      break;
    case 'intent': {
      // the "model" understands a few everyday phrasings the rules do not (shows "LLM teaches Lotse" in the mock)
      const w = String(f.wish || '').toLowerCase();
      const hit = [[/hakt|klemmt|haengt|hängt|stuck|stalled/, 'blocked'], [/brennt|on fire|dringend|urgent/, 'attention'], [/luft|spielraum|room|slack/, 'realCapacity']].find(([re]) => re.test(w));
      if (!r.card && hit) { r.card = hit[1]; r.why = D ? 'Der Wunsch beschreibt das in Alltagsworten.' : 'The wish describes this in everyday words.'; r.confidence = 'medium'; }
      break;
    }
    default: break;
  }
  return { ok: true, data: finish(built, r, { source: 'ai', model: 'mock-llm', lang }) };
}
