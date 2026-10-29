import { readFileSync, writeFileSync } from 'node:fs';
import { analyze } from '../src/diffmetrics';
import type { ChangeV1 } from '../src/core/types';
import { assignTier } from '../src/policy/policy';
import { orderHunks } from '../src/orderings/orderings';
import { sliceHunks } from '../src/orderings/slicer';
const change = JSON.parse(readFileSync(new URL('../fixtures/demo/rate-limiter-feature.json', import.meta.url), 'utf8')) as ChangeV1;
const analysis = analyze(change), policy = { id: 'T4-N8', T: 4, N: 8 };
const payload = { schema: 's45.viewer-demo/1', state: 'generated', analysis,
  tiers: Object.fromEntries(analysis.metrics.map(m => [m.hunkId, assignTier(m, policy)])),
  orderings: Object.fromEntries(['tier-policy', 'size-asc'].map(name => [name, orderHunks(analysis, name as 'tier-policy' | 'size-asc', policy).map(h => h.id)])),
  thresholds: { T: policy.T, N: policy.N },
};
if (process.argv.includes('--write')) writeFileSync(new URL('../public/data/demo-analysis.json', import.meta.url), JSON.stringify(payload, null, 2) + '\n');
process.stdout.write(JSON.stringify({ status: 'engineering demo: not measurement', ...payload,
  at20: sliceHunks(orderHunks(analysis, 'tier-policy', policy), 20),
}, null, 2) + '\n');
