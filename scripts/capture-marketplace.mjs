/**
 * Captures the Marketplace screenshots (1840×900) from the click-dummy's built-in demo portfolio (fictional people and
 * projects, no customer data) and renders the hero (960×600) and banner (1120×548). Drives a local headless Chrome over
 * the DevTools protocol (no extra packages). Same approach as the Workflow Analyzer's capture script.
 *
 * Usage: start the click-dummy (`npm --prefix static/cockpit run dev -- --port 5179`), then
 *   node scripts/capture-marketplace.mjs [shot ...]
 * Output: docs/marketplace/screenshots/*.png, docs/marketplace/hero-960x600.png, docs/marketplace/banner-1120x548.png
 *
 * @app      SUPERPORT Portfolio Cockpit for Jira
 * @company  SUPERPORT
 * @created  2026-11-24
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'marketplace');
const SHOTS_DIR = path.join(OUT, 'screenshots');
const BASE = process.env.PC_MOCK_URL || 'http://localhost:5179/';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ minimal CDP client
async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-shots-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--lang=en-US', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return { proc, ws: page.webSocketDebuggerUrl, profile };
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const ready = new Promise((r) => { ws.onopen = r; });
  const send = async (method, params = {}) => {
    await ready;
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
  };
  return { send, close: () => ws.close() };
}

// ------------------------------------------------------------------ page helpers (run inside the page)
const HELPERS = `
window.__q = (text, sel = 'button, a, [role=tab], [role=button], li, label, summary') => {
  const all = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null);
  return all.find((e) => e.textContent.trim() === text) || all.find((e) => e.textContent.trim().startsWith(text)) || all.find((e) => e.textContent.includes(text));
};
window.__click = (text, sel) => { const e = window.__q(text, sel); if (!e) throw new Error('not found: ' + text); e.scrollIntoView({ block: 'center' }); e.click(); return true; };
window.__type = (selector, value) => {
  const el = document.querySelector(selector);
  if (!el) throw new Error('no field ' + selector);
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};
window.__scrollTo = (el, off = 120) => { const m = document.querySelector('main.main') || document.scrollingElement; if (!el) throw new Error('no target'); m.scrollTop += el.getBoundingClientRect().top - off; return true; };
window.__h2 = (t) => [...document.querySelectorAll('h2')].find((h) => h.textContent.trim().startsWith(t));
window.__top = () => { window.scrollTo(0, 0); document.querySelectorAll('*').forEach((e) => { if (e.scrollTop) e.scrollTop = 0; }); return true; };
`;

async function evaluate(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}

async function open(send, { query = '', width = 1840, height = 900 }) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${BASE}${query ? `?${query}` : ''}` });
  await sleep(5000);
  await evaluate(send, HELPERS + 'true');
  // the first-run tour opens a moment after load (and jumps to Portfolio): wait for it, skip it; hide the visit digest
  await evaluate(send, `(async () => {
    for (let i = 0; i < 40; i++) {
      const skip = [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Skip');
      if (skip) { skip.click(); break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 400));
    __q('Got it')?.click();
    return true;
  })()`);
  await sleep(800);
}

async function shot(send, file, clip) {
  const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('wrote', path.relative(ROOT, file));
}

// ------------------------------------------------------------------ the shots (tab = the cockpit's top navigation)
const tab = (name) => `__click(${JSON.stringify(name)}, 'button, a, [role=tab]')`;
const SHOTS = {
  portfolio: { steps: [tab('Portfolio'), `__scrollTo(__h2('Projects').closest('.card') || __h2('Projects'), 125)`], keepScroll: true },
  weekly: { steps: [tab('Weekly planning'), `__q('How to read')?.click(); true`, `__scrollTo(document.querySelector('.wb-card-wrap'), 125)`], wait: 2500, keepScroll: true },
  teams: { steps: [tab('Teams')] },
  project: { steps: [tab('Projects')], wait: 2000 },
  planactual: { steps: [tab('Plan vs. actual')], wait: 2000 },
  mywork: { steps: [tab('My work')] },
  support: { steps: [tab('Support')], wait: 2000 },
  report: { steps: [tab('C-level report')], wait: 3000 },
  ask: { steps: [`__click('Ask', 'header button, button')`], wait: 2500 },
  lotse: { steps: [`__click('Lotse', 'header button, button')`], wait: 2500 },
  settings: { query: 'ai=on&access=all', steps: [tab('Configuration'), `__click('AI & data protection')`], wait: 2000, keepScroll: true },
};

// ------------------------------------------------------------------ hero and banner (composed from the screenshots)
const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;
const LOGO = fileUrl(path.join(OUT, 'app-logo-512.png'));
const SHOT = (n) => fileUrl(path.join(SHOTS_DIR, `${n}.png`));
const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { font-family: 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif; color: #1f1d1a; overflow: hidden;
    background: radial-gradient(circle at 85% 110%, #fbe3d6 0, rgba(251,227,214,0) 45%), #f6f3ee; }
  .dots { position: absolute; inset: 0; background-image: radial-gradient(#d9d3ca 1px, transparent 1px); background-size: 18px 18px; opacity: .55; }
  .frame { position: absolute; border-radius: 14px; overflow: hidden; background: #fff;
    box-shadow: 0 30px 60px -20px rgba(40, 30, 20, .35), 0 0 0 1px rgba(40, 30, 20, .08); }
`;
const ART = {
  hero: {
    file: 'hero-960x600.png', width: 960, height: 600,
    html: () => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
      .brand { position: absolute; top: 44px; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 14px; }
      .brand img { width: 44px; height: 44px; border-radius: 10px; }
      .brand span { letter-spacing: .14em; font-size: 15px; color: #b5410c; font-weight: 600; }
      h1 { position: absolute; top: 108px; left: 0; right: 0; text-align: center; font-size: 36px; font-weight: 700; letter-spacing: -.01em; }
      .frame { left: 90px; top: 178px; width: 780px; height: 380px; background: #fff url('${SHOT('portfolio')}') no-repeat 0 0 / 1067px auto; }
    </style></head><body><div class="dots"></div>
      <div class="brand"><img src="${LOGO}"><span>SUPERPORT PORTFOLIO COCKPIT FOR JIRA</span></div>
      <h1>Rank it. Plan it. Prove it.</h1>
      <div class="frame"></div>
    </body></html>`,
  },
  banner: {
    file: 'banner-1120x548.png', width: 1120, height: 548,
    html: () => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
      .logo { position: absolute; left: 64px; top: 96px; width: 88px; height: 88px; border-radius: 18px; }
      .by { position: absolute; left: 64px; top: 200px; font-size: 14px; letter-spacing: .16em; color: #b5410c; font-weight: 600; }
      h1 { position: absolute; left: 64px; top: 226px; width: 450px; font-size: 38px; line-height: 1.12; font-weight: 700; letter-spacing: -.015em; }
      p { position: absolute; left: 64px; top: 374px; width: 440px; font-size: 20px; line-height: 1.5; color: #57524b; }
      .frame { left: 540px; top: 62px; width: 640px; height: 374px; border-radius: 14px 0 0 14px; background: #fff url('${SHOT('portfolio')}') no-repeat 0 0 / 1104px auto; }
    </style></head><body><div class="dots"></div>
      <img class="logo" src="${LOGO}">
      <div class="by">BY SUPERPORT</div>
      <h1>Portfolio Cockpit for Jira</h1>
      <p>Rank projects, see how far capacity reaches, plan the week and report to management, live from Jira.</p>
      <div class="frame"></div>
    </body></html>`,
  },
};

async function run() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const only = process.argv.slice(2);
  const { proc, ws, profile } = await launch();
  const { send, close } = client(ws);
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    for (const [name, s] of Object.entries(SHOTS)) {
      if (only.length && !only.includes(name)) continue;
      await open(send, { query: s.query || '' });
      for (const step of s.steps || []) {
        try { await evaluate(send, step); } catch (e) { console.warn(`[${name}] step failed: ${e.message}`); }
        await sleep(1200);
      }
      await sleep(s.wait || 1500);
      if (!s.keepScroll) await evaluate(send, `__top()`).catch(() => {});
      await sleep(300);
      await shot(send, path.join(SHOTS_DIR, `${name}.png`));
    }
    for (const [name, a] of Object.entries(ART)) {
      if (only.length && !only.includes(name)) continue;
      const tmp = path.join(os.tmpdir(), `pc-${name}.html`);
      fs.writeFileSync(tmp, a.html());
      await send('Emulation.setDeviceMetricsOverride', { width: a.width, height: a.height, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: fileUrl(tmp) });
      await sleep(1500);
      await shot(send, path.join(OUT, a.file));
    }
  } finally {
    close();
    proc.kill();
    await sleep(1500);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* Chrome may still hold the profile on Windows */ }
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
