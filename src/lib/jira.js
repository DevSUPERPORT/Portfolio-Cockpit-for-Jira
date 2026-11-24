import api, { route, assumeTrustedRoute } from '@forge/api';
import { assertProductApi } from './norovo.js';

export class HttpError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

const q = (params) => Object.entries(params)
  .filter(([, v]) => v !== undefined && v !== null && v !== '')
  .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))
  .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');

export function retryWait(res, attempt) {
  const h = typeof res?.headers?.get === 'function' ? res.headers.get('retry-after') : null;
  const s = Number(h);
  const asked = Number.isFinite(s) && s > 0 ? s * 1000 : 0;
  return Math.min(5000, Math.max(600 * (attempt + 1), asked));
}

// as: 'user' | 'app'. path: a Route or a plain string (which we build from encoded parts only).
export async function jira(as, path, { method = 'GET', body, query, retries = 2 } = {}) {
  assertProductApi(path); // company policy: Jira REST only, never Rovo
  const r = typeof path === 'string' ? assumeTrustedRoute(query ? `${path}?${q(query)}` : path) : path;
  const client = as === 'app' ? api.asApp() : api.asUser();
  for (let attempt = 0; ; attempt++) {
    const res = await client.requestJira(r, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    // rate limited: wait what Jira asks for (Retry-After, seconds), at least the short back-off, at most 5 s – a resolver
    // has 25 s in all; past the retries the caller gets HttpError 429 and the user "Jira is busy" (BUSY), not an error
    if (res.status === 429 && attempt < retries) { await new Promise((ok) => setTimeout(ok, retryWait(res, attempt))); continue; }
    if (res.status === 204) return null;
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (!res.ok) {
      const msg = json?.errorMessages?.join('; ') || Object.values(json?.errors || {}).join('; ') || json?.message || `HTTP ${res.status}`;
      // where: method + path without the query (ids only, no customer text) – for the logs of refused calls
      throw Object.assign(new HttpError(res.status, msg, json), { where: `${as} ${method} ${typeof path === 'string' ? path.split('?')[0].slice(0, 120) : 'route'}` });
    }
    return json;
  }
}

export async function confluence(path, { method = 'GET', body, query } = {}) {
  assertProductApi(path); // company policy: Confluence REST only, never Rovo
  const r = assumeTrustedRoute(query ? `${path}?${q(query)}` : path);
  const res = await api.asUser().requestConfluence(r, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new HttpError(res.status, json?.errors?.[0]?.title || json?.message || `HTTP ${res.status}`, json);
  return json;
}

// Enhanced JQL search with cursor pagination. Returns all issues (bounded by `limit`, and by `until` – a Date.now()
// deadline: no further page is requested after it, the result is then marked truncated).
export async function searchAll(as, jql, fields, { limit = 5000, expand, until } = {}) {
  const out = [];
  let nextPageToken;
  do {
    if (nextPageToken && until && Date.now() > until) break;
    const page = await jira(as, '/rest/api/3/search/jql', {
      method: 'POST',
      body: { jql, fields, maxResults: 100, nextPageToken, ...(expand ? { expand } : {}) },
    });
    out.push(...(page.issues || []));
    nextPageToken = page.isLast === false || page.nextPageToken ? page.nextPageToken : undefined;
  } while (nextPageToken && out.length < limit);
  return { issues: out, truncated: !!nextPageToken };
}

export const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// Run async tasks with bounded parallelism.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

export { route };
