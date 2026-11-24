// Tester feedback 2026-11-10 (new Jira admin): guidance without slowing down experienced users.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const app = read('static/cockpit/src/App.jsx');
const tour = read('static/cockpit/src/components/Tour.jsx');
const undo = read('static/cockpit/src/components/UndoHistory.jsx');
const server = read('src/index.js');
const inbox = read('static/cockpit/src/components/Inbox.jsx');
const quality = read('static/cockpit/src/views/Quality.jsx');
const mine = read('static/cockpit/src/views/Mine.jsx');
const ui = read('static/cockpit/src/components/ui.jsx');

test('every tab explains itself in one sentence (hover, and the tour lists them)', () => {
  const tabs = [...app.matchAll(/\{ id: '([a-z]+)', icon: '[a-z]+', label: [^\n]*?\}/g)].map((m) => m[0]);
  // the plan's tab order (2026-11-11): Meine Arbeit · Portfolio · Projekte · Teams · Wochenplanung · Plan vs. Ist · Support · C-Level-Report (+ Konfiguration)
  assert.deepEqual(tabs.map((t) => /id: '([a-z]+)'/.exec(t)[1]), ['mine', 'portfolio', 'project', 'team', 'plan', 'time', 'support', 'report', 'config']);
  for (const t of tabs) assert.match(t, /desc: tr\(/, t.slice(0, 60));
  assert.match(app, /tip\(infoCard\(\{ title: t\.label, text: t\.desc \}\)\)/);
  assert.match(tour, /tabs\.filter\(\(t\) => t\.desc\)\.map/);
});

test('guides appear once: closing the tour – also by skipping – marks it seen; it never starts by itself again', () => {
  assert.match(app, /const endTour = \(\) => \{ setTour\(false\); if \(!tourSeen\.current\) \{ tourSeen\.current = true; call\('prefs\.save', \{ tourDone: true \}\)/);
  assert.match(app, /if \(employee \|\| tourSeen\.current \|\| stale/);
  assert.match(tour, /tr\('Überspringen', 'Skip'\)/);
  // skip on the first step, × on the others: both end the tour as "not completed" – endTour still marks it seen
  assert.match(tour, /i === 0\s*\? <button className="btn btn-ghost btn-sm" onClick=\{\(\) => finish\(false\)\}/);
  assert.match(tour, /className="tour-skip" onClick=\{\(\) => finish\(false\)\}/);
  assert.match(tour, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); finish\(false\); \}/);
  assert.match(server, /const HINT_KEYS = \['mine', 'admin'\];/);
  assert.match(server, /HINT_KEYS\.filter\(\(k\) => payload\.hints\[k\] === true\)/, 'hints only ever become true');
  assert.match(mine, /call\('prefs\.save', \{ hints: \{ mine: true \} \}\)/);
  assert.match(mine, /<Intro seen=\{!!boot\.prefs\?\.hints\?\.mine\} \/>/);
});

// The tour as of 2026-11-12: ≤ 10 calm steps through the app as it is now – portfolio and planning, then Lotse (ask, act,
// workflows), the command bar and the report composer.
const stepIds = [...tour.matchAll(/\{ id: '([a-z]+)', icon: '[a-zA-Z]+'/g)].map((m) => m[1]);
const stepSrc = (id) => { const a = tour.indexOf(`{ id: '${id}'`), b = tour.indexOf('{ id: ', a + 6); return tour.slice(a, b < 0 ? undefined : b); };

test('the tour: at most 10 steps in the order of the app, from welcome to done', () => {
  assert.deepEqual(stepIds, ['welcome', 'tabs', 'ranking', 'plan', 'time', 'lotse', 'act', 'bar', 'report', 'done']);
  assert.ok(stepIds.length <= 10);
  assert.ok(!/target:/.test(stepSrc('welcome')), 'the welcome is centred, it needs no control');
});

test('the tour only spotlights controls that exist (data-tour), and skips steps whose control is not on screen', () => {
  const src = ['static/cockpit/src/App.jsx', 'static/cockpit/src/views/Portfolio.jsx', 'static/cockpit/src/components/TabScroller.jsx'].map(read).join('\n');
  const tabIds = [...app.matchAll(/\{ id: '([a-z]+)', icon: '[a-z]+', label:/g)].map((m) => m[1]);
  // Lotse's header button carries data-lotse-open (owned by the Lotse panel) – the tour maps 'lotse' to it (TARGETS)
  const exists = (k) => (k.startsWith('tab-') ? tabIds.includes(k.slice(4)) && /data-tour=\{`tab-\$\{t\.id\}`\}/.test(app) : k === 'tabs' ? /tour="tabs"/.test(app) && /data-tour=\{tour\}/.test(src) : k === 'lotse' ? /data-lotse-open/.test(app) && /lotse: '\[data-tour="lotse"\], \[data-lotse-open\]'/.test(tour) : src.includes(`data-tour="${k}"`));
  const targets = [...tour.matchAll(/target: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]));
  assert.ok(targets.length >= 8);
  for (const k of targets) assert.ok(exists(k), `data-tour="${k}" exists in the app`);
  assert.match(tour, /const present = \(s\) => !s\.target \|\| s\.target\.some\(\(k\) => find\(k\)\);/);
  assert.match(tour, /const find = \(key\) => document\.querySelector\(TARGETS\[key\] \|\| `\[data-tour="\$\{key\}"\]`\);/);
  assert.match(tour, /all\.filter\(present\)/);
});

test('the tour describes the app as it is now (DE + EN), not the old tabs', () => {
  const de = (id, re) => assert.match(stepSrc(id), re, `${id}: ${re}`);
  de('ranking', /Wasserlinie[\s\S]*Health[\s\S]*keinen Pflicht-Rhythmus; erinnert wird nur, wenn ein Jira-Admin Erinnerungen einschaltet[\s\S]*waterline[\s\S]*reminders only come when a Jira admin switches them on/);
  de('plan', /schneller fertig, Überlast glätten oder umverteilen[\s\S]*85 % oder 100 %[\s\S]*In Jira übernehmen[\s\S]*einzeln rückgängig/);
  de('time', /Montag um 06:00[\s\S]*„nur Summe“/);
  de('lotse', /in deinen Worten[\s\S]*echten Zahlen[\s\S]*ohne KI[\s\S]*prüft jede Zahl darin gegen Lotse[\s\S]*checks every number in it against Lotse/);
  de('act', /Weekly vorbereiten, Lücken füllen, Überlast auflösen, Buchungen prüfen[\s\S]*vorher jede Änderung[\s\S]*erst nach deinem OK[\s\S]*rückgängig[\s\S]*nothing is written before your OK/);
  de('bar', /Strg K[\s\S]*Nachweis[\s\S]*Lotse eine Frage oder einen Auftrag[\s\S]*Ctrl K/);
  // 2026-11-18: Confluence target spaces are no longer configured in the cockpit (boss: reduce complexity) – the tour says PDF
  de('report', /Mit Lotse zusammenstellen[\s\S]*geschützte Chips[\s\S]*Als PDF teilen[\s\S]*prüft der Server jede Zahl[\s\S]*folgt dir auf andere Geräte/);
  de('done', /↶[\s\S]*DE \| EN[\s\S]*„\?“ startet die Tour wieder/);
  for (const old of ['Datenqualität', 'Abhängigkeiten', 'Zeit vs. Schätzung', 'Health-Updates fällig', 'Health-Gruppe', 'und keine Erinnerung']) assert.ok(!tour.includes(old), `no more "${old}"`);
  // the tab list stays a focusable, labelled scroll region (axe: scrollable-region-focusable)
  assert.match(tour, /<ul tabIndex=\{0\} aria-label=\{tr\('Alle Reiter mit Erklärung \(scrollbar\)'/);
  // AI drafting is mentioned only while it is switched on
  assert.match(stepSrc('ranking'), /\$\{aiDraft \? ' – oder „Mit KI formulieren“ lassen' : ''\}/);
  // every promise the tour makes is kept by the code
  assert.match(server, /cfg\.portfolio\.source === 'issue' && cfg\.notices\?\.enabled === true/, 'health reminders only with reminders switched on');
  assert.match(read('static/cockpit/src/views/Report.jsx'), /Mit Lotse zusammenstellen/);
  assert.match(read('static/cockpit/src/components/report/Publish.jsx'), /dryRun: true/);
  assert.match(read('static/cockpit/src/components/report/ReportComposer.jsx'), /call\('prefs\.save', \{ reportDraft: body \}\)/);
  for (const w of ['weeklyPrep', 'fillGaps', 'resolveOverload', 'bookingCheck']) assert.match(read('shared/lotse/act/workflows.js'), new RegExp(`id: '${w}'`));
  assert.match(app, /Lotse fragen/, 'Ctrl K hands a question to Lotse');
});

test('the tour moves smoothly: transform / opacity only, no AnimatePresence exits', () => {
  assert.ok(!/AnimatePresence/.test(tour.replace(/^\/\/.*$/gm, '')));
  assert.ok(!/\bexit=\{/.test(tour));
  assert.match(tour, /animate=\{\{ x: cardLeft, y: cardTop \}\}/);
  assert.ok(!/animate=\{\{ top:/.test(tour), 'no layout animation of the card');
});

test('the one-time intro of Meine Arbeit covers booking, Woche vervollständigen, Fehlende Werte and undo', () => {
  const intro = mine.slice(mine.indexOf('function Intro('));
  for (const s of ['Stunden eintippen', 'Woche vervollständigen', 'Fehlende Werte', 'Vertippt?', 'Verstanden']) assert.ok(intro.includes(s), s);
  assert.ok(intro.includes('ohne KI'), 'the proposals are rule-based');
  // the Lotse hint is a sentence Lotse really maps to its booking workflow
  assert.ok(intro.includes('„Prüfe meine Buchungen“') && intro.includes('"Check my bookings"'));
  assert.match(read('shared/lotse/act/workflows.js'), /id: 'bookingCheck', title: \(L\) => T\(L, 'Buchungen prüfen', 'Check my bookings'\)/);
});

test('undo: always visible top right with its count – in the cockpit and in the configuration', () => {
  assert.ok(!/\{top && \(/.test(undo), 'not hidden while empty');
  assert.match(undo, /className="undo-count num"/);
  assert.match(app, /<UndoHistory \/>\n\s+<Avatar user=\{boot\.me\}/, 'right next to the avatar');
  assert.match(app, /right=\{<><LangSwitch \/><UndoHistory \/><\/>\}/, 'configuration page');
});

test('bulk changes: a preview of every change before anything is written', () => {
  assert.match(inbox, /onClick=\{\(\) => setPreview\(inbox\.suggestions\.list\)\}/);
  assert.ok(!/onClick=\{\(\) => run\('sugg', \(\) => applyAll/.test(inbox), 'no direct apply-all any more');
  assert.match(quality, /onClick=\{\(\) => setPreview\(list\.slice\(0, BULK_MAX\)\)\}/);
  assert.ok(!/onClick=\{\(\) => apply\(list\.slice\(0, BULK_MAX\)\)\}/.test(quality));
});

test('icon-only controls always explain themselves on hover/focus (aria-label as tooltip)', () => {
  assert.match(ui, /document\.addEventListener\('mouseover', show\); document\.addEventListener\('focusin', show\);/);
  assert.match(ui, /'data-has-tip': 'true'/);
});

test('the search (Ctrl K) offers undo, the history, "undo all", language, inbox, booking and the configuration', () => {
  const pal = app.slice(app.indexOf('function Palette('));
  assert.match(pal, /kw\('rückgängig', 'undo', 'zurück'/);
  assert.match(pal, /run: \(\) => runUndo\(\)/);
  assert.match(pal, /undoUntil\(undoList\.at\(-1\)\)/);
  assert.match(pal, /setLang\(lang === 'de' \? 'en' : 'de'\)/);
  assert.match(pal, /new Event\('pc-open-inbox'\)/);
  assert.match(inbox, /addEventListener\('pc-open-inbox'/);
  assert.match(pal, /navigate\(adminUrl\)/);
});

test('undo count: big enough to notice, beside the arrow, never two numbers at once', () => {
  assert.match(undo, /<Icon name="undo" size=\{20\} \/>/);
  assert.ok(!/AnimatePresence/.test(undo.slice(undo.indexOf('undo-count') - 200, undo.indexOf('undo-count') + 200)), 'no exit animation around the count');
  const css = read('static/cockpit/src/styles.css');
  assert.match(css, /\.btn\.undo-btn \{ display: inline-flex; flex-direction: row;/);
  assert.ok(!/undo-btn \$\{n \? '' : 'empty'\}/.test(undo), 'no clash with the .empty utility class');
});

test('hover cards survive real pointer movement (live finding: nothing showed on the Support charts)', () => {
  const charts = read('static/cockpit/src/components/charts.jsx');
  const team = read('static/cockpit/src/views/Team.jsx');
  assert.match(ui, /onMouseOver: \(e\) => \{ const el = e\.currentTarget; if \(e\.target\.closest\?\.\('\[data-has-tip\]'\) !== el\) return;/, 'bubbling trigger, innermost wins');
  assert.ok(!/createPortal\(<AnimatePresence>\{tip && <TipBox/.test(ui), 'no exit animation that can leave old cards on screen');
  assert.ok(!/className="hbar" disabled=\{!onPick\}/.test(charts), 'React never delivers hover to disabled buttons');
  assert.match(charts, /the legend explains itself like the ring/);
  assert.match(team, /\{\.\.\.tip\(projectCard\(p, td, team, name\(team\), computed, person\)\)\}/);
  assert.match(team, /\{\.\.\.tip\(spaceCard\(s, name\(team\)\)\)\}/);
});

test('the Lotse hints in the guides are sentences Lotse really understands', async () => {
  const { routeAct } = await import('../shared/lotse/act/route.js');
  const { lotseCtx } = await import('./lotseFixture.js');
  assert.equal(routeAct('Prüfe meine Buchungen', lotseCtx('de'))?.workflow, 'bookingCheck');
  assert.equal(routeAct('Check my bookings', lotseCtx('en'))?.workflow, 'bookingCheck');
});
