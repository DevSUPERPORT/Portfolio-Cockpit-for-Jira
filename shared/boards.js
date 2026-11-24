// Ask boards per role: a board is a list of questions, so it always opens with today's numbers (the answers are
// computed from the live data when the board opens – nothing is stored but the questions and where the cards sit).
// Pure: used by the Ask view and by the tests (every template question must have a real analysis behind it).

const T = (lang, de, en) => (lang === 'de' ? de : en);

export function roleBoards({ computed, me = null, roles = {}, lang = 'de', hasSupport = false } = {}) {
  const L = lang;
  const mine = computed && me?.id ? computed.model.items.filter((p) => p.owner?.id === me.id && (p.statusCat ?? 'new') !== 'done') : [];
  const boards = [
    {
      id: 'mgmt', icon: 'report', name: T(L, 'Management', 'Management'),
      desc: T(L, 'Health, Wasserlinie, Fortschritt, Termine', 'Health, waterline, progress, dates'),
      questions: [
        T(L, 'Wie ist die Health der Projekte?', 'How is the health of the projects?'),
        T(L, 'Ab welchem Rang reicht die Kapazität nicht mehr?', 'From which rank does capacity run out?'),
        T(L, 'Fortschritt aller Projekte als Balken', 'Progress of all projects as bars'),
        T(L, 'Wie stehen die Meilensteine?', 'How are the milestones?'),
        T(L, 'Was ist überfällig?', 'What is overdue?'),
        ...(hasSupport ? [T(L, 'Wie stehen Support und SLAs?', 'How are support and SLAs doing?')] : []),
      ],
    },
    {
      id: 'lead', icon: 'users', name: T(L, 'Teamleitung', 'Team lead'),
      desc: T(L, 'Auslastung, Blockaden, Abhängigkeiten, Zeit, Lücken', 'Utilisation, blockers, dependencies, time, gaps'),
      questions: [
        T(L, 'Auslastung der Teams als Heatmap', 'Team utilisation as a heatmap'),
        T(L, 'Was ist blockiert?', 'What is blocked?'),
        T(L, 'Zeig die Abhängigkeiten als Netz', 'Show the dependencies as a network'),
        T(L, 'Schätzung gegen gebuchte Zeit', 'Estimate vs logged time'),
        T(L, 'Was ist überfällig?', 'What is overdue?'),
        T(L, 'Wo fehlen Daten?', 'Where is data missing?'),
      ],
    },
    {
      id: 'owner', icon: 'project', name: T(L, 'Projekt-Owner', 'Project owner'),
      desc: mine.length ? T(L, `${mine.length === 1 ? 'Dein Projekt' : `Deine ${mine.length} Projekte`}, Lücken, Blockaden`, `Your ${mine.length === 1 ? 'project' : `${mine.length} projects`}, gaps, blockers`) : T(L, 'Aufmerksamkeit, Lücken, Blockaden', 'Attention, gaps, blockers'),
      questions: [
        T(L, 'Was braucht jetzt meine Aufmerksamkeit?', 'What needs my attention now?'),
        ...(mine.length ? mine.slice(0, 2).map((p) => T(L, `Wie weit ist ${p.name}?`, `How far along is ${p.name}?`)) : [T(L, 'Fortschritt aller Projekte als Balken', 'Progress of all projects as bars')]),
        T(L, 'Wo fehlen Daten?', 'Where is data missing?'),
        T(L, 'Was ist blockiert?', 'What is blocked?'),
        T(L, 'Wie stehen die Meilensteine?', 'How are the milestones?'),
      ],
    },
  ];
  // the board that fits this person best is offered first
  const best = mine.length ? 'owner' : roles.manageRanking || roles.viewReport ? 'mgmt' : roles.editCapacity ? 'lead' : 'mgmt';
  return boards.map((b) => ({ ...b, recommended: b.id === best })).sort((a, b) => b.recommended - a.recommended);
}

// Saved boards (per person, in the preferences): bounded and sanitised on the server as well.
export const MAX_BOARDS = 10;
export const boardName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
