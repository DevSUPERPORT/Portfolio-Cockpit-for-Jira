// The local mock of the report composer's server side and of reminders on request – the same rules as src/index.js,
// with the browser's data standing in for the fresh computation:
//   report.draft / prefs.save { reportDraft }        the draft per person (cleanDraft – validated, capped)
//   report.publishComposed { doc, dryRun?, … }       cleanComposed + verifyComposed (typed numbers, person names) → a fake page
//   report.unpublishComposed { pageId }              restore the previous version / withdraw
//   notices.remind { kind, accountIds, dryRun? }     only with ?notices=on (config.notices.enabled); 1 per person, kind and day
import { cleanComposed, verifyComposed, cleanDraft } from '@shared/lotse/report/publish.js';

let draft = null;
const pages = new Map();
const marks = new Map();
const ok = (data) => ({ ok: true, data });
const fail = (code, message) => ({ ok: false, error: { code, message } });

export function mockReportDraftSave(p) {
  if (!('reportDraft' in (p || {}))) return null;
  const d = cleanDraft(p.reportDraft);
  if (d === undefined) return fail('INVALID', 'reportDraft invalid or too large');
  draft = d;
  return { reportDraftAt: d ? d.at : null };
}
export const mockReportDraft = () => ok(draft ? structuredClone(draft) : null);

export function mockPublishComposed(p, { people = [], roles = {}, entities = { projects: [], teams: [] } } = {}) {
  if (!roles.viewReport) return fail('NO_ACCESS', 'NO_ACCESS:viewReport');
  let doc;
  try { doc = cleanComposed(p.doc); } catch (e) { return fail('INVALID', e.message); }
  // the mock's "fresh computation": the browser's own facts (the real server drafts the report again from Jira)
  const fresh = { sections: doc.sections.map((s) => ({ id: s.id, kind: s.kind, title: s.title, facts: s.facts, data: {}, keys: [...new Set((s.text.match(/\b[A-Z][A-Z0-9_]{0,19}-\d{1,9}\b/g) || []))], entities: { projects: entities.projects, teams: entities.teams, people: [] }, tone: 'info' })) };
  const v = verifyComposed(doc, fresh, { people });
  if (!v.ok || p.dryRun) return ok({ ok: v.ok, dryRun: !!p.dryRun, checked: v.sections.length, problems: v.problems });
  if (!['1', '2'].includes(p.spaceId)) return fail('NO_ACCESS', 'NO_ACCESS:publishSpace');
  const old = p.pageId ? pages.get(p.pageId) : null;
  const pageId = old ? p.pageId : String(4000 + pages.size);
  const rec = { pageId, spaceId: p.spaceId, title: p.title || doc.title, version: old ? old.version + 1 : 1, prev: old ? { title: old.title } : null, lang: doc.lang, withdrawn: false };
  pages.set(pageId, rec);
  return ok({ ok: true, id: pageId, pageId, spaceId: p.spaceId, url: `https://example.atlassian.net/wiki/spaces/MGMT/pages/${pageId}`, mode: old ? 'update' : 'create', version: rec.version, checked: v.sections.length });
}
export function mockUnpublishComposed(p) {
  const rec = pages.get(p.pageId);
  if (!rec) return fail('NOT_FOUND', 'NOT_FOUND');
  if (rec.withdrawn) return fail('INVALID', 'already withdrawn');
  const restore = !!rec.prev;
  pages.set(p.pageId, { ...rec, version: rec.version + 1, title: restore ? rec.prev.title : `${rec.title} – ${rec.lang === 'en' ? 'withdrawn' : 'zurückgezogen'}`, prev: null, withdrawn: !restore });
  return ok({ pageId: p.pageId, mode: restore ? 'restore' : 'withdraw', url: `https://example.atlassian.net/wiki/spaces/MGMT/pages/${p.pageId}` });
}

// gaps: the people's open gaps in the mock data; booking: everyone below 90 % last week (the mock books ~70 %)
export function mockRemind(p, { config = {}, roles = {}, gapsOf = () => 0 } = {}) {
  if (!(roles.admin || roles.editCapacity)) return fail('NO_ACCESS', 'NO_ACCESS:a_cap');
  if (config.notices?.enabled !== true) return fail('NOTICES_OFF', 'NOTICES_OFF');
  if (!['booking', 'gaps'].includes(p.kind)) return fail('INVALID', 'kind');
  const ids = [...new Set(Array.isArray(p.accountIds) ? p.accountIds : [])];
  if (!ids.length || ids.length > 100) return fail('INVALID', 'accountIds');
  const day = new Date().toISOString().slice(0, 10);
  const out = { kind: p.kind, dryRun: !!p.dryRun, people: ids.length, sent: 0, would: 0, limited: 0, nothing: 0, failed: 0, results: [] };
  for (const id of ids) {
    const has = p.kind === 'gaps' ? gapsOf(id) > 0 : true;
    const k = `${day}:${p.kind}:${id}`;
    const status = !has ? 'nothing' : marks.has(k) ? 'limited' : p.dryRun ? 'would' : 'sent';
    out[status] += 1;
    out.results.push({ accountId: id, status });
    if (status === 'sent') marks.set(k, true);
  }
  return ok(out);
}
