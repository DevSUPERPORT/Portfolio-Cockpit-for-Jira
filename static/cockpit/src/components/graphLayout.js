// Deterministic force layout (same input → same picture), small enough to run on every render.
export function layoutGraph(nodes, edges, W = 1000, H = 640) {
  const n = nodes.length;
  const pos = nodes.map((_, i) => ({ x: W / 2 + Math.cos((i / n) * 2 * Math.PI) * W * 0.32, y: H / 2 + Math.sin((i / n) * 2 * Math.PI) * H * 0.32 }));
  const idx = new Map(nodes.map((x, i) => [x.id, i]));
  const E = edges.map((e) => [idx.get(e.from), idx.get(e.to)]).filter(([a, b]) => a != null && b != null);
  const k = Math.sqrt((W * H) / Math.max(1, n)) * 0.55;
  for (let it = 0; it < 220; it++) {
    const t = 1 - it / 220;
    const d = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y, dist = Math.max(1, Math.hypot(dx, dy));
      const f = (k * k) / dist / dist;
      d[i].x += dx * f; d[i].y += dy * f; d[j].x -= dx * f; d[j].y -= dy * f;
    }
    for (const [a, b] of E) {
      const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y, dist = Math.max(1, Math.hypot(dx, dy));
      const f = dist / k;
      d[a].x -= (dx / dist) * f * 6; d[a].y -= (dy / dist) * f * 6; d[b].x += (dx / dist) * f * 6; d[b].y += (dy / dist) * f * 6;
    }
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(d[i].x, d[i].y) || 1, step = Math.min(m, 24 * t + 1);
      pos[i].x = Math.min(W - 110, Math.max(110, pos[i].x + (d[i].x / m) * step + (W / 2 - pos[i].x) * 0.004));
      pos[i].y = Math.min(H - 40, Math.max(40, pos[i].y + (d[i].y / m) * step + (H / 2 - pos[i].y) * 0.004));
    }
  }
  return pos;
}
