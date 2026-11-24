import { ICON, TRACK_ON_TILE, arcBeziers } from '../../../../shared/logo.js'; // relative: also runs in Node tests

// The app icon in PDFs (boss 2026-11-20): the orange tile with the white gauge and dot – the same geometry as the header
// (shared/logo.js), drawn as curves. `tile` is ignored: the icon has its own colour (kept for older callers).
export function drawLogo(doc, x, y, size) {
  const { box, rx, ring, dot } = ICON;
  const k = size / box;
  const at = (ops) => ops.map((o) => ({ op: o.op, c: o.c.map((v, i) => (i % 2 ? y + v * k : x + v * k)) }));
  doc.setFillColor(208, 68, 3);
  doc.roundedRect(x, y, size, size, rx * k, rx * k, 'F');
  if (doc.setLineCap) doc.setLineCap('round');
  doc.setLineWidth(ring.width * k);
  doc.setDrawColor(...TRACK_ON_TILE);
  doc.path(at(arcBeziers(ring, ring.from, ring.to)));
  doc.stroke();
  doc.setDrawColor(255, 255, 255);
  doc.path(at(arcBeziers(ring, ring.from, ring.valueTo)));
  doc.stroke();
  doc.setFillColor(255, 255, 255);
  doc.circle(x + dot.cx * k, y + dot.cy * k, dot.r * k, 'F');
}
