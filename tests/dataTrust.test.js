// "Datenschutz & Sicherheit" (2026-11-11): the panel and the note under the AI switch make promises to a customer who
// is very careful with their data. These tests tie every promise to the code, so a later change cannot silently make
// one of them false (an external server, a new permission, a different limit, prompt contents in the log …).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const manifest = read('manifest.yml');
const trust = read('static/cockpit/src/components/DataTrust.jsx');
const settings = read('static/cockpit/src/components/AiSettings.jsx');

test('"no connection to external servers": the manifest declares no egress and no remote backend', () => {
  assert.ok(!/^\s*external\s*:/m.test(manifest), 'permissions.external would allow outbound connections');
  assert.ok(!/^\s*remotes\s*:/m.test(manifest), 'a remote backend would send data outside Atlassian');
  assert.ok(!/^\s*(fetch|backend|client)\s*:/m.test(manifest));
  assert.match(trust, /keine Verbindung zu externen Servern/);
  // the server code never calls fetch() to the outside world (Forge would block it anyway – belt and braces)
  for (const f of ['src/index.js', 'src/lib/ai.js', 'src/lib/aiAssist.js', 'src/lib/history.js', 'src/lib/jira.js', 'src/lib/notices.js']) {
    assert.ok(!/\bfetch\(\s*['"`]https?:/.test(read(f)), `${f} calls an external URL`);
  }
});

test('the AI is Forge LLM only – the one llm module, model Claude, no other AI provider in the code', () => {
  assert.match(manifest, /^\s*llm:\s*\n\s*- key: pc-llm\s*\n\s*model:\s*\n\s*- claude/m);
  assert.match(trust, /diese App nutzt Claude/);
  const deps = JSON.parse(read('package.json')).dependencies || {};
  for (const d of Object.keys(deps)) assert.ok(!/openai|anthropic|langchain|cohere|mistral|gemini|genai/i.test(d), `AI SDK dependency ${d}`);
  assert.ok('@forge/llm' in deps, 'Forge LLM is the AI client');
});

test('"what the app may do in Jira" lists exactly the scopes of the manifest, in plain words', () => {
  const scopes = [...manifest.slice(manifest.indexOf('scopes:'), manifest.indexOf('content:')).matchAll(/- ([a-z:-]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(scopes, ['read:graph:team:atlassian', 'read:graph:user:atlassian', 'read:jira-user', 'read:jira-work', 'read:space:confluence', 'send:notification:jira', 'storage:app', 'write:jira-work', 'write:page:confluence']);
  for (const words of ['Vorgänge lesen', 'Personen lesen', 'App-Speicher', 'Jira-Benachrichtigungen', 'Confluence: Bereiche lesen und Report-Seiten anlegen', 'Atlassian Teams: Teams und ihre Mitglieder lesen']) assert.ok(trust.includes(words), words);
});

test('limits, logging and storage promises match the server', () => {
  const ai = read('src/lib/ai.js');
  const server = +/const DAILY_LIMIT = (\d+);/.exec(ai)[1];
  assert.equal(+/export const AI_DAILY_LIMIT = (\d+);/.exec(read('static/cockpit/src/lib/aiFlags.js'))[1], server, 'panel limit = server limit');
  // the audit entry per AI call carries feature, source and counts – never the prompt or the answer
  const assist = read('src/lib/aiAssist.js');
  const auditLine = assist.split('\n').find((l) => l.includes("D.audit(ctx, 'ai.assist'"));
  const fields = auditLine && /\{ (.*) \}\);/.exec(auditLine)?.[1];
  assert.equal(fields, 'feature, source, ...(reason ? { reason } : {}), items: countOf(result), names: share.names, texts: share.texts', 'only feature, source, counts and the two on/off flags');
  // and nothing about AI calls goes to the Forge logs
  for (const f of ['src/lib/ai.js', 'src/lib/aiAssist.js', 'src/lib/history.js']) assert.ok(!/console\.(log|info|warn|error|debug)/.test(read(f)), `${f} writes to the log`);
  // switching off deletes the stored report summaries
  assert.match(ai, /export async function forgetAiData\(\)/);
  assert.match(ai, /ai:report:/);
  // the browser cache is the 15-minute session cache
  assert.match(read('static/cockpit/src/components/AiAssist.jsx'), /15 minutes in this browser tab \(sessionStorage/);
  // scrubbing before sending: links, e-mails, passwords/tokens
  const scrub = read('shared/aiAssist.js');
  for (const re of [/\[link\]/, /\[e-mail\]/, /\[redacted\]/]) assert.match(scrub, re);
});

test('the note is always visible under the switch; the panel opens from a button next to it (DE + EN, sources linked)', () => {
  assert.match(settings, /<DataTrust \/>/);
  assert.match(settings, /<DataTrustNote \/>\n\s*<\/div>\n\s*\);\n\}/, 'the note is the last thing on the page');
  assert.match(trust, /aria-expanded=\{open\}/);
  assert.match(trust, /Your data stays in your Atlassian cloud/);
  assert.ok(!/AnimatePresence/.test(trust), 'no exit animation (stalls in the Jira frame)');
  assert.ok(!/rovo/i.test(trust));
  // no absolute promise the app cannot prove on its own: retention and training are Atlassian's, with the source
  assert.ok(!/nie(mals)? .*(geleakt|abfließ)|never (be )?leak/i.test(trust));
  assert.match(trust, /Aufbewahrung und Training regelt Atlassian/);
  assert.match(trust, /atlassian\.com\/trust\/ai/);
});

test('the cost brake promises match the code: 12 h shared cache under a checksum, deleted with AI off; meter holds only numbers', () => {
  const trust = read('static/cockpit/src/components/DataTrust.jsx');
  const budget = read('src/lib/aiBudget.js');
  const hours = +/export const CACHE_HOURS = (\d+);/.exec(budget)[1];
  assert.match(trust, new RegExp(`bis zu ${hours} Stunden`));
  assert.match(trust, new RegExp(`for up to ${hours} hours`));
  assert.match(budget, /createHash\('sha256'\)/, 'stored under a checksum of the prompt');
  assert.match(read('src/lib/ai.js'), /purgeCache\(\{ all: true \}\)/, 'deleted when AI is switched off');
  // the meter: numbers only
  const shared = read('shared/aiBudget.js');
  const add = shared.slice(shared.indexOf('export function addSpend'), shared.indexOf('const round6'));
  assert.ok(!/system|user|text|prompt|answer|accountId|name/.test(add.replace(/feature/g, '')), 'no content or people in the meter');
});

test('"Was gespeichert wird" tells the truth about usage counts and Lotse\'s learning patterns', () => {
  const trust = read('static/cockpit/src/components/DataTrust.jsx');
  // usage: counts only, no people, no content, 30 days, admins only – as shared/usage.js and the resolvers do it
  const days = +/export const USAGE_DAYS = (\d+);/.exec(read('shared/usage.js'))[1];
  assert.match(trust, /nur Zählungen, keine Personen, keine Inhalte/);
  assert.match(trust, new RegExp(`nach ${days} Tagen gelöscht`));
  assert.match(trust, new RegExp(`deleted after ${days} days`));
  assert.match(trust, /Nur Jira-Admins sehen sie/);
  const index = read('src/index.js');
  assert.match(index, /def\('usage\.track', async \(\{ payload \}\) =>/, 'the counter never sees who sent it');
  assert.match(index, /def\('usage\.summary', async \(\{ roles \}\) => \{ requireRole\(roles, 'admin'\);/);
  // learning: only the masked pattern, at most LEARN_MAX, admins decide
  const max = +/export const LEARN_MAX = (\d+);/.exec(read('shared/lotse/learn.js'))[1];
  assert.match(trust, new RegExp(`höchstens ${max}`));
  assert.match(trust, /nur das Satzmuster/);
  assert.match(trust, /Namen, Keys und Zahlen entfernt, ohne Person/);
  assert.doesNotMatch(read('src/lib/learn.js'), /accountId|displayName/);
  // and the storage list names both
  assert.match(trust, /Nutzungszählungen, Lotse-Lernmuster/);
  // Lotse computes locally – nothing goes to an AI without the switch
  assert.match(trust, /ohne KI; an eine KI geht dabei nichts/);
});

test('report drafts, reminders on request and the Confluence re-check: every promise is kept by the server', async () => {
  const trust = read('static/cockpit/src/components/DataTrust.jsx');
  const index = read('src/index.js');
  // drafts: per person, its own key, at most DRAFT_MAX_BYTES, replaced on every save, only that person reads it
  const { DRAFT_MAX_BYTES } = await import('../shared/lotse/report/publish.js');
  assert.match(trust, new RegExp(`höchstens ${Math.round(DRAFT_MAX_BYTES / 1000)} KB`));
  assert.match(trust, new RegExp(`at most ${Math.round(DRAFT_MAX_BYTES / 1000)} KB`));
  assert.match(trust, /Report-Entwürfe, Nutzungszählungen/);
  assert.match(read('src/lib/store.js'), /reportDraft: \(accountId\) => `draft:report:\$\{accountId\}`/);
  // the person's own draft, minus sections naming a project they may not browse (tests/reportVisibility.test.js)
  assert.match(index, /def\('report\.draft', async \(\{ ctx \}\) => draftForCaller\(\(await get\(K\.reportDraft\(ctx\.accountId\)\)\) \|\| null, ctx\)\);/, 'only the signed-in person\'s own draft');
  assert.match(index, /await set\(K\.reportDraft\(ctx\.accountId\), d\)/, 'replaced on every save');
  // reminders: only "was reminded" per person and day, deleted the next day, audited
  assert.match(trust, /je Person und Tag nur, dass sie erinnert wurde/);
  const notices = read('src/lib/notices.js');
  assert.match(notices, /next\[`\$\{kind\}:\$\{id\}`\] = now;/, 'the mark is a time, nothing else');
  assert.match(index, /await del\(REMIND_KEY\(new Date\(Date\.now\(\) - k \* 864e5\)/, 'the hourly job deletes the marks of the days before');
  assert.match(index, /audit: \(details\) => audit\(me, 'notices\.remind', details\)/);
  // notifications only with reminders switched on – also the health reminders of the daily job
  assert.match(trust, /Jira-Benachrichtigungen senden – aus, bis ein Admin Erinnerungen einschaltet/);
  assert.match(index, /cfg\.portfolio\.source === 'issue' && cfg\.notices\?\.enabled === true/);
  assert.match(index, /if \(cfg\.setupComplete && cfg\.notices\?\.enabled\)/);
  assert.match(notices, /if \(!n\.enabled\) throw new NoticesOff\(\);/);
  // Confluence: create or update, re-checked before writing, undo = restore / withdraw, never delete
  assert.match(trust, /Report-Seiten anlegen oder aktualisieren – ohne Personennamen/);
  assert.match(trust, /löschen darf die App keine Seiten/);
  assert.match(trust, /prüft jede Zahl, bevor eine Seite entsteht/);
  const pub = index.slice(index.indexOf("def('report.publishComposed'"), index.indexOf("def('notices.remind'"));
  assert.ok(pub.indexOf('verifyComposed(') < pub.indexOf("method: 'POST'"));
  assert.doesNotMatch(pub, /method: 'DELETE'/);
  assert.doesNotMatch(manifest, /delete:page|write:attachment/);
  // usage: numbers only, stored append-only per batch – still no person and no content
  assert.match(trust, /je Tag und Ereignis nur Zahlen/);
  assert.match(read('src/lib/usage.js'), /await D\.set\(USAGE_SHARD\(today\(D\.now\), D\.id\(\)\), mergeDay\(null, batch\)\);/);
});

test('"What SUPERPORT sees" stays true: scrubbed logs, no test harness on production, links to the binding documents', () => {
  const trust = read('static/cockpit/src/components/DataTrust.jsx');
  for (const words of ['Was SUPERPORT sieht', 'Fehlerart und Status', 'nie mit euren Daten']) assert.ok(trust.includes(words), words);
  for (const p of ['apps/eula', 'apps/privacy', 'apps/security']) {
    assert.ok(trust.includes(`https://www.superport.digital/${p}`), `DE ${p}`);
    assert.ok(trust.includes(`https://www.superport.digital/en/${p}`), `EN ${p}`);
  }
  // logs: only through safeLog (tests/logPrivacy.test.js checks every file)
  assert.match(read('src/lib/safeLog.js'), /export function safeError/);
  // the harness and the diagnostics refuse the production environment
  assert.match(read('static/cockpit/src/selftest.jsx'), /envType === 'PRODUCTION'/);
  assert.match(read('static/cockpit/src/lib/diag.js'), /!== 'PRODUCTION'/);
});
