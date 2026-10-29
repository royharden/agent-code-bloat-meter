import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OwnCorpusSource } from '../src/corpus/own-source';
import { analyze } from '../src/diffmetrics';
import { CANDIDATES } from '../src/policy/policy';
import { evaluatePredictions, makePredictions, tierShares } from '../src/orderings/evaluate';
import { requireGate } from '../src/heldout/custody';
import { sha256Hex } from '../src/core/hash';
import type { AnalysisV1 } from '../src/core/types';
import type { LabelV1 } from '../src/corpus/contract';
export async function tuneDev(root: string, gate: string, split = 'dev') {
  if (split !== 'dev') throw new Error('Tuning refuses heldout');
  requireGate(root, gate);
  const source = new OwnCorpusSource({ corpusDir: resolve(root, 'corpus') });
  const analyses: AnalysisV1[] = [];
  for await (const input of source.inputs('dev')) analyses.push(analyze(input));
  // Every candidate's predictions are generated before labels; none is selected through held-out input.
  const candidates = CANDIDATES.map(policy => ({ policy, predictions: makePredictions(analyses, policy) }));
  const labels: LabelV1[] = []; for await (const label of source.labels('dev')) labels.push(label);
  const baseline = evaluatePredictions(analyses, labels, candidates[0]!.predictions, candidates[0]!.policy, 'size-asc');
  const recall = (report: ReturnType<typeof evaluatePredictions>, ordering: string): number => {
    const value = report.rows.find(r => r.ordering === ordering && !r.wholeHunk)!.budgets.find(b => b.percent === 20)!.recall;
    if (value === null) throw new Error('No dev defects'); return value;
  };
  const comparator = recall(baseline, 'size-desc') > recall(baseline, 'size-asc') ? 'size-desc' as const : 'size-asc' as const;
  const evaluated = candidates.map(({ policy, predictions }) => {
    const shares = tierShares(analyses, labels, policy);
    return { policy, recall20: recall(evaluatePredictions(analyses, labels, predictions, policy, comparator), 'tier-policy'), shares, valid: shares.all !== null && shares.clean !== null && shares.all <= .4 && shares.clean <= .25 };
  });
  const ranked = evaluated.filter(c => c.valid).sort((a, b) => b.recall20 - a.recall20 || a.shares.clean! - b.shares.clean! || b.policy.T - a.policy.T || b.policy.N - a.policy.N);
  return { schema: 's45.tuning/1', split: 'dev', status: ranked.length ? 'selected' : 'no valid policy in the declared space', selected: ranked[0]?.policy ?? null, comparator, candidates: evaluated, manifestHash: sha256Hex(readFileSync(resolve(root, 'corpus/manifest.json'))), gateHash: sha256Hex(readFileSync(gate)) };
}
function argument(name: string): string { const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i + 1]) throw new Error(`Required ${name}`); return process.argv[i + 1]!; }
if (/(^|[\\/])tune\.ts$/.test(process.argv[1] ?? '')) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const splitAt = process.argv.indexOf('--split');
  tuneDev(root, argument('--gate'), splitAt < 0 ? 'dev' : process.argv[splitAt + 1]).then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n')).catch(error => { console.error(error); process.exitCode = 1; });
}
