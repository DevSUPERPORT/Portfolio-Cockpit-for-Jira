// Work items WITHOUT a parent (boss 2026-11-19: "stories without parent are not part of the structure and Action
// needed – it's only visible on My work but not in the project"). The dataset brings them in (src/lib/dataset.js
// loadOrphans); this decides which work items of a project can become their parent – the level directly above:
//   a story → an epic (structure) of the project, else a workstream (rough), else the project itself
//   an epic → a workstream, else the project · a workstream → the project
// With the hierarchy numbers of the configuration (Konfiguration › Hierarchie) the level directly above wins; Jira
// checks the hierarchy again when the parent is written.
const UP = { estimate: ['structure', 'rough', 'portfolio'], structure: ['rough', 'portfolio'], rough: ['portfolio'] };

export function parentChoices(model, cfg, ref, orphan) {
  if (!model || !ref || !orphan || !UP[orphan.role]) return [];
  const levels = cfg?.levels || [];
  const hOf = (key) => { const h = levels.find((l) => l.key === key)?.hierarchy; return Number.isInteger(h) ? h : null; };
  const item = model.itemByRef.get(ref);
  const own = (model.byRoot.get(ref) || []).filter((i) => i.id !== orphan.id && !i.orphan && i.status?.cat !== 'done');
  const project = item && item.kind === 'issue' && item.id ? [{ id: String(item.id), key: item.key, summary: item.name, role: 'portfolio' }] : [];
  const ofRole = (role) => (role === 'portfolio' ? project : own.filter((i) => i.role === role).map((i) => ({ id: i.id, key: i.key, summary: i.summary, role: i.role, levelKey: i.levelKey })));
  const sortKey = (a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true });
  // the configured hierarchy: exactly one level above
  const h = hOf(orphan.levelKey);
  if (h != null) {
    const above = own.filter((i) => hOf(i.levelKey) === h + 1).map((i) => ({ id: i.id, key: i.key, summary: i.summary, role: i.role, levelKey: i.levelKey }));
    if (above.length) return above.sort(sortKey);
  }
  for (const role of UP[orphan.role]) {
    const list = ofRole(role);
    if (list.length) return list.sort(sortKey);
  }
  return [];
}

// The parentless work items of a project: its own (space with only this project) and the unclear ones of a shared space.
export function orphansOf(model, ref) {
  const own = (model?.byRoot.get(ref) || []).filter((i) => i.orphan);
  const unclear = (model?.ds?.orphans || []).filter((o) => (o.candidates || []).includes(ref));
  return { own, unclear };
}
