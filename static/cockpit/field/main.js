// Edit view for the app's own Jira fields (T-shirt size, target quarters) on the work item.
// Deliberately tiny (no React): it opens instantly. Jira saves the value via view.submit and
// checks the user's edit permission itself.
import { view } from '@bridge-part/view'; // company policy: only the bridge modules needed, never the AI-assistant opener
import { invoke } from '@bridge-part/invoke';
import './field.css';

const app = document.getElementById('app');
let de = true;
const tr = (d, e) => (de ? d : e);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};
const SK = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const fmtH = (h) => `${new Intl.NumberFormat(de ? 'de-DE' : 'en-GB').format(h)} h`;
const qLabel = (q) => `Q${q.slice(-1)} ${q.slice(0, 4)}`;
const parseQ = (s) => {
  const m = /(\d{4})\s*[-/ ]?\s*Q\s*([1-4])/i.exec(s) || null;
  if (m) return `${m[1]}-Q${m[2]}`;
  const n = /Q\s*([1-4])\s*[-/ ]?\s*(\d{4}|\d{2})\b/i.exec(s);
  return n ? `${n[2].length === 2 ? `20${n[2]}` : n[2]}-Q${n[1]}` : null;
};

async function submit(value, btn) {
  if (btn) btn.setAttribute('aria-busy', 'true');
  try { await view.submit(value); } catch (e) {
    app.querySelector('.err')?.remove();
    app.append(el('p', { class: 'err', role: 'alert' }, tr('Speichern nicht möglich: ', 'Could not save: ') + (e?.message || e)));
    if (btn) btn.removeAttribute('aria-busy');
  }
}

function tshirt(current, sizes) {
  const cur = SK(current);
  const wrap = el('div', { class: 'pills', role: 'radiogroup', 'aria-label': tr('T-Shirt-Größe', 'T-shirt size') });
  sizes.forEach((s, i) => {
    const on = SK(s.key) === cur;
    const b = el('button', { type: 'button', class: `pill${on ? ' on' : ''}`, role: 'radio', 'aria-checked': on ? 'true' : 'false', tabindex: on || (!cur && i === 0) ? '0' : '-1', title: fmtH(s.hours),
      onclick: () => submit(s.key, b),
      onkeydown: (e) => {
        const all = [...wrap.querySelectorAll('.pill')];
        const k = all.indexOf(b);
        const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? all[(k + 1) % all.length] : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? all[(k - 1 + all.length) % all.length] : null;
        if (next) { e.preventDefault(); next.focus(); }
      } }, el('b', {}, s.key), el('span', {}, fmtH(s.hours)));
    wrap.append(b);
  });
  const known = sizes.some((s) => SK(s.key) === cur);
  return el('div', { class: 'stack' },
    wrap,
    current && !known ? el('p', { class: 'hint' }, tr(`Aktueller Wert „${current}" ist keine konfigurierte Größe.`, `Current value "${current}" is not a configured size.`)) : null,
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'ghost', onclick: () => submit(null) }, tr('Leeren', 'Clear')),
      el('button', { type: 'button', class: 'ghost', onclick: () => view.close() }, tr('Abbrechen', 'Cancel'))),
    el('p', { class: 'hint' }, tr('Größen und Stunden pflegt ihr im Portfolio Cockpit (Einstellungen).', 'Sizes and hours are maintained in Portfolio Cockpit (settings).')));
}

function quarters(current, list) {
  const chosen = new Set(String(current || '').split(/[,;]/).map(parseQ).filter(Boolean));
  const all = [...new Set([...list, ...chosen])].sort();
  const years = [...new Set(all.map((q) => q.slice(0, 4)))];
  const grid = el('div', { class: 'qgrid' });
  for (const y of years) {
    grid.append(el('div', { class: 'year' }, y));
    for (const q of all.filter((x) => x.startsWith(y))) {
      const b = el('button', { type: 'button', class: `pill q${chosen.has(q) ? ' on' : ''}`, 'aria-pressed': chosen.has(q) ? 'true' : 'false',
        onclick: () => { if (chosen.has(q)) chosen.delete(q); else chosen.add(q); b.classList.toggle('on'); b.setAttribute('aria-pressed', chosen.has(q) ? 'true' : 'false'); } }, qLabel(q));
      grid.append(b);
    }
  }
  const save = el('button', { type: 'button', class: 'primary', onclick: () => submit(chosen.size ? [...chosen].sort().join(', ') : null, save) }, tr('Speichern', 'Save'));
  return el('div', { class: 'stack' }, grid,
    el('div', { class: 'row' }, save, el('button', { type: 'button', class: 'ghost', onclick: () => view.close() }, tr('Abbrechen', 'Cancel'))));
}

(async () => {
  try { await view.theme.enable(); } catch { /* light */ }
  const ctx = await view.getContext();
  de = String(ctx.locale || 'de').toLowerCase().startsWith('de');
  document.documentElement.lang = de ? 'de' : 'en';
  const current = ctx.extension?.fieldValue ?? null;
  const isSize = /tshirt/.test(ctx.moduleKey || '') || /T-?Shirt/i.test(ctx.extension?.fieldName || '');
  app.append(el('p', { class: 'muted' }, tr('Lade …', 'Loading …')));
  // SUPERPORT kill switch: while the app is paused the field can't be changed from here.
  const [avail, res] = await Promise.all([invoke('availability').catch(() => null), invoke('field.options').catch(() => null)]);
  const mode = avail?.ok ? avail.data.mode : res?.error?.code === 'UNAVAILABLE' ? 'on' : 'off';
  if (mode !== 'off') {
    app.replaceChildren(el('div', { class: 'stack' },
      el('p', { role: 'status' }, mode === 'on'
        ? tr('Portfolio Cockpit ist vorübergehend nicht verfügbar – wir haben es zum Schutz eurer Daten pausiert. Nichts geht verloren.', 'Portfolio Cockpit is temporarily unavailable – we paused it to keep your data safe. Nothing is lost.')
        : tr('Änderungen sind vorübergehend pausiert. Der Wert bleibt, wie er ist.', 'Changes are paused for now. The value stays as it is.')),
      el('p', { class: 'hint' }, 'Status: https://superapps.statuspage.io'),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'ghost', onclick: () => view.close() }, tr('Schließen', 'Close')))));
    app.querySelector('button')?.focus();
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') view.close(); });
    return;
  }
  const data = res?.ok ? res.data : { sizes: [{ key: 'XS', hours: 40 }, { key: 'S', hours: 80 }, { key: 'M', hours: 160 }, { key: 'L', hours: 320 }, { key: 'XL', hours: 640 }], quarters: [] };
  app.replaceChildren(isSize ? tshirt(current, data.sizes) : quarters(current, data.quarters));
  app.querySelector('.pill[tabindex="0"], .pill, button')?.focus();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') view.close(); });
})();
