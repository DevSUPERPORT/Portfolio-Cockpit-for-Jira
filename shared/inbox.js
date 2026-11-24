// "Heute zu tun": what this person should do today, each with its one-click action.
//   health      – health updates due (own projects; all projects for people who may update every health)
//   suggestions – smart suggestions ready to apply (rule-based, each with its reason)
//   blocked     – stories and sub-tasks blocked for more than a week, oldest first
// Pure: the view decides how to run the actions (all through the normal permission-checked writes, with undo).
import { smartSuggestions } from './smart.js';

const DAY = 864e5;

export function todayInbox({ computed, me = null, roles = {}, lang = 'de', now = Date.now() } = {}) {
  if (!computed) return { health: [], suggestions: null, blocked: [], total: 0 };
  const { model, deps } = computed;
  const rhythm = (model.cfg.rules?.healthRhythmDays || 7) * DAY;
  const all = !!(roles.editHealth || roles.manageRanking);
  const active = model.items.filter((p) => (p.statusCat ?? 'new') !== 'done');
  const health = active
    .filter((p) => (all || (me?.id && p.owner?.id === me.id)) && (!p.health || now - Date.parse(p.health.at) > rhythm))
    .map((p) => ({ ref: p.ref, name: p.name, rank: p.rank, mine: !!(me?.id && p.owner?.id === me.id), status: p.health?.status || null, comment: p.health?.comment || '', days: p.health ? Math.floor((now - Date.parse(p.health.at)) / DAY) : null }))
    .sort((a, b) => (b.mine - a.mine) || ((b.days ?? 1e9) - (a.days ?? 1e9)) || a.rank - b.rank);
  const list = smartSuggestions(computed, { lang });
  const byField = {};
  for (const s of list) byField[s.usage] = (byField[s.usage] || 0) + 1;
  const suggestions = list.length ? { n: list.length, byField, list } : null;
  const blocked = (deps.blocked || []).filter((b) => b.days != null && b.days > 7).map((b) => {
    const i = model.byId.get(b.id);
    return { id: b.id, key: i?.key, summary: i?.summary || '', days: b.days, reason: b.reason, rootRef: i?.rootRef, project: model.itemByRef.get(i?.rootRef)?.name || '' };
  });
  return { health, suggestions, blocked, total: health.length + (suggestions ? 1 : 0) + blocked.length };
}
