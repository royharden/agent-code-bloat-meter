import type { AnalysisV1, Atom, Hunk } from '../core/types';
import type { LabelV1 } from '../corpus/contract';
import { checkRequiredAtomsExist, validateLabels } from '../corpus/validate';
import { assignTier, tierGroup } from '../policy/policy';
import type { Policy } from '../policy/policy';
import { compareText, tieKey } from '../policy/tiekey';
import { orderHunks, PREDICTIVE_ORDERINGS } from './orderings';
import type { Ordering } from './orderings';
import { allRequiredExposed, atomIdentity, sliceHunks } from './slicer';
import { rootBootstrap } from '../stats/bootstrap';
import { wilson95 } from '../stats/wilson';

export interface Prediction { changeId: string; inputHash: string; orders: Record<Ordering, string[][]> }
export function makePredictions(analyses: readonly AnalysisV1[], policy: Policy): Prediction[] {
  if (new Set(analyses.map(a => a.changeId)).size !== analyses.length) throw new Error('Duplicate change id');
  return [...analyses].sort((a, b) => compareText(a.changeId, b.changeId)).map(a => {
    if (a.status !== 'ok') throw new Error(`Study input ${a.changeId} has status ${a.status}`);
    const orders = {} as Record<Ordering, string[][]>;
    for (const ordering of PREDICTIVE_ORDERINGS) orders[ordering] = Array.from({ length: ordering === 'random' ? 100 : 1 }, (_, i) => orderHunks(a, ordering, policy, 4500 + i).map(h => h.id));
    return { changeId: a.changeId, inputHash: a.inputHashes.change, orders };
  });
}
function ratio(n: number, d: number): number | null { return d ? n / d : null; }
function assertLabels(analyses: readonly AnalysisV1[], labels: readonly LabelV1[]): void {
  const problems = [...validateLabels(labels), ...checkRequiredAtomsExist(new Map(analyses.map(a => [a.changeId, a.hunks.flatMap(h => h.atoms)])), labels)];
  if (problems.some(p => !p.ok)) throw new Error(`Label validation failed: ${JSON.stringify(problems.filter(p => !p.ok))}`);
  const ids = new Set(analyses.map(a => a.changeId));
  if (labels.length !== ids.size || new Set(labels.map(l => l.changeId)).size !== ids.size || labels.some(l => !ids.has(l.changeId))) throw new Error('Analysis/label set mismatch');
  if (new Set(labels.map(l => l.split)).size !== 1) throw new Error('Split contamination');
}
export function tierShares(analyses: readonly AnalysisV1[], labels: readonly LabelV1[], policy: Policy) {
  const labelById = new Map(labels.map(l => [l.changeId, l]));
  const counts = { all: { atoms: 0, tier2: 0 }, clean: { atoms: 0, tier2: 0 }, twins: { atoms: 0, tier2: 0 }, nearMiss: { atoms: 0, tier2: 0 } };
  let cleanFlagged = 0, cleanChanges = 0, manualHunks = 0, nearMissesFlagged = 0;
  const traps: Record<string, { total: number; flagged: number }> = {};
  for (const a of analyses) {
    const l = labelById.get(a.changeId); if (!l) throw new Error('Missing label');
    const metrics = new Map(a.metrics.map(m => [m.hunkId, m]));
    let flagged = false;
    for (const h of a.hunks) {
      const m = metrics.get(h.id); if (!m) throw new Error('Missing metrics');
      const tier = assignTier(m, policy), high = tierGroup(tier) === 2;
      if (tier === 'manual') manualHunks++;
      flagged ||= high;
      const groups = [counts.all];
      if (l.kind !== 'defect') groups.push(counts.clean, l.kind === 'clean' ? counts.twins : counts.nearMiss);
      for (const group of groups) { group.atoms += h.atoms.length; if (high) group.tier2 += h.atoms.length; }
    }
    if (l.kind !== 'defect') { cleanChanges++; if (flagged) cleanFlagged++; }
    if (l.kind === 'near_miss') { if (flagged) nearMissesFlagged++; for (const id of l.trapIds ?? []) { const row = traps[id] ??= { total: 0, flagged: 0 }; row.total++; if (flagged) row.flagged++; } }
  }
  return { all: ratio(counts.all.tier2, counts.all.atoms), clean: ratio(counts.clean.tier2, counts.clean.atoms), twins: ratio(counts.twins.tier2, counts.twins.atoms), nearMiss: ratio(counts.nearMiss.tier2, counts.nearMiss.atoms), counts, cleanFlagged, cleanChanges, cleanFlaggedInterval: wilson95(cleanFlagged, cleanChanges), traps, manualHunks, nearMissesFlagged };
}
/** Oracle is deliberately confined to the post-release module. It is absent from predictions. */
export function oracleOrder(analysis: AnalysisV1, required: readonly Atom[]): Hunk[] {
  const keys = new Set(required.map(atomIdentity));
  const has = (h: Hunk) => h.atoms.some(a => keys.has(atomIdentity(a))) ? 1 : 0;
  return [...analysis.hunks].sort((a, b) => has(b) - has(a) || compareText(tieKey(analysis.changeId, a.id), tieKey(analysis.changeId, b.id)) || compareText(a.id, b.id));
}
export function evaluatePredictions(analyses: readonly AnalysisV1[], labels: readonly LabelV1[], predictions: readonly Prediction[], policy: Policy, comparator: 'size-asc' | 'size-desc') {
  assertLabels(analyses, labels);
  // Recompute label-free predictions, preventing stale or partial order sets from silently entering evaluation.
  if (JSON.stringify(predictions) !== JSON.stringify(makePredictions(analyses, policy))) throw new Error('Prediction mismatch');
  const byId = new Map(analyses.map(a => [a.changeId, a])), predById = new Map(predictions.map(p => [p.changeId, p]));
  const roots = [...new Set(labels.map(l => l.rootId))].sort(compareText);
  const methods = [...PREDICTIVE_ORDERINGS, 'label-oracle', 'full-review'] as const;
  const rows = methods.flatMap(method => [false, true].map(wholeHunk => {
    const budgets = [10, 20, 30].map(percent => {
      const perChange = labels.map(l => {
        const a = byId.get(l.changeId)!, p = predById.get(l.changeId)!;
        const hunkMap = new Map(a.hunks.map(h => [h.id, h]));
        const orders = method === 'label-oracle' ? [oracleOrder(a, l.defect?.requiredAtoms ?? [])] : method === 'full-review' ? [a.hunks] : p.orders[method].map(ids => ids.map(id => hunkMap.get(id)!));
        const slices = orders.map(order => sliceHunks(order, method === 'full-review' ? 100 : percent, wholeHunk));
        const exposed = l.kind === 'defect' ? slices.filter(s => allRequiredExposed(l.defect!.requiredAtoms, s.selectedAtoms)).length / slices.length : 0;
        return { changeId: l.changeId, rootId: l.rootId, kind: l.kind, family: l.defect?.family, signatureBearing: l.defect?.signatureBearing, anchorKind: l.defect?.anchorKind, exposed, selected: slices.reduce((n, s) => n + s.selectedAtoms.length, 0) / slices.length, partialHunks: slices.reduce((n, s) => n + s.partialHunkIds.length, 0) };
      });
      const comparatorExposure = new Map(labels.map(l => {
        const a = byId.get(l.changeId)!, p = predById.get(l.changeId)!, map = new Map(a.hunks.map(h => [h.id, h]));
        const slice = sliceHunks(p.orders[comparator][0]!.map(id => map.get(id)!), percent, wholeHunk);
        return [l.changeId, l.kind === 'defect' && allRequiredExposed(l.defect!.requiredAtoms, slice.selectedAtoms) ? 1 : 0];
      }));
      const rootCounts = roots.map(rootId => { const rows = perChange.filter(c => c.rootId === rootId && c.kind === 'defect'); return { rootId, defects: rows.length, exposed: rows.reduce((n, c) => n + c.exposed, 0), comparatorExposed: rows.reduce((n, c) => n + comparatorExposure.get(c.changeId)!, 0) }; });
      const defects = perChange.filter(c => c.kind === 'defect'), exposed = defects.reduce((n, c) => n + c.exposed, 0), selected = perChange.reduce((n, c) => n + c.selected, 0);
      const strata = (key: 'family' | 'signatureBearing' | 'anchorKind') => Object.fromEntries([...new Set(defects.map(c => String(c[key])))].map(value => { const group = defects.filter(c => String(c[key]) === value); return [value, { defects: group.length, exposed: group.reduce((n, c) => n + c.exposed, 0), recall: ratio(group.reduce((n, c) => n + c.exposed, 0), group.length) }]; }));
      const intervals = rootBootstrap(rootCounts);
      const macro = rootCounts.filter(r => r.defects > 0);
      return { percent, defects: defects.length, exposed, recall: ratio(exposed, defects.length), macroRecall: macro.length ? macro.reduce((n, r) => n + r.exposed / r.defects, 0) / macro.length : null, intervals, imprecise: intervals.recall === null || intervals.recall.halfWidth > .15, perFamily: strata('family'), bySignatureBearing: strata('signatureBearing'), byAnchorKind: strata('anchorKind'), defectsPer100SelectedAtoms: ratio(exposed * 100, selected), selectedAtoms: selected, partialHunks: perChange.reduce((n, c) => n + c.partialHunks, 0), perChange };
    });
    return { ordering: method, status: 'measured' as const, wholeHunk, roots: roots.length, budgets };
  }));
  return { rows, tierShares: tierShares(analyses, labels, policy), absentBaselines: [{ ordering: 'jscpd', status: 'not captured' }, { ordering: 'sarif:fallow', status: 'not captured' }, { ordering: 'lizard', status: 'not captured', reason: 'licence unresolved' }], providerRequests: 0, spentUSD: 0, armB: 'not run' };
}
