// Boss review of the configuration on the pilot customer's sandbox (2026-11-18): software spaces as support, JSM SLAs from JSM,
// fewer settings (no settings group, no report spaces, one team source), what "Verantwortlich" means, more holiday
// countries, where things are maintained, which tabs a rule changes, the target-quarter range, team names, hierarchy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { holidaysFor, holidayName, LOCATIONS, HOLIDAY_NAMES } from '../shared/holidays.js';
import { validateConfig, validQuarterRange, quarterChoices, validQueues, ticketServices, DEFAULT_CONFIG } from '../src/lib/config.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const iso = (d) => new Date(d * 864e5).toISOString().slice(0, 10);
// a valid base: one estimation level (validateConfig requires it)
const BASE = () => ({ ...structuredClone(DEFAULT_CONFIG), portfolio: { source: 'space' }, levels: [{ key: 'story', name: 'Story', role: 'estimate', issueTypeIds: ['10001'] }] });
const days = (loc, y) => [...holidaysFor(loc, y)].sort((a, b) => a - b).map(iso);

test('holidays: national calendars for the pilot customer\'s countries – Easter, Orthodox Easter, moving days and substitutes', () => {
  assert.deepEqual(days('HU', 2026), ['2026-01-01', '2026-03-15', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-25', '2026-08-20', '2026-10-23', '2026-11-01', '2026-12-25', '2026-12-26']);
  // Romania follows Orthodox Easter (12 April 2026): Good Friday 10 April, Easter Monday 13 April
  assert.ok(days('RO', 2026).includes('2026-04-10') && days('RO', 2026).includes('2026-04-13') && days('RO', 2026).includes('2026-12-01'));
  // Netherlands: King's Day on a Sunday moves to Saturday (2025: 27 April is a Sunday)
  assert.ok(days('NL', 2025).includes('2025-04-26') && !days('NL', 2025).includes('2025-04-27'));
  assert.ok(days('NL', 2025).includes('2025-05-05') && !days('NL', 2026).includes('2026-05-05'), 'Liberation Day every five years');
  // Namibia: a holiday on a Sunday is also off on the Monday (Heroes' Day 26 Aug 2029 is a Sunday)
  assert.ok(days('NA', 2029).includes('2029-08-26') && days('NA', 2029).includes('2029-08-27'));
  // Ireland: St Brigid's Day = first Monday in February, or 1 February when that is a Friday (2030)
  assert.ok(days('IE', 2026).includes('2026-02-02') && days('IE', 2030).includes('2030-02-01'));
  assert.ok(days('SE', 2026).includes('2026-06-19'), 'Swedish Midsummer Eve: the Friday between 19 and 25 June');
  assert.ok(days('PL', 2025).includes('2025-12-24') && !days('PL', 2024).includes('2024-12-24'), 'Polish Christmas Eve from 2025');
  // every calendar names every day, three years
  for (const loc of Object.keys(LOCATIONS)) for (const y of [2026, 2027, 2028]) for (const d of holidaysFor(loc, y)) assert.ok(HOLIDAY_NAMES[holidayName(loc, d)], `${loc} ${iso(d)}`);
  for (const k of ['HU', 'CZ', 'SK', 'PL', 'RO', 'HR', 'NL', 'BE', 'LU', 'FR', 'ES', 'PT', 'IT', 'IE', 'GB-NIR', 'AU', 'NA']) assert.ok(LOCATIONS[k], k);
  // a location may use them (config validation accepts the new keys)
  const cfg = validateConfig({ ...BASE(), capacityDefaults: { defaultWeeklyHours: 40, defaultLocation: 'HU' } });
  assert.equal(cfg.capacityDefaults.defaultLocation, 'HU');
});

test('target quarters: a configurable range (back / ahead), validated, used by the app field', () => {
  assert.deepEqual(validQuarterRange(undefined), { back: 1, ahead: 10, off: [], extra: [] });
  assert.deepEqual(validQuarterRange({ back: 3, ahead: 6 }), { back: 3, ahead: 6, off: [], extra: [] });
  assert.deepEqual(validQuarterRange({ back: -1, ahead: 99 }), { back: 1, ahead: 10, off: [], extra: [] }, 'out of range → defaults');
  const now = new Date(Date.UTC(2026, 10, 18));
  assert.deepEqual(quarterChoices({ back: 1, ahead: 2 }, now), ['2026-Q3', '2026-Q4', '2027-Q1', '2027-Q2']);
  assert.equal(quarterChoices({ back: 0, ahead: 20 }, now).length, 21);
  const cfg = validateConfig({ ...BASE(), quarterRange: { back: 2, ahead: 8 } });
  assert.deepEqual(cfg.quarterRange, { back: 2, ahead: 8, off: [], extra: [] });
  const noRange = BASE(); delete noRange.quarterRange;
  assert.deepEqual(validateConfig(noRange, cfg).quarterRange, { back: 2, ahead: 8, off: [], extra: [] }, 'kept when not sent');
  assert.match(read('src/index.js'), /def\('field\.options', async \(\{ cfg \}\) => \(\{ sizes: cfg\.tshirtSizes, quarters: quarterChoices\(cfg\.quarterRange\) \}\)\)/);
  assert.match(read('static/cockpit/src/views/Admin.jsx'), /data-quarter-range/);
});

test('team names from Jira suggestions are plain text ("Anke&#39;s Test project" → "Anke\'s Test project")', async () => {
  const { decodeEntities } = await import('../src/lib/atlTeams.js');
  assert.equal(decodeEntities('Anke&#39;s Test project'), "Anke's Test project");
  assert.equal(decodeEntities('R&amp;D &quot;Core&quot; &#x41;&lt;b&gt;'), 'R&D "Core" A<b>');
  assert.equal(decodeEntities('&bogus; &#0;'), '&bogus; &#0;', 'unknown or invalid entities stay');
});

test('support: software spaces as one built-in queue; the SLA settings only for tickets without a JSM SLA', () => {
  const q = validQueues([{ id: 'spaces', name: 'Support-Spaces', projectIds: ['10010', '10020'], issueTypeIds: [], labels: [] }]);
  assert.deepEqual(q[0], { id: 'spaces', name: 'Support-Spaces', projectIds: ['10010', '10020'], issueTypeIds: [], labels: [] });
  const admin = read('static/cockpit/src/views/Admin.jsx');
  assert.match(admin, /function SupportSpaces\(/);
  assert.match(admin, /data-sla-jsm/);
  assert.ok(!/SLA-Uhr/.test(admin) && !/SLA-Ziel %/.test(admin), 'no global SLA clock / targets – SLAs live in each JSM space');
  // each chosen software / business space is a service of its own (named like the project), not "Support-Spaces"
  const cfg = { support: { serviceProjectIds: ['10001'], queues: [...q, { id: 'q2', name: 'Ops', projectIds: ['10030'], issueTypeIds: [], labels: [] }] } };
  assert.deepEqual(ticketServices(cfg, { projectId: '10020' }), ['10020']);
  assert.deepEqual(ticketServices(cfg, { projectId: '10001' }), ['10001']);
  assert.deepEqual(ticketServices(cfg, { projectId: '10030', issueTypeId: '1', labels: [] }), ['q:q2']);
});

test('configuration is simpler: no settings group, no report target spaces, one team source; the hints say where things live', () => {
  const admin = read('static/cockpit/src/views/Admin.jsx');
  assert.ok(!/manageSettings/.test(admin), 'no "Portfolio-Einstellungen pflegen" row');
  assert.ok(!/PublishSpaces/.test(admin), 'no "Ziel-Spaces für den C-Level-Report"');
  assert.match(admin, /data-lead-hint/, 'team lead grants no rights – said next to the roles');
  assert.match(admin, /Teamleitungen bekommen sie nicht automatisch/);
  assert.match(admin, /data-lead-where/, 'where responsible people are maintained');
  assert.match(admin, /data-rule-where="due"/);
  assert.match(admin, /data-rule-where="person"/);
  assert.match(admin, /<TypeChips single /, 'the project issue type is single select');
  assert.match(admin, /const typesAt = \(h\) =>/, 'each row offers only the types of its own hierarchy level');
  assert.match(admin, /function SetupGuide\(/);
  const teams = read('static/cockpit/src/components/TeamsSettings.jsx');
  assert.ok(!/Nur Cockpit-Pflege/.test(teams), 'no "cockpit maintenance only" switch');
  assert.match(teams, /data-idle-teams/);
  for (const f of ['static/cockpit/src/views/Report.jsx', 'static/cockpit/src/components/report/Publish.jsx']) assert.ok(!/in der Konfiguration \(Berechtigungen\) zuerst Ziel-Spaces/.test(read(f)), f);
  assert.match(read('static/cockpit/src/components/LocationsSettings.jsx'), /Regionaler Feiertag \(Bundesland, Kanton, Stadt\)\? Unten als Firmentag eintragen/);
});

test('team lead ("Verantwortlich") grants no rights – rights come only from groups (unchanged server rule)', async () => {
  const roles = read('shared/roles.js');
  assert.match(roles, /responsible/);
  const perms = read('src/lib/perms.js');
  assert.ok(!/responsible/.test(perms), 'the permission check never looks at responsible people');
});

test('Lotse set story with no match names its threshold as a fact (live finding: "Keine Personen gefunden – … über 100 %")', async () => {
  const { lotseCtx, lotseDataset } = await import('./lotseFixture.js');
  const Q = await import('../shared/lotse/act/query.js');
  const L = await import('../shared/lotse/index.js');
  for (const lang of ['de', 'en']) {
    const ctx = lotseCtx(lang, { ds: lotseDataset() });
    const res = Q.runQuery({ entity: 'people', where: [{ m: 'load', op: '>', v: 900 }], window: { next: 4 } }, ctx);
    assert.equal(res.total, 0);
    const s = Q.setStory(ctx, res);
    L.validStory(s);
    assert.deepEqual(L.selfCheck(s), [], s.headline);
  }
});

test('target quarters: switch quarters off and add some by hand (boss: "manually add and disable")', () => {
  const now = new Date(Date.UTC(2026, 10, 18));
  const r = validQuarterRange({ back: 1, ahead: 2, off: ['2027-Q1', 'bogus', '2027-Q1'], extra: ['2030-Q2', '2026-Q1', '1999-Q1', '2030-Q5'] });
  assert.deepEqual(r, { back: 1, ahead: 2, off: ['2027-Q1'], extra: ['2026-Q1', '2030-Q2'] }, 'only valid quarter keys, each once, sorted');
  assert.deepEqual(quarterChoices(r, now), ['2026-Q1', '2026-Q3', '2026-Q4', '2027-Q2', '2030-Q2'], 'window − off + extra, sorted');
  assert.equal(validQuarterRange({ extra: Array.from({ length: 60 }, (_, i) => `${2030 + Math.floor(i / 4)}-Q${(i % 4) + 1}`) }).extra.length, 40, 'at most 40 added quarters');
  const cfg = validateConfig({ ...BASE(), quarterRange: { back: 1, ahead: 4, off: ['2027-Q2'], extra: ['2032-Q4'] } });
  assert.deepEqual(cfg.quarterRange, { back: 1, ahead: 4, off: ['2027-Q2'], extra: ['2032-Q4'] }, 'saved as sent');
  const admin = read('static/cockpit/src/views/Admin.jsx');
  assert.match(admin, /data-quarter-chips/);
  assert.match(admin, /data-quarter-add/);
  assert.match(admin, /aria-pressed=\{!off\}/, 'a quarter chip is a toggle');
  assert.match(read('src/lib/config.js'), /export \{ validQuarterRange, quarterChoices \} from '\.\.\/\.\.\/shared\/quarterRange\.js'/, 'server and screen share one implementation');
});

test('round 2: escalation options carry full names; the hint is a formatted box; hierarchy shows every type, unfit and used ones greyed out', () => {
  const admin = read('static/cockpit/src/views/Admin.jsx');
  assert.match(admin, /<option value="leadOwner">\{tr\('Verantwortliche des Teams und Project-Owner'/);
  assert.match(admin, /<option value="mgmt">\{tr\('Verantwortliche des Teams und Management'/);
  assert.ok(!/'… und Project-Owner'|'… und Management'/.test(admin), 'no "…" options');
  assert.match(admin, /className="esc-where" data-lead-where/);
  // hierarchy (round 3): one row per Jira level, only its own types – the relevant ones first
  assert.match(admin, /function TypeChips\(\{ types, value, onChange, single = false, relevant = null, disabled = false \}\)/);
  assert.match(admin, /data-type-more/);
});

test('round 3: every Jira level is a row, switched on / off; the level above the projects is the theme level (on by default)', async () => {
  // config: theme level defaults on for existing configs; switched-off levels are kept with their settings
  const old = validateConfig({ ...BASE(), portfolio: { source: 'issue', issueTypeIds: ['10100'] } });
  assert.deepEqual(old.portfolio.group, { active: true, name: '', issueTypeIds: [] }, 'existing configs get themes switched on');
  assert.deepEqual(old.levelsOff, []);
  const space = validateConfig({ ...BASE() });
  assert.equal(space.portfolio.group.active, false, 'spaces have no theme level');
  const cfg = validateConfig({ ...BASE(), portfolio: { source: 'issue', issueTypeIds: ['10100'], group: { active: true, name: 'Themen', issueTypeIds: ['10200'] } },
    levelsOff: [{ key: 'ws', name: 'Workstream', role: 'rough', issueTypeIds: ['10050'], hierarchy: 2 }] });
  assert.deepEqual(cfg.portfolio.group, { active: true, name: 'Themen', issueTypeIds: ['10200'] });
  assert.deepEqual(cfg.levelsOff, [{ key: 'ws', name: 'Workstream', role: 'rough', issueTypeIds: ['10050'], hierarchy: 2 }]);
  assert.ok(cfg.matrix.ws, 'a switched-off level keeps its required-field settings');
  assert.throws(() => validateConfig({ ...BASE(), portfolio: { source: 'issue', issueTypeIds: ['10100'], group: { issueTypeIds: ['10100'] } } }), /only belong to one level/, 'a theme type is not also the project type');
  assert.throws(() => validateConfig({ ...BASE(), levelsOff: [{ key: 'story', name: 'x', role: 'structure', issueTypeIds: ['10777'] }] }), /unique/, 'keys unique over on and off levels');
  // the dataset: a switched-off level is passed through, its children hang on the item above
  const { roleResolver, passThrough } = await import('../src/lib/dataset.js');
  const roleOf = roleResolver({ levels: [{ key: 'epic', role: 'structure', issueTypeIds: ['10000'], hierarchy: 1 }, { key: 'story', role: 'estimate', issueTypeIds: ['10001'], hierarchy: 0 }], levelsOff: [{ key: 'ws', role: 'rough', issueTypeIds: ['10050'], hierarchy: 2 }] });
  assert.equal(roleOf({ id: '10050', hierarchyLevel: 2 }).role, 'skip');
  assert.equal(roleOf({ id: '10060', hierarchyLevel: 2 }).role, 'skip', 'another type of a switched-off hierarchy level too');
  assert.deepEqual(roleOf({ id: '10099', hierarchyLevel: 0 }), { role: 'estimate', levelKey: 'story' }, 'an unlisted type of an active level joins that level');
  const list = [{ id: 'w', role: 'skip', parentId: 'p' }, { id: 'e', role: 'structure', parentId: 'w' }, { id: 's', role: 'estimate', parentId: 'e' }];
  passThrough(list);
  assert.deepEqual(list.map((i) => [i.id, i.parentId]), [['e', 'p'], ['s', 'e']], 'the Epic now hangs on the project');
  // the screen and the portfolio
  const admin = read('static/cockpit/src/views/Admin.jsx');
  assert.match(admin, /data-hierarchy-rows/);
  assert.match(admin, /data-level-group/);
  assert.match(admin, /function LevelSwitch\(/);
  assert.match(admin, /role="switch" aria-checked=\{!!on\} aria-label=\{label\}/, 'each level switch has a name');
  const pf = read('static/cockpit/src/views/Portfolio.jsx');
  assert.match(pf, /function Themes\(/);
  assert.match(pf, /theme-dim/);
  assert.match(read('src/lib/dataset.js'), /async function loadThemes\(as, cfg, items\)/);
});

test('round 4: escalation box is short (no "nicht gewählt"); the gap-reminder preview sits right under its reminder', () => {
  const admin = read('static/cockpit/src/views/Admin.jsx');
  assert.ok(!/nicht gewählt/.test(admin), 'unselected recipients are only greyed out');
  assert.match(admin, /where: tr\('Teams › Kapazitäten pflegen', 'Teams › Maintain capacities'\)/);
  const gap = admin.indexOf("tr('Erinnerung an fehlende Werte', 'Reminder about missing values')");
  const prev = admin.indexOf('data-gap-preview');
  const booking = admin.indexOf("tr('Buchungskontrolle: Hinweise und Eskalationen'");
  assert.ok(gap > 0 && gap < prev && prev < booking, 'reminder → its preview → booking check');
});

test('round 5: every level switch explains itself on hover (KPI-card look); a locked switch says why and stays hoverable', () => {
  const admin = read('static/cockpit/src/views/Admin.jsx');
  assert.match(admin, /function LevelSwitch\(\{ on, onChange, label, locked = false, card \}\)/);
  assert.match(admin, /aria-disabled=\{locked \|\| undefined\}/, 'locked, not disabled – a disabled button gets no hover');
  assert.ok(!/<LevelSwitch[^>]*\sdisabled[\s=>]/.test(admin), 'no switch uses disabled');
  assert.equal((admin.match(/<LevelSwitch /g) || []).length, (admin.match(/<LevelSwitch [^>]*card=\{cards\./g) || []).length, 'every switch has a card');
  assert.match(admin, /Immer an: die einzige Ebene mit Schätzung & Zeiterfassung/);
});
