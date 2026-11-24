// Support playbooks (Support › Playbooks, and the "Ich will …" card on recurring support topics): help articles with
// a standard reply per recurring topic, kept in the app's storage (KVS key 'playbooks'). Nothing is ever posted to a
// Jira ticket – a person copies the reply.
//
// Resolvers (src/index.js):
//   'playbooks.list'    READ   payload {}                         → { items: [playbook], canEdit }
//   'playbooks.save'    WRITE  payload { playbook, restore? }     → { playbook, previous | null }
//                              New when playbook.id is unknown; otherwise replaces it. Undo = save `previous` again with
//                              restore: true (or delete when previous is null).
//   'playbooks.delete'  WRITE  payload { id }                     → { deleted: playbook }   (undo = save it with restore: true)
// Rights (shared/playbooks.js): read with the Support tab; change with "Support-Tickets verteilen" or "Kapazitäten
// pflegen" on top; Jira admins always. Every change is audited (title only, never the text).
//
// Every handler takes an optional `deps` ({ get, set, audit, now }) for tests.
import { get as getReal, set as setReal, audit as auditReal } from './store.js';
import { validPlaybook, newPlaybookId, canReadPlaybooks, canEditPlaybooks, PLAYBOOK_LIMITS } from '../../shared/playbooks.js';

export const PLAYBOOKS_KEY = 'playbooks';
class Denied extends Error { constructor(m = 'NO_ACCESS:playbooks') { super(m); this.code = 'NO_ACCESS'; } }
class BadRequest extends Error { constructor(m) { super(m); this.code = 'INVALID'; } }
const D = (deps = {}) => ({ get: deps.get || getReal, set: deps.set || setReal, audit: deps.audit || auditReal, now: deps.now || (() => new Date().toISOString()) });
const load = async (d) => { const v = await d.get(PLAYBOOKS_KEY); return Array.isArray(v?.items) ? v.items : []; };

export async function listPlaybooks(ctx, deps) {
  if (!canReadPlaybooks(ctx.roles)) throw new Denied();
  const items = await load(D(deps));
  return { items: [...items].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))), canEdit: canEditPlaybooks(ctx.roles) };
}

export async function savePlaybook(payload, ctx, deps) {
  if (!canEditPlaybooks(ctx.roles)) throw new Denied();
  const d = D(deps);
  const items = await load(d);
  const inId = typeof payload?.playbook?.id === 'string' ? payload.playbook.id : null;
  const prev = inId ? items.find((x) => x.id === inId) || null : null;
  let pb;
  try { pb = validPlaybook(payload?.playbook, prev); } catch { throw new BadRequest('playbook: title required'); }
  // a restore (undo of a delete) keeps its id; anything else unknown gets a fresh id
  if (!prev && !(payload?.restore === true && pb.id)) pb.id = newPlaybookId();
  if (!prev && items.length >= PLAYBOOK_LIMITS.max) throw new BadRequest(`at most ${PLAYBOOK_LIMITS.max} playbooks`);
  const now = d.now();
  pb.createdAt = pb.createdAt || now;
  pb.updatedAt = now;
  pb.updatedBy = ctx.displayName || null;
  const next = prev ? items.map((x) => (x.id === pb.id ? pb : x)) : [...items, pb];
  await d.set(PLAYBOOKS_KEY, { items: next });
  await d.audit(ctx, 'playbooks.save', { id: pb.id, title: pb.title, created: !prev, restore: payload?.restore === true });
  return { playbook: pb, previous: prev };
}

export async function deletePlaybook(payload, ctx, deps) {
  if (!canEditPlaybooks(ctx.roles)) throw new Denied();
  const d = D(deps);
  const id = typeof payload?.id === 'string' ? payload.id : '';
  const items = await load(d);
  const gone = items.find((x) => x.id === id);
  if (!gone) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  await d.set(PLAYBOOKS_KEY, { items: items.filter((x) => x.id !== id) });
  await d.audit(ctx, 'playbooks.delete', { id, title: gone.title });
  return { deleted: gone };
}
