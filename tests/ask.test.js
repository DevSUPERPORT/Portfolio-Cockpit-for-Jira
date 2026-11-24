import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAll } from '../shared/engine.js';
import { answer, parseQuestion, suggestions, VIEW_KINDS } from '../shared/ask.js';

const LEVELS = [
  { key: 'ep', name: 'Epic', role: 'structure', issueTypeIds: ['3'] },
  { key: 'st', name: 'Story', role: 'estimate', issueTypeIds: ['4'] },
];
const T = (id, name) => ({ id, name });
const st = (cat) => ({ name: cat, cat });
const ds = {
  today: '2026-11-02',
  config: { levels: LEVELS, tshirtSizes: [{ key: 'M', hours: 320 }], dependencies: { linkTypeIds: ['10000'] }, rules: { distribution: 'linear' } },
  portfolio: [
    { ref: 'issue:p1', rank: 1, kind: 'issue', id: 'p1', key: 'BIL-1', name: 'Billing-Migration', owner: { id: 'u9', name: 'Owner' }, statusCat: 'indeterminate', due: '2027-03-31', health: { status: 'critical', comment: 'Schnittstelle fehlt' } },
    { ref: 'issue:p2', rank: 2, kind: 'issue', id: 'p2', key: 'CRM-1', name: 'CRM-Konsolidierung', owner: null, statusCat: 'new', due: '2026-10-01' },
  ],
  issues: [
    { id: 'e1', key: 'BIL-3', summary: 'Epic', role: 'structure', levelKey: 'ep', parentId: null, rootRef: 'issue:p1', status: st('indeterminate'), team: T('t1', 'Web') },
    { id: 's1', key: 'BIL-4', summary: 'Story 1', role: 'estimate', levelKey: 'st', parentId: 'e1', rootRef: 'issue:p1', status: st('indeterminate'), team: T('t1', 'Web'), start: '2026-11-02', due: '2026-11-27', oe: 100, re: 40, ts: 60, links: [{ id: 'l1', typeId: '10000', outward: true, otherId: 's3', verb: 'blocks' }] },
    { id: 's3', key: 'CRM-2', summary: 'Other story', role: 'estimate', levelKey: 'st', parentId: null, rootRef: 'issue:p2', status: st('new'), team: T('t2', 'Data'), start: '2026-11-16', due: '2026-11-20', oe: 80, re: 80, ts: 0, links: [{ id: 'l1', typeId: '10000', outward: false, otherId: 's1', verb: 'blocks', inverse: 'is blocked by' }] },
  ],
  capacity: { people: {}, teams: {}, absences: [] },
};
const computed = computeAll(ds);
const fmt = { pct: (v) => (v == null ? '–' : `${Math.round(v * 100)}%`), h: (v) => `${Math.round(v || 0)} h`, n: (v) => String(v), date: (d) => d || '–', quarter: (q) => q, week: (w) => w };
const ctx = (lang = 'de') => ({ computed, ds, lang, fmt, me: { id: 'u9' }, roles: { viewReport: true } });

test('parser maps German and English questions to intents and entities', () => {
  const opts = { model: computed.model, quarters: computed.wl.quarters };
  assert.equal(parseQuestion('Welche Teams sind überlastet?', opts).intent, 'utilization');
  assert.equal(parseQuestion('From which rank does capacity run out?', opts).intent, 'waterline');
  assert.equal(parseQuestion('Zeig die Abhängigkeiten als Netz', opts).view, 'graph');
  assert.equal(parseQuestion('Wie weit ist Billing-Migration?', opts).project.ref, 'issue:p1');
  assert.equal(parseQuestion('wie geht es crm-1', opts).project.ref, 'issue:p2');
  assert.equal(parseQuestion('Auslastung Team Web', opts).team.id, 't1');
  assert.equal(parseQuestion('health as a pie chart', opts).view, 'donut');
  assert.equal(parseQuestion('Team utilisation as a heatmap', opts).view, 'heat');
  assert.equal(parseQuestion('dependency map', opts).view, 'graph');
});

test('questions rating individual people are declined', () => {
  const a = answer('Wer arbeitet am langsamsten?', ctx());
  assert.equal(a.intent, 'guard');
  assert.equal(answer('Who is the least productive?', ctx('en')).intent, 'guard');
});

