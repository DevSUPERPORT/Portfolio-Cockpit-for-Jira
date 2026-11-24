import './lib/raf-shim.js'; // must run before anything that animates
import { mark } from './lib/diag.js';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { call, getContext, enableTheme } from './lib/api.js';
import { setJiraLocale, chooseLang } from './lib/i18n.js';
import Root from './App.jsx';
import { watchPreloadErrors } from './lib/chunkReload.js';

watchPreloadErrors();

// The data request starts the moment this code runs, in parallel with context, theme and first render.
// The server knows which page it serves (the admin page gets no dataset), so nothing here waits for it.
mark('main start');
const bootstrap = call('bootstrap', { withDataset: true });
bootstrap.then((b) => mark(`bootstrap ok, dataset ${!!b.dataset}, lang ${b.prefs?.lang}, view ${b.prefs?.view}`), (e) => mark(`bootstrap failed ${e.code}`));
bootstrap.catch(() => {}); // handled in Root

async function start() {
  const [ctx] = await Promise.all([getContext().catch((e) => { mark(`ctx failed ${e}`); return {}; }), enableTheme()]);
  mark(`ctx ok module ${ctx?.moduleKey}`);
  const forced = new URLSearchParams(location.search).get('lang');
  setJiraLocale(ctx?.locale || navigator.language);
  if (forced) chooseLang(forced.slice(0, 2));
  mark('render');
  createRoot(document.getElementById('root'), { onUncaughtError: (e) => mark(`REACT ${e?.stack || e}`), onCaughtError: (e) => mark(`REACT caught ${e?.stack || e}`) }).render(<Root ctx={ctx || {}} bootstrap={bootstrap} />);
}
start();
