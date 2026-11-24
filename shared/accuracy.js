// Forecast accuracy, the pure part (tested in tests/accuracy.test.js): rebuild the half-time forecast of finished
// stories from raw history and compare plan and forecast with the outcome.
import { dayIdx, isoOf } from './dates.js';

// Remaining estimate (hours) as it stood at day d, from the changelog entries of field "timeestimate".
export function remainingAt(changes, d) {
  const before = changes.filter((c) => c.day <= d);
  if (before.length) return before[before.length - 1].to;
  return changes.length ? changes[0].from : null;
}

// Pure evaluation (also used by the tests): stories = [{ oe, final, worklogs: [{ d, h }], changes: [{ day, from, to }] }]
export function evaluate(stories) {
  const rows = [];
  for (const s of stories) {
    if (!(s.final > 0) || !(s.oe > 0) || !s.worklogs.length) continue;
    const days = s.worklogs.map((w) => dayIdx(w.d)).filter((x) => x != null).sort((a, b) => a - b);
    const start = days[0], end = days[days.length - 1];
    if (end - start < 2) continue; // done in a day or two: nothing to forecast halfway
    const mid = Math.floor((start + end) / 2);
    const spent = s.worklogs.filter((w) => dayIdx(w.d) <= mid).reduce((a, w) => a + w.h, 0);
    const re = remainingAt(s.changes, mid);
    if (re == null) continue; // the history does not say what was left – not guessed
    const forecast = spent + re;
    rows.push({ ...s, mid: isoOf(mid), spent, re, forecast, errPlan: (s.oe - s.final) / s.final, errForecast: (forecast - s.final) / s.final });
  }
  const med = (xs) => { if (!xs.length) return null; const v = [...xs].sort((a, b) => a - b); const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
  return {
    rows, n: rows.length,
    plan: { mape: med(rows.map((r) => Math.abs(r.errPlan))), bias: med(rows.map((r) => r.errPlan)) },
    forecast: { mape: med(rows.map((r) => Math.abs(r.errForecast))), bias: med(rows.map((r) => r.errForecast)) },
    forecastBetter: rows.filter((r) => Math.abs(r.errForecast) < Math.abs(r.errPlan)).length,
  };
}