test('cards carry data for every view they offer', () => {
  for (const q of ['Was braucht meine Aufmerksamkeit?', 'Health als Kuchen', 'Abhängigkeiten', 'Fortschritt aller Projekte', 'Schätzung gegen gebuchte Zeit', 'Was ist überfällig?', 'Datenqualität', 'Wie viele Stories gibt es?', 'Wasserlinie', 'Billing-Migration']) {
    const a = answer(q, ctx());
    assert.ok(a, q);
    assert.ok(a.views.length > 0, q);
    for (const v of a.views) assert.ok(VIEW_KINDS.includes(v), `${q}: ${v}`);
    assert.ok(a.views.includes(a.view), q);
    assert.ok(a.answer.length > 10, q);
  }
  assert.equal(answer('Health als Kuchen', ctx()).view, 'donut');
});

test('specific answers are correct', () => {
  const h = answer('How is the health of the projects?', ctx('en'));
  assert.match(h.answer, /1 critical/);
  const d = answer('dependencies', ctx('en'));
  assert.equal(d.data.graph.nodes.length, 2);
  assert.equal(d.data.graph.edges[0].conflicts, 1); // CRM-2 ends 20 Nov before BIL-4 (27 Nov) is done
  const o = answer('Was ist überfällig?', ctx());
  assert.match(o.answer, /überfällig/);
  assert.equal(answer('Wie viele Stories gibt es?', ctx()).data.number.value, 2);
  assert.equal(answer('blablub xyz', ctx()), null, 'unknown questions go to the AI fallback');
  assert.equal(answer('Erzähl mir einen Witz', ctx()), null, 'no accidental keyword hits');
});

test('suggestions by role and data', () => {
  const s = suggestions({ computed, roles: { viewReport: true, admin: true }, me: { id: 'u9' }, lang: 'en' });
  assert.ok(s.some((x) => /attention/.test(x.q)));
  assert.ok(s.some((x) => /Billing-Migration/.test(x.q)), 'own project and critical project');
  assert.ok(s.every((x) => answer(x.q, ctx('en'))), 'every suggestion is answerable');
});

test('PDF of selected cards: every view renders, typeset pages', async () => {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url)));
  const gc = computeAll(golden);
  const { downloadAskPdf } = await import('../static/cockpit/src/lib/askPdf.js');
  const { pdfSink } = await import('../static/cockpit/src/lib/pdf.js');
  const c2 = { computed: gc, ds: golden, lang: 'de', fmt: (await import('../static/cockpit/src/lib/i18n.js')).fmt, me: { id: 'x', name: 'Test' }, roles: {} };
  const cards = [];
  for (const q of ['Was braucht Aufmerksamkeit?', 'Abhängigkeiten als Netz', 'Auslastung als Heatmap', 'Health als Kuchen', 'Schätzung gegen gebuchte Zeit', 'Fortschritt aller Projekte', 'Auslastung der Teams im Verlauf', 'Portfolio als Tabelle']) {
    const a = answer(q, c2);
    assert.ok(a, q);
    cards.push({ ...a, q });
  }
  cards.push({ ...answer('Abhängigkeiten als Netz', ctx()), q: 'Abhängigkeiten als Netz' });
  cards.push({ title: 'KI', answer: '', text: '**Lage:** gut\n- Punkt eins\n- Punkt zwei', views: ['text'], view: 'text', data: {}, intent: 'ai', source: 'ai', q: 'Freie Frage' });
  const kinds = new Set(cards.map((c) => c.view));
  for (const k of ['list', 'graph', 'heat', 'donut', 'columns', 'bar', 'line', 'table', 'text']) assert.ok(kinds.has(k), `view ${k} covered (${[...kinds]})`);
  let out;
  pdfSink.save = (blob, name, doc) => { out = { blob, name, doc }; };
  await downloadAskPdf(cards, { me: { name: 'Test' } });
  pdfSink.save = null;
  assert.match(out.name, /^fragen-\d{4}-\d{2}-\d{2}\.pdf$/);
  const bytes = Buffer.from(await out.blob.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(out.doc.getNumberOfPages() >= 3, `${out.doc.getNumberOfPages()} pages`);
  if (process.env.ASK_PDF_OUT) writeFileSync(process.env.ASK_PDF_OUT, bytes);
});
