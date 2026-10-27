import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OwnCorpusSource } from '../src/corpus/own-source';
import { analyze } from '../src/diffmetrics';
import { evaluatePredictions, makePredictions } from '../src/orderings/evaluate';
import type { Prediction } from '../src/orderings/evaluate';
import { frozenPolicy, requireGate, verifyFreeze } from '../src/heldout/custody';
import type { FrozenRegistration } from '../src/heldout/custody';
import { beginAttempt, recordAttemptFailure, recordFinalReport, recordPredictions, recoverFinalReport, releaseLabels, resumeAttempt, writeImmutableArtifact } from '../src/heldout/attempt';
import type { AttemptRecord } from '../src/heldout/attempt';
import { sha256Hex } from '../src/core/hash';
import type { AnalysisV1 } from '../src/core/types';
import type { LabelV1, Split } from '../src/corpus/contract';
export interface EvaluationOptions { root: string; gate: string; split: Split; attemptId?: string; releaseDir?: string; custodyDir?: string; resume?: boolean; diagnostics?: string }
function heldoutBinding(options: EvaluationOptions, preregBytes: Uint8Array, reg: FrozenRegistration) {
  if (options.split !== 'heldout' || !options.attemptId || !options.custodyDir) throw new Error('Heldout requires --attempt-id and --custody-dir');
  if (resolve(options.custodyDir) !== resolve(options.root, '../sealed/custody')) throw new Error('Custody directory must be the fixed outer sealed/custody directory; alternate locks are forbidden');
  return { attemptPath: resolve(options.custodyDir, 'heldout.attempt.json'), binding: {
    attemptId: options.attemptId, preregHash: sha256Hex(preregBytes), commitmentHash: reg.hashes.corpusCommitment!, implementationCommit: reg.hashes.implementationCommit!,
  } };
}
export async function evaluate(options: EvaluationOptions) {
  const { root, split, gate } = options;
  if (split !== 'dev' && split !== 'heldout') throw new Error('Invalid split');
  requireGate(root, gate);
  const preregBytes = readFileSync(resolve(root, 'preregistration.json'));
  const reg = JSON.parse(preregBytes.toString('utf8')) as FrozenRegistration;
  verifyFreeze(root, reg);
  const policy = frozenPolicy(reg), comparator = reg.comparator.primarySizeComparator!;
  let attempt: AttemptRecord | null = null, attemptPath: string | null = null;
  if (split === 'heldout') {
    if (!options.releaseDir) throw new Error('Heldout evaluation requires --release-dir');
    // Lock is created before source construction, manifest loading, or reading released held-out bytes.
    const location = heldoutBinding(options, preregBytes, reg);
    attemptPath = location.attemptPath;
    const { binding } = location;
    attempt = options.resume ? resumeAttempt(attemptPath, binding) : beginAttempt(attemptPath, binding);
  }
  try {
    const source = new OwnCorpusSource({ corpusDir: resolve(root, 'corpus'), heldoutReleaseDir: options.releaseDir });
    const analyses: AnalysisV1[] = []; for await (const input of source.inputs(split)) analyses.push(analyze(input));
    const computed = makePredictions(analyses, policy);
    let predictions: Prediction[] = computed;
    if (attempt && attemptPath) {
      if (attempt.state === 'reserved') attempt = recordPredictions(attemptPath, attempt, resolve(options.custodyDir!, 'predictions.json'), predictions);
      else {
        predictions = JSON.parse(readFileSync(attempt.predictionsPath!, 'utf8')) as Prediction[];
        if (JSON.stringify(computed) !== JSON.stringify(predictions)) throw new Error('Continuation predictions changed');
      }
      if (attempt.state === 'predictions-recorded') attempt = releaseLabels(attemptPath, attempt);
      if (attempt.state !== 'labels-released') throw new Error('Invalid label release state');
    }
    // First labels() call is after prediction bytes and their digest are durably recorded.
    const labels: LabelV1[] = []; for await (const label of source.labels(split)) labels.push(label);
    const report = evaluatePredictions(analyses, labels, predictions, policy, comparator);
    const regular = report.rows.filter(r => !r.wholeHunk);
    const primary = regular.find(r => r.ordering === 'tier-policy')!.budgets[1]!;
    const baseline = regular.find(r => r.ordering === comparator)!.budgets[1]!;
    const ci = (interval: { low: number; high: number } | null) => interval ? [interval.low, interval.high] : 'undefined';
    const difference = primary.intervals.difference;
    const namedFailures = ['boundary-flip-no-signal', 'await-removed-no-signal', 'inverted-logic-no-signal', 'tiny-wrong-constant', 'defect-in-complex-function-no-growth', 'guard-deletion-lowers-complexity', 'N1-entry-guard', 'N2-best-effort-catch', 'N3-default-throw', 'N4-duplicated-validators', 'N5-complex-correct', 'N6-large-refactor-size-desc', 'N7-unchanged-test-covers', 'N8-parse-then-validate', 'test-reference-without-assertion', 'tsx-render-branch', 'test-only-behavior-change', 'partial-hunk-at-budget', 'deletion-required-atoms', 'parse-or-function-map-unknown', 'clone-normalization-collision'];
    const predictionHash = sha256Hex(JSON.stringify(predictions, null, 2) + '\n');
    // The independently appointed operator classifies semantic failure categories AFTER prediction/label release.
    // Builders implement this input seam; they never author its evidence. Preserve the same attempt for continuation.
    if (!options.diagnostics) return { schema: 's45.evaluation-pending/1' as const, state: 'diagnostics-pending' as const,
      predictionHash, preregistrationHash: sha256Hex(preregBytes), manifestHash: reg.corpus.manifestHash,
      attemptId: attempt?.attemptId ?? null, categories: namedFailures, report };
    const evidence = JSON.parse(readFileSync(options.diagnostics, 'utf8')) as {
      schema?: string; operatorSession?: string; predictionHash?: string; preregistrationHash?: string;
      manifestHash?: string; rows?: { id: string; items: string[]; rationale: string }[];
    };
    const admission = JSON.parse(readFileSync(gate, 'utf8')) as { operatorSession: string; builderSessions: string[] };
    if (evidence.schema !== 's45.diagnostics/1' || evidence.operatorSession !== admission.operatorSession ||
      admission.builderSessions.includes(evidence.operatorSession!) || evidence.predictionHash !== predictionHash ||
      evidence.preregistrationHash !== sha256Hex(preregBytes) || evidence.manifestHash !== reg.corpus.manifestHash ||
      !Array.isArray(evidence.rows) || evidence.rows.length !== namedFailures.length) throw new Error('Independent diagnostic evidence is missing or bound to another run');
    const changeIds = new Set(labels.map(l => l.changeId));
    const classified = namedFailures.map(id => {
      const matching = evidence.rows!.filter(row => row.id === id);
      const row = matching[0];
      if (matching.length !== 1 || !row || typeof row.rationale !== 'string' || !row.rationale.trim() ||
        !Array.isArray(row.items) || new Set(row.items).size !== row.items.length || row.items.some(item => typeof item !== 'string' || !changeIds.has(item))) {
        throw new Error(`Incomplete diagnostic classification: ${id}`);
      }
      return { id, count: row.items.length, items: row.items };
    });
    const result = {
      schema: 's45.results/1' as const, state: 'measured' as const,
      header: { corpusCommitment: reg.hashes.corpusCommitment, policyHash: reg.hashes.policy, preregistrationHash: sha256Hex(preregBytes), implementationCommit: reg.hashes.implementationCommit, attemptId: attempt?.attemptId ?? null, primarySizeComparator: comparator, verdict: difference === null ? 'undefined' : difference.low > 0 ? 'supported' : primary.recall! - baseline.recall! > 0 && difference.high >= 0 ? 'inconclusive' : 'not supported', precision: primary.imprecise ? 'imprecise' : 'precise' },
      rows: [...regular.map(r => ({ ordering: r.ordering, status: r.status, roots: r.roots, defects: r.budgets[1]!.defects, recall10: r.budgets[0]!.recall, recall20: r.budgets[1]!.recall, recall20CI: ci(r.budgets[1]!.intervals.recall), recall30: r.budgets[2]!.recall, delta20: r.budgets[1]!.recall === null || baseline.recall === null ? null : r.budgets[1]!.recall! - baseline.recall, delta20CI: ci(r.budgets[1]!.intervals.difference), tier2ShareAll: report.tierShares.all, tier2ShareClean: report.tierShares.clean, nearMissesFlagged: report.tierShares.nearMissesFlagged, manualHunks: report.tierShares.manualHunks, partialHunks: r.budgets[1]!.partialHunks, providerRequests: 0, spentUsd: 0 })), ...report.absentBaselines.map(r => ({ ordering: r.ordering, status: r.status, statusNote: 'reason' in r ? r.reason : 'not captured', roots: null, defects: null, recall10: null, recall20: null, recall20CI: null, recall30: null, delta20: null, delta20CI: null, tier2ShareAll: null, tier2ShareClean: null, nearMissesFlagged: null, manualHunks: null, partialHunks: null, providerRequests: 0, spentUsd: 0 }))],
      perFamily: regular.flatMap(r => Object.entries(r.budgets[1]!.perFamily).map(([family, f]) => ({ ordering: r.ordering, family, defects: f.defects, recall20: f.recall }))),
      wholeHunk: report.rows.filter(r => r.wholeHunk).map(r => ({ ordering: r.ordering, recall10: r.budgets[0]!.recall, recall20: r.budgets[1]!.recall, recall30: r.budgets[2]!.recall })),
      armB: 'arm B not run',
      namedFailures: classified,
      supplementary: { tierShares: report.tierShares, endpoints: report.rows.map(row => ({ ordering: row.ordering, wholeHunk: row.wholeHunk,
        budgets: row.budgets.map(b => ({ percent: b.percent, macroRecall: b.macroRecall, bySignatureBearing: b.bySignatureBearing,
          byAnchorKind: b.byAnchorKind, defectsPer100SelectedAtoms: b.defectsPer100SelectedAtoms, selectedAtoms: b.selectedAtoms })) })),
        diagnostics: { operatorSession: evidence.operatorSession, evidenceHash: sha256Hex(readFileSync(options.diagnostics)) },
        randomPartialHunkConvention: 'sum across 100 permutations; recall and selected atoms are permutation means' },
    };
    if (attempt && attemptPath) attempt = recordFinalReport(attemptPath, attempt, resolve(options.custodyDir!, 'heldout.report.json'), result);
    return result;
  } catch (error) {
    if (attempt && attemptPath) recordAttemptFailure(attemptPath, error);
    throw error;
  }
}
type MeasuredReport = Extract<Awaited<ReturnType<typeof evaluate>>, { schema: 's45.results/1' }>;
/** Explicit export-only recovery: no OwnCorpusSource, analyses, labels, diagnostics or scoring calls. */
export function recoverEvaluation(options: EvaluationOptions): MeasuredReport {
  if (options.resume || options.releaseDir || options.diagnostics) throw new Error('--recover-report cannot be combined with --resume, --release-dir or --diagnostics');
  requireGate(options.root, options.gate);
  const preregBytes = readFileSync(resolve(options.root, 'preregistration.json'));
  const reg = JSON.parse(preregBytes.toString('utf8')) as FrozenRegistration;
  verifyFreeze(options.root, reg);
  const { attemptPath, binding } = heldoutBinding(options, preregBytes, reg);
  return JSON.parse(recoverFinalReport(attemptPath, binding).text) as MeasuredReport;
}
/** Output errors never affect the completed custody artifact; identical prior files are accepted. */
export function exportResults(root: string, report: MeasuredReport): void {
  if (report.schema !== 's45.results/1' || report.state !== 'measured' || !report.header.attemptId) throw new Error('Only a complete held-out report may be persisted as measured results');
  const text = JSON.stringify(report, null, 2) + '\n';
  // Render first. A rendering failure leaves custody intact and creates no half export pair.
  const markdown = renderResultsMarkdown(report);
  mkdirSync(resolve(root, 'results'), { recursive: true });
  writeImmutableArtifact(resolve(root, 'results/results.json'), text);
  writeImmutableArtifact(resolve(root, 'results/results.md'), markdown);
}
export function renderResultsMarkdown(report: Awaited<ReturnType<typeof evaluate>>): string {
  if (report.schema !== 's45.results/1') throw new Error('Diagnostic evidence required before rendering measured results');
  const cell = (value: unknown) => value === null || value === undefined ? '' : Array.isArray(value) ? `[${value.join(', ')}]` : String(value);
  return ['# Defect exposure recall results', '', `Attempt: ${report.header.attemptId}. Implementation: ${report.header.implementationCommit}.`,
    `Corpus: ${report.header.corpusCommitment}. Policy: ${report.header.policyHash}. Preregistration: ${report.header.preregistrationHash}.`,
    `Verdict: ${report.header.verdict}; precision: ${report.header.precision}.`, '',
    '| Ordering | Status | Roots / defects | Recall10 | Recall20 [95% CI] | Recall30 | Delta20 [95% CI] | Tier2 all / clean | Near misses | Manual | Partial | Requests | USD |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...report.rows.map(r => `| ${r.ordering} | ${r.status}${'statusNote' in r ? ': ' + r.statusNote : ''} | ${cell(r.roots)} / ${cell(r.defects)} | ${cell(r.recall10)} | ${cell(r.recall20)} ${cell(r.recall20CI)} | ${cell(r.recall30)} | ${cell(r.delta20)} ${cell(r.delta20CI)} | ${cell(r.tier2ShareAll)} / ${cell(r.tier2ShareClean)} | ${cell(r.nearMissesFlagged)} | ${cell(r.manualHunks)} | ${cell(r.partialHunks)} | ${r.providerRequests} | ${r.spentUsd} |`),
    '', 'Arm B not run. Exposure measures allocation, not discovery.', '', '## Per-family and whole-hunk results', '',
    '```json', JSON.stringify({ perFamily: report.perFamily, wholeHunk: report.wholeHunk }, null, 2), '```', '',
    '## Named failures and secondary endpoints', '', '```json', JSON.stringify({ namedFailures: report.namedFailures, supplementary: report.supplementary }, null, 2), '```', '',
    'Interpret with docs/LIMITATIONS.md. Missing baseline cells are absent, never zero.', ''].join('\n');
}
if (/(^|[\\/])eval\.ts$/.test(process.argv[1] ?? '')) {
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const gate = arg('--gate'), split = arg('--split');
  if (!gate || (split !== 'dev' && split !== 'heldout')) throw new Error('Required --gate <receipt> --split dev|heldout');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const options: EvaluationOptions = { root, gate, split, attemptId: arg('--attempt-id'), releaseDir: arg('--release-dir'), custodyDir: arg('--custody-dir'), resume: process.argv.includes('--resume'), diagnostics: arg('--diagnostics') };
  const work = process.argv.includes('--recover-report') ? Promise.resolve().then(() => recoverEvaluation(options)) : evaluate(options);
  work.then(report => {
    const text = JSON.stringify(report, null, 2) + '\n';
    if (process.argv.includes('--write-output')) {
      if (report.schema !== 's45.results/1' || split !== 'heldout') throw new Error('Only a complete held-out report may be persisted as measured results');
      exportResults(root, report);
    }
    process.stdout.write(text);
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
