// Local preview with a customer-sized dataset: open the dev UI with `?mock&big=S|M|L` (e.g.
// http://localhost:5173/?mock&big=L). static/cockpit/src/lib/mock.js imports this file ONLY when the `big` parameter is
// set (dev builds only – production bundles never contain the mock backend) and then serves this dataset for
// `bootstrap` / `dataset` instead of the demo company. Everything else (config, roles, settings) stays the mock's.
// The dataset is generated in the browser from a fixed seed relative to the real "today", so dates look current.
import { bigDataset, SIZES } from './bigDataset.js';

export function bigMockDataset(size, todayIso) {
  const s = String(size || '').toUpperCase();
  const ds = bigDataset(SIZES[s] ? s : 'S', { today: todayIso });
  // the mock's own config (levels, type ids) is merged on top by mock.js; keep the generator's metadata visible
  return { ...ds, truncated: false, planEven: {} };
}
