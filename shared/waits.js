// "wartet auf <Projekt> (Rang n)" (UC-03): which portfolio projects a project waits for, through the
// configured link types. Open links only; orange when a date collides or the prerequisite ranks lower.
// Pure – used by the portfolio rows and the C-level report.

// once per computed object (the portfolio rows and the report ask for it on every render; it only reads `computed`)
const memo = new WeakMap();
export function waitsFor(computed) {
  if (computed && typeof computed === 'object') {
    if (!memo.has(computed)) memo.set(computed, waitsForUncached(computed));
    return memo.get(computed);
  }
  return waitsForUncached(computed);
}
function waitsForUncached(computed) {
  const { model, deps } = computed;
  const rankOf = (ref) => model.itemByRef.get(ref)?.rank ?? null;
  const get = (id) => model.byId.get(id) || model.external?.get(id);
  const by = new Map(); // dependent ref -> Map(prerequisite ref -> entry)
  for (const d of deps?.list || []) {
    if (!d.open) continue;
    const pre = get(d.pre), dep = get(d.dep);
    const a = pre?.rootRef, b = dep?.rootRef;
    if (!a || !b || a === b || !model.itemByRef.has(a) || !model.itemByRef.has(b)) continue;
    const m = by.get(b) || by.set(b, new Map()).get(b);
    const e = m.get(a) || m.set(a, { ref: a, name: model.itemByRef.get(a).name, rank: rankOf(a), items: 0, conflicts: 0, keys: [] }).get(a);
    e.items += 1;
    if (d.conflict) e.conflicts += 1;
    if (e.keys.length < 4) e.keys.push(`${pre.key} → ${dep.key}`);
  }
  const out = new Map();
  for (const [ref, m] of by) {
    const myRank = rankOf(ref);
    const list = [...m.values()].map((e) => ({ ...e, lowerRank: e.rank != null && myRank != null && e.rank > myRank }))
      .sort((x, y) => (y.conflicts - x.conflicts) || (Number(y.lowerRank) - Number(x.lowerRank)) || ((x.rank ?? 999) - (y.rank ?? 999)));
    out.set(ref, { list, hot: list.some((e) => e.conflicts || e.lowerRank), items: list.reduce((s, e) => s + e.items, 0), conflicts: list.reduce((s, e) => s + e.conflicts, 0) });
  }
  return out;
}

// One line for the chip: "wartet auf ERP (Rang 3) · Terminkonflikt +1"
export function waitsLabel(w, T = (de) => de) {
  if (!w?.list?.length) return '';
  const f = w.list[0];
  const why = f.conflicts ? T(' · Terminkonflikt', ' · date conflict') : f.lowerRank ? T(' · niedrigerer Rang', ' · lower rank') : '';
  const more = w.list.length > 1 ? ` +${w.list.length - 1}` : '';
  return `${T('wartet auf', 'waits for')} ${f.name} (${T('Rang', 'rank')} ${f.rank})${why}${more}`;
}
