// The app icon (boss 2026-11-20, portfolio-cockpit-icon.svg): an orange rounded tile with a white gauge – a ring with
// a gap at the bottom, its last part lighter – and a white dot in the middle. One description for every place that draws
// it: the header and the other tiles (lib/icons.jsx → Logo, as SVG), the Jira menu icon (static/cockpit/public/icon.svg)
// and the PDFs (lib/pdfLogo.js, as Bézier curves). Coordinates in the icon's own 512 × 512 box.
export const ICON = {
  box: 512, rx: 112, tile: '#D04403',
  // the light track (the whole gauge) and the white part on top of it; angles in degrees, 0° = right, clockwise (y down)
  ring: { cx: 256, cy: 256, r: 148, width: 46, from: 135, to: 405, valueTo: 340 },
  track: { color: '#FFFFFF', opacity: 0.35 },
  dot: { cx: 256, cy: 256, r: 54 },
};
// The light track blended on the tile (for PDFs, which draw without transparency): 35 % white over #D04403.
export const TRACK_ON_TILE = [224, 133, 91];

const rad = (d) => (d * Math.PI) / 180;
const pt = (cx, cy, r, d) => [cx + r * Math.cos(rad(d)), cy + r * Math.sin(rad(d))];
// SVG path of a circular arc from angle a0 to a1 (clockwise, degrees)
export function arcPath({ cx, cy, r }, a0, a1) {
  const [x0, y0] = pt(cx, cy, r, a0), [x1, y1] = pt(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  const f = (n) => Math.round(n * 10) / 10;
  return `M${f(x0)},${f(y0)} A${r},${r} 0 ${large} 1 ${f(x1)},${f(y1)}`;
}
// The same arc as cubic Bézier segments (≤ 90° each): [{ op: 'm', c: [x, y] }, { op: 'c', c: [x1, y1, x2, y2, x, y] }, …]
export function arcBeziers({ cx, cy, r }, a0, a1) {
  const n = Math.max(1, Math.ceil((a1 - a0) / 90));
  const step = (a1 - a0) / n;
  const k = (4 / 3) * Math.tan(rad(step) / 4);
  const out = [{ op: 'm', c: pt(cx, cy, r, a0) }];
  for (let i = 0; i < n; i++) {
    const s = rad(a0 + i * step), e = rad(a0 + (i + 1) * step);
    const p0 = [cx + r * Math.cos(s), cy + r * Math.sin(s)], p3 = [cx + r * Math.cos(e), cy + r * Math.sin(e)];
    const p1 = [p0[0] - k * r * Math.sin(s), p0[1] + k * r * Math.cos(s)];
    const p2 = [p3[0] + k * r * Math.sin(e), p3[1] - k * r * Math.cos(e)];
    out.push({ op: 'c', c: [...p1, ...p2, ...p3] });
  }
  return out;
}
// The whole icon as SVG markup (the Jira menu icon is this file)
export function iconSvg() {
  const { box, rx, tile, ring, track, dot } = ICON;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}"><rect width="${box}" height="${box}" rx="${rx}" fill="${tile}"/>`
    + `<path d="${arcPath(ring, ring.from, ring.to)}" fill="none" stroke="${track.color}" stroke-opacity="${track.opacity}" stroke-width="${ring.width}" stroke-linecap="round"/>`
    + `<path d="${arcPath(ring, ring.from, ring.valueTo)}" fill="none" stroke="#FFFFFF" stroke-width="${ring.width}" stroke-linecap="round"/>`
    + `<circle cx="${dot.cx}" cy="${dot.cy}" r="${dot.r}" fill="#FFFFFF"/></svg>`;
}
