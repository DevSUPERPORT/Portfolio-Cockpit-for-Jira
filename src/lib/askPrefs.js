// Ask canvas preferences per person, sanitised before they are stored (pure, unit-tested).
const ASK_VIEWS = new Set(['number', 'list', 'table', 'bar', 'donut', 'columns', 'line', 'heat', 'graph', 'text', 'near']);
const fin = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
export function validAsk(a) {
  const cards = (Array.isArray(a.cards) ? a.cards : []).slice(0, 60).map((c) => ({
    id: /^[a-z0-9]{1,16}$/.test(c?.id || '') ? c.id : Math.random().toString(36).slice(2, 10),
    q: String(c?.q ?? '').slice(0, 300), x: Math.round(fin(c?.x, -1e5, 1e5, 0)), y: Math.round(fin(c?.y, -1e5, 1e5, 0)), w: Math.round(fin(c?.w, 300, 1100, 440)),
    view: ASK_VIEWS.has(c?.view) ? c.view : 'text', sel: c?.sel === true, auto: c?.auto === true,
    ...(typeof c?.ai === 'string' ? { ai: c.ai.slice(0, 4000), title: String(c.title ?? '').slice(0, 300), source: ['ai', 'fallback', 'error'].includes(c.source) ? c.source : 'ai' } : {}),
  })).filter((c) => c.q.trim());
  const cam = a.cam && typeof a.cam === 'object' ? { x: Math.round(fin(a.cam.x, -1e6, 1e6, 0)), y: Math.round(fin(a.cam.y, -1e6, 1e6, 0)), z: fin(a.cam.z, 0.25, 1.6, 1) } : { x: 0, y: 0, z: 1 };
  const name = typeof a.name === 'string' ? a.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return { cards, cam, simple: a.simple === true, ...(name ? { name } : {}) };
}
// Saved Ask boards per person: at most 10, each a named board (questions + layout, the numbers stay live).
export function validBoards(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, 10).map((b) => {
    const v = validAsk(b && typeof b === 'object' ? b : {});
    const id = /^[a-z0-9]{1,16}$/.test(b?.id || '') ? b.id : Math.random().toString(36).slice(2, 10);
    return { id, name: v.name || 'Board', cards: v.cards.slice(0, 30), cam: v.cam, at: typeof b?.at === 'string' && !Number.isNaN(Date.parse(b.at)) ? new Date(b.at).toISOString() : new Date().toISOString() };
  }).filter((b) => b.cards.length && !seen.has(b.id) && seen.add(b.id));
}
