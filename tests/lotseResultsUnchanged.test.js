// Speed-ups must not change results: every hot path's output on the S-size customer dataset (computeAll and its parts,
// the boards, the optimizer, realistic capacity, 20 Lotse answers asked twice, the briefing, a what-if) hashes to the
// fingerprint recorded before the performance work (tests/perf/fingerprints.json, tests/perf/fingerprint.js).
// M and L are checked by `npm run perf` (tests/perf/perf.test.js) or PERF_RESULTS=M,L here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fingerprints } from './perf/fingerprint.js';

const REC = JSON.parse(readFileSync(new URL('./perf/fingerprints.json', import.meta.url), 'utf8'));
const SIZES = ['S', ...(process.env.PERF_RESULTS || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => s && s !== 'S')];

for (const size of SIZES) {
  test(`results unchanged on ${size}: same output as before the speed-ups`, { timeout: 600_000 }, () => {
    const now = fingerprints(size);
    for (const [k, v] of Object.entries(REC[size])) assert.equal(now[k], v, `${size} ${k}`);
  });
}
