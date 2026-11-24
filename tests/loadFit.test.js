// Boss 2026-11-20: "139 % / 125 % / 250 % – but it is always me. Not so easy to understand with the numbers; simpler,
// better visuals for inexperienced users; keep the percentage" – and: use the new app icon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitOf, barOf, roundH } from '../shared/loadFit.js';
import { ICON, arcPath, arcBeziers, iconSvg } from '../shared/logo.js';
import { lotseDataset } from './lotseFixture.js';
import { computeAll } from '../shared/engine.js';
import { buildBoard, personBoardWeeks, distributionOf } from '../shared/weekPlan.js';
import { drawLogo } from '../static/cockpit/src/lib/pdfLogo.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('fitOf: plain words on the same thresholds as the colours (≤ 85 % room · ≤ 100 % nearly full · above too much)', () => {
  assert.deepEqual(fitOf(40, 32), { kind: 'over', util: 1.25, over: 8, free: 0, load: 40, avail: 32 });
  assert.equal(fitOf(28, 32).kind, 'full'); // 87.5 %
  assert.equal(fitOf(32, 32).kind, 'full'); // exactly full is not "too much"
  assert.deepEqual(fitOf(10, 32), { kind: 'ok', util: 10 / 32, over: 0, free: 22, load: 10, avail: 32 });
  assert.equal(fitOf(12, 0).kind, 'noTime');
  assert.equal(fitOf(0, 0).kind, 'none');
  assert.equal(roundH(7.13), 7.1);
  assert.equal(roundH(12.4), 12);
  assert.equal(roundH(0.01), 0.1, 'never "0 h too much"');
});

test('barOf: the capacity line, what fits and the part beyond it – 125 % reads as "a quarter more than fits"', () => {
  const b = barOf(fitOf(40, 32));
  assert.equal(b.cap, 0.8);
  assert.equal(b.fill, 0.8);
  assert.ok(Math.abs(b.over - 0.2) < 1e-9);
  assert.deepEqual(barOf(fitOf(16, 32)), { cap: 1, fill: 0.5, over: 0 });
  assert.deepEqual(barOf(fitOf(5, 0)), { cap: 0, fill: 0, over: 1 });
});

test('My work shows exactly the weekly board\'s numbers for the person (no more 139 % next to 125 %)', () => {
  const ds = lotseDataset();
  const computed = computeAll(ds);
  const dist = distributionOf(ds.config?.rules?.distribution);
  let checked = 0;
  for (const pid of ['u1', 'u3', 'u7', 'u12']) {
    const mine = personBoardWeeks({ ds, computed, personId: pid, weeks: 8, distribution: dist });
    assert.ok(mine, pid);
    // every team board the person appears on shows the same load and time for them
    for (const team of computed.model.teams.keys()) {
      const board = buildBoard({ ds, computed, team, mode: 'people', weeks: 8, distribution: dist });
      const row = board.rows.find((r) => r.kind === 'person' && r.accountId === pid);
      if (!row) continue;
      row.cells.forEach((c, i) => {
        assert.ok(Math.abs((c.load || 0) - mine[i].load) < 1e-6, `${pid} ${team} W${i} load`);
        assert.ok(Math.abs((c.avail || 0) - mine[i].avail) < 1e-6, `${pid} ${team} W${i} avail`);
        checked++;
      });
    }
  }
  assert.ok(checked >= 32, `${checked} person-weeks`);
  const src = read('static/cockpit/src/views/Mine.jsx');
  assert.match(src, /personBoardWeeks\(\{ ds: app\.ds \|\| computed\.model\.ds, computed, personId: me\.id, weeks: 8, distribution, lang, reasons: true \}\)/);
  assert.match(src, /useDistribution\(config\)/, 'the same distribution switch as the board');
  assert.match(src, /dieselbe Zahl wie bei Teams und in der Wochenplanung/);
});

test('board and My work: words first, a bar, the percentage small; project rows say they count the team time', () => {
  const wb = read('static/cockpit/src/components/WeekBoard.jsx');
  assert.ok((wb.match(/<FitWords fit=\{fit\} \/>/g) || []).length >= 5, 'person, project, project rows, team rows, total');
  assert.ok((wb.match(/<FitBar fit=\{fit\} \/>/g) || []).length >= 5);
  // project rows: the team's time with what split people's other teams leave unused – the same overload as the person (2026-11-20)
  assert.match(wb, /Darum steht hier dieselbe Überlast wie bei der Person selbst/);
  assert.match(wb, /dieselbe Zahl in Meine Arbeit, Teams und Wochenplanung/);
  const lf = read('static/cockpit/src/components/LoadFit.jsx');
  for (const w of ['zu viel', 'too much', 'fast voll', 'nearly full', 'frei', 'free', 'keine Zeit', 'no time']) assert.ok(lf.includes(w), w);
  const mine = read('static/cockpit/src/views/Mine.jsx');
  assert.match(mine, /mine-strip-fill/, 'each week a small gauge');
  assert.match(mine, /mine-legend/);
  const css = read('static/cockpit/src/styles.css');
  assert.match(css, /\.fit-bar \.fit-over \{/, 'the shared bar styles are global (My work does not load the board)');
});

test('the new app icon: one geometry for the header, the Jira menu icon and the PDFs – exactly the boss\'s SVG', () => {
  const given = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#D04403"/><path d="M151.3,360.7 A148,148 0 1 1 360.7,360.7" fill="none" stroke="#FFFFFF" stroke-opacity=".35" stroke-width="46" stroke-linecap="round"/><path d="M151.3,360.7 A148,148 0 1 1 395.1,205.4" fill="none" stroke="#FFFFFF" stroke-width="46" stroke-linecap="round"/><circle cx="256" cy="256" r="54" fill="#FFFFFF"/></svg>';
  assert.equal(read('static/cockpit/public/icon.svg').trim(), given, 'the Jira menu icon is the file the boss sent');
  assert.equal(iconSvg().replace('stroke-opacity="0.35"', 'stroke-opacity=".35"'), given, 'the generated geometry is the same');
  assert.equal(arcPath(ICON.ring, ICON.ring.from, ICON.ring.valueTo), 'M151.3,360.7 A148,148 0 1 1 395.1,205.4');
  // the Bézier version ends where the arc ends (PDF)
  const segs = arcBeziers(ICON.ring, ICON.ring.from, ICON.ring.valueTo);
  const end = segs.at(-1).c.slice(-2);
  assert.ok(Math.abs(end[0] - 395.1) < 0.1 && Math.abs(end[1] - 205.4) < 0.1, end.join(','));
  // PDF: tile, both arcs, the dot – drawn on a fake jsPDF
  const calls = [];
  const doc = new Proxy({}, { get: (_, k) => (...a) => calls.push([k, ...a]) });
  drawLogo(doc, 10, 10, 16);
  assert.deepEqual(calls.filter((c) => ['roundedRect', 'stroke', 'circle'].includes(c[0])).map((c) => c[0]), ['roundedRect', 'stroke', 'stroke', 'circle']);
  assert.deepEqual(calls.find((c) => c[0] === 'setFillColor'), ['setFillColor', 208, 68, 3]);
  const icons = read('static/cockpit/src/lib/icons.jsx');
  assert.match(icons, /export function Logo\(\{ size = 38 \}\)/);
  assert.ok(!/1331\.86/.test(icons), 'the old mark is gone');
  assert.match(read('manifest.yml'), /icon: resource:main;icon\.svg/);
});
