// Company policy: Rovo is never part of this app. This test runs in `npm test`, which the SUPERPORT ops release
// runs before every production build – a build that brings Rovo back cannot be released.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { route } from '@forge/api';
import { assertProductApi } from '../src/lib/norovo.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const read = (p) => readFileSync(join(root, p), 'utf8');
function files(dir, out = []) {
  for (const n of readdirSync(join(root, dir))) {
    if (n === 'node_modules' || n.startsWith('.') || /^dist/.test(n)) continue;
    const p = join(dir, n);
    if (statSync(join(root, p)).isDirectory()) files(p, out);
    else if (/\.(m?[jt]sx?|cjs|ya?ml|json|html|txt)$/.test(n)) out.push(p);
  }
  return out;
}
// The guard itself names what it blocks; everything else must not mention Rovo at all.
// (jira.js wires the server guard into every request; the test below checks that it does.)
const GUARDS = new Set([join('src', 'lib', 'norovo.js'), join('src', 'lib', 'jira.js'), join('static', 'cockpit', 'src', 'lib', 'api.js'), join('static', 'cockpit', 'src', 'lib', 'bridge.js')]);

test('manifest: no Rovo agent, action, resource or scope', () => {
  const m = read('manifest.yml');
  assert.doesNotMatch(m, /rovo/i, 'the manifest must not mention Rovo');
  assert.doesNotMatch(m, /^ {2}action:/m, 'no action modules (they exist only for Rovo agents)');
  assert.doesNotMatch(m, /^ {2}rovo:/m);
  assert.doesNotMatch(m, /scopes:[\s\S]*?(chat|assist|agent)/i, 'no assistant or chat scopes');
});

test('code: no Rovo call, import or bridge opener anywhere in the app', () => {
  const all = [...files('src'), ...files('shared'), ...files(join('static', 'cockpit', 'src')), ...files(join('static', 'cockpit', 'field'))];
  assert.ok(all.length > 30, `${all.length} files scanned`);
  for (const f of all) {
    if (GUARDS.has(f)) continue;
    const s = read(f);
    assert.doesNotMatch(s, /rovo/i, `${f} mentions Rovo`);
    assert.doesNotMatch(s, /\/gateway\/api\/(assist|ai|agents?)/i, `${f} addresses the Atlassian assistant gateway`);
  }
  // the browser bridge is reached only through lib/bridge.js, which loads four bridge modules by file – nothing else
  const bridgeLines = read(join('static', 'cockpit', 'src', 'lib', 'bridge.js')).match(/^export \{ \w+ \} from '@bridge-part\/(invoke|fetch|router|view)';$/gm) || [];
  assert.equal(bridgeLines.length, 4, 'exactly invoke, requestJira, router and view');
  assert.match(read(join('static', 'cockpit', 'src', 'lib', 'api.js')), /await import\('\.\/bridge\.js'\)/);
});

test('dependencies: no Rovo package', () => {
  for (const p of ['package.json', join('static', 'cockpit', 'package.json')]) {
    const j = JSON.parse(read(p));
    for (const d of Object.keys({ ...j.dependencies, ...j.devDependencies })) assert.doesNotMatch(d, /rovo/i, `${p}: ${d}`);
  }
  assert.ok(!existsSync(join(root, 'src', 'rovo.js')) && !existsSync(join(root, 'rovo')), 'no Rovo sources or prompts');
});

test('runtime guard: only Jira and Confluence REST, never Rovo or the assistant gateway', () => {
  for (const ok of ['/rest/api/3/myself', '/rest/api/3/user/search?query=Provost', '/wiki/api/v2/pages', route`/rest/api/3/issue/${'PCX-1'}`]) assert.doesNotThrow(() => assertProductApi(ok), String(ok?.value_ ?? ok));
  for (const bad of ['/gateway/api/assist/chat', '/rest/rovo/agents', '/wiki/rovo/x', 'https://evil.example/rest/api/3', '/gateway/api/graphql', '', route`/gateway/api/assist/${'x'}`]) {
    assert.throws(() => assertProductApi(bad), /Blocked by policy/, String(bad?.value_ ?? bad));
  }
});

test('the request helpers run every call through the guard', () => {
  const j = read(join('src', 'lib', 'jira.js'));
  assert.equal((j.match(/assertProductApi\(path\)/g) || []).length, 2, 'jira() and confluence()');
  for (const f of files('src')) if (f !== join('src', 'lib', 'jira.js')) assert.doesNotMatch(read(f), /\.request(Jira|Confluence)\(/, `${f} must use the guarded helper`);
});

test('shipped bundle: no Rovo code at all (the bridge opener is not even included)', () => {
  for (const out of ['dist', 'dist-field', 'dist-story']) { // the cockpit, the work-item field editor and the Planungs-Check panel
    const dist = join(root, 'static', 'cockpit', out, 'assets');
    if (!existsSync(dist)) continue; // nothing built yet in this checkout
    const files = readdirSync(dist).filter((f) => f.endsWith('.js'));
    assert.ok(files.length > 0);
    for (const f of files) assert.doesNotMatch(readFileSync(join(dist, f), 'utf8'), /rovo/i, `${out}/assets/${f} contains Rovo code`);
  }
  // no source file outside lib/bridge.js imports the browser bridge directly
  const offenders = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(e.name) && !/bridge\.js$/.test(e.name) && /from '@forge\/bridge'|import\('@forge\/bridge'\)/.test(readFileSync(p, 'utf8'))) offenders.push(p); } };
  walk(join(root, 'static', 'cockpit', 'src'));
  walk(join(root, 'static', 'cockpit', 'field'));
  assert.deepEqual(offenders, [], 'only lib/bridge.js imports @forge/bridge');
});
