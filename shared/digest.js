// "Since your last visit": a compact per-project summary, and the meaningful differences between two.
// Pure functions; the backend only validates and stores the summaries.

const clamp01 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function digestSummary(ds, computed, max = 1500) {
  const { metrics, wl } = computed;
  const q = wl?.quarters?.[0];
  const items = {};
  const ranked = [...(ds.portfolio || [])].sort((a, b) => a.rank - b.rank).slice(0, max);
  for (const p of ranked) {
    const m = metrics.get(p.ref);
    const status = p.statusCat || (m?.done ? 'done' : null);
    items[p.ref] = {
      r: Number.isInteger(p.globalRank ?? p.rank) ? (p.globalRank ?? p.rank) : null,
      p: clamp01(m?.progress),
      h: p.health?.status || null,
      s: ['new', 'indeterminate', 'done'].includes(status) ? status : null,
      w: q ? wl.projectQ?.[p.ref]?.[q]?.status || null : null,
      d: day(m?.due),
    };
  }
  return items;
}

// Items that really moved: everything outside the longest run that kept its relative order.
// (One project dragged from 10 to 1 shifts nine others by one; only the dragged one is reported.)
function movedRefs(prevOrder, nextOrder) {
  const pos = new Map(prevOrder.map((r, i) => [r, i]));
  const seq = nextOrder.filter((r) => pos.has(r));
  const tails = [], tailIdx = [], parent = new Array(seq.length).fill(-1);
  seq.forEach((r, i) => {
    const v = pos.get(r);
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < v) lo = mid + 1; else hi = mid; }
    tails[lo] = v; tailIdx[lo] = i; parent[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  });
  const keep = new Set();
  for (let i = tailIdx[tails.length - 1] ?? -1; i >= 0; i = parent[i]) keep.add(seq[i]);
  return new Set(seq.filter((r) => !keep.has(r)));
}

const SEV = { ok: 0, partial: 1, no: 2 };
const HSEV = { onTrack: 0, atRisk: 1, critical: 2 };

// Returns { changes: [{ ref, kind, from, to, worse }], added, removed } for refs visible now.
export function digestDiff(base, now, { progressStep = 0.05 } = {}) {
  if (!base?.items) return null;
  const prev = base.items;
  const refs = Object.keys(now);
  const common = refs.filter((r) => prev[r]);
  const byRank = (src) => (a, b) => (src[a].r ?? 1e9) - (src[b].r ?? 1e9);
  const prevOrder = [...common].sort(byRank(prev)), nextOrder = [...common].sort(byRank(now));
  const moved = movedRefs(prevOrder, nextOrder);
  const changes = [];
  for (const ref of common) {
    const a = prev[ref], b = now[ref];
    if (moved.has(ref)) {
      const from = prevOrder.indexOf(ref) + 1, to = nextOrder.indexOf(ref) + 1;
      changes.push({ ref, kind: 'rank', from, to, worse: to > from });
    }
    if (a.s !== b.s && b.s === 'done') changes.push({ ref, kind: 'done', from: a.s, to: b.s, worse: false });
    if (a.h !== b.h && b.h) changes.push({ ref, kind: 'health', from: a.h, to: b.h, worse: (HSEV[b.h] ?? 0) > (HSEV[a.h] ?? 0) });
    if (a.w && b.w && a.w !== b.w) changes.push({ ref, kind: 'waterline', from: a.w, to: b.w, worse: SEV[b.w] > SEV[a.w] });
    if (a.d !== undefined && a.d !== b.d && (a.d || b.d)) changes.push({ ref, kind: 'due', from: a.d, to: b.d, worse: !!(a.d && b.d && b.d > a.d) || (!b.d && !!a.d) });
    if (a.p != null && b.p != null && Math.abs(b.p - a.p) >= progressStep) changes.push({ ref, kind: 'progress', from: a.p, to: b.p, worse: b.p < a.p });
  }
  // Worse news first, then by kind, then by current rank.
  const order = ['health', 'waterline', 'due', 'rank', 'done', 'progress'];
  changes.sort((x, y) => (y.worse - x.worse) || (order.indexOf(x.kind) - order.indexOf(y.kind)) || ((now[x.ref].r ?? 0) - (now[y.ref].r ?? 0)));
  return {
    at: base.at,
    changes,
    added: refs.filter((r) => !prev[r]),
    removed: Object.keys(prev).filter((r) => !now[r]).length,
  };
}
