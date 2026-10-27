import type { AnalysisV1, Tier } from '../core/types';

export interface DemoData {
  schema: 's45.viewer-demo/1'; state: 'not-generated' | 'generated'; analysis?: AnalysisV1;
  tiers?: Record<string, Tier>; orderings?: { 'tier-policy': string[]; 'size-asc': string[] };
  thresholds?: { T: number; N: number };
}
type Interval = [number, number] | 'undefined' | null;
export interface ResultRow {
  ordering: string; status: 'not run' | 'not captured' | 'invalid capture' | 'measured' | 'mock: not measurement'; statusNote?: string;
  roots?: number | null; defects?: number | null; recall10: number | null; recall20: number | null; recall30: number | null;
  recall20CI?: Interval; delta20: number | null; delta20CI?: Interval;
  tier2ShareAll?: number | null; tier2ShareClean?: number | null; nearMissesFlagged?: number | null;
  manualHunks?: number | null; partialHunks?: number | null; providerRequests?: number | null; spentUsd?: number | null;
}
export interface ResultsData {
  schema: 's45.results/1'; state: 'not-yet-measured' | 'measured';
  header: { corpusCommitment: string | null; policyHash: string | null; preregistrationHash: string | null;
    implementationCommit: string | null; attemptId: string | null; primarySizeComparator?: string | null;
    verdict?: string | null; precision?: string | null };
  rows: ResultRow[]; perFamily: { ordering: string; family: string; defects: number | null; recall20: number | null; recall20CI?: Interval }[];
  wholeHunk: { ordering: string; recall10: number | null; recall20: number | null; recall30: number | null }[];
  armB: 'arm B not run' | { status: string; rows: { ordering: string; status: string; localizationHits: number | null;
    duplicates: number | null; unmatched: number | null; providerRequests: number | null; spentUsd: number | null }[] };
  namedFailures: { id: string; count: number | null; items?: string[] }[];
}
export async function loadData(file: 'demo-analysis' | 'results'): Promise<unknown> {
  const response = await fetch(`data/${file}.json`);
  if (!response.ok) throw new Error(`Cannot load ${file}: HTTP ${response.status}`);
  return response.json();
}
export function parseDemo(value: unknown): DemoData {
  const demo = value as DemoData;
  if (!demo || demo.schema !== 's45.viewer-demo/1' || !['not-generated', 'generated'].includes(demo.state)) throw new Error('Invalid demo data');
  if (demo.state === 'generated') {
    const a = demo.analysis;
    if (!a || a.schema !== 's45.analysis/1' || !Array.isArray(a.hunks) || !Array.isArray(a.metrics) || !demo.tiers || !demo.orderings)
      throw new Error('Generated demo is missing analysis or orderings');
    const ids = new Set(a.hunks.map(h => h.id));
    for (const key of ['tier-policy', 'size-asc'] as const) {
      const order = demo.orderings[key];
      if (!Array.isArray(order) || order.length !== ids.size || new Set(order).size !== ids.size || order.some(id => !ids.has(id)))
        throw new Error('Demo ordering must contain every hunk once');
    }
    if (a.hunks.some(h => !Array.isArray(h.atoms) || ![0, 1, 2, 'manual'].includes(demo.tiers![h.id]))) throw new Error('Invalid demo tier or atoms');
  }
  return demo;
}
export function parseResults(value: unknown): ResultsData {
  const r = value as ResultsData;
  if (!r || r.schema !== 's45.results/1' || !['not-yet-measured', 'measured'].includes(r.state) || !r.header ||
    !Array.isArray(r.rows) || !Array.isArray(r.perFamily) || !Array.isArray(r.wholeHunk) || !Array.isArray(r.namedFailures) ||
    !(r.armB === 'arm B not run' || (r.armB && Array.isArray(r.armB.rows)))) throw new Error('Invalid results data');
  const proportion = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1);
  const difference = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= -1 && v <= 1);
  const nonnegative = (v: unknown) => v == null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
  const ci = (v: unknown) => v == null || v === 'undefined' || (Array.isArray(v) && v.length === 2 &&
    v.every(x => typeof x === 'number' && Number.isFinite(x) && x >= -1 && x <= 1) && v[0] <= v[1]);
  if (r.rows.some(row => !row || typeof row.ordering !== 'string' ||
    (row.statusNote !== undefined && typeof row.statusNote !== 'string') ||
    ![row.recall10, row.recall20, row.recall30].every(proportion) || !difference(row.delta20) ||
    !ci(row.recall20CI) || !ci(row.delta20CI) || ![row.tier2ShareAll ?? null, row.tier2ShareClean ?? null].every(proportion) ||
    ![row.roots, row.defects, row.nearMissesFlagged, row.manualHunks, row.partialHunks, row.providerRequests, row.spentUsd].every(nonnegative)))
    throw new Error('Invalid result row values');
  if (r.namedFailures.some(f => !f || typeof f.id !== 'string' || !nonnegative(f.count)) ||
    r.perFamily.some(f => !f || typeof f.ordering !== 'string' || typeof f.family !== 'string' || !proportion(f.recall20) || !nonnegative(f.defects) || !ci(f.recall20CI)) ||
    r.wholeHunk.some(f => !f || typeof f.ordering !== 'string' || ![f.recall10, f.recall20, f.recall30].every(proportion)))
    throw new Error('Invalid result detail values');
  if (r.armB !== 'arm B not run' && (typeof r.armB.status !== 'string' || r.armB.rows.some(row => !row ||
    typeof row.ordering !== 'string' || typeof row.status !== 'string' ||
    ![row.localizationHits, row.duplicates, row.unmatched, row.providerRequests, row.spentUsd].every(nonnegative))))
    throw new Error('Invalid localization rows');
  if (Object.values(r.header).some(v => v !== null && typeof v !== 'string')) throw new Error('Invalid result header');
  if (r.state === 'measured' && (!/^[a-f0-9]{64}$/.test(r.header.corpusCommitment ?? '') ||
    !/^[a-f0-9]{64}$/.test(r.header.policyHash ?? '') || !/^[a-f0-9]{64}$/.test(r.header.preregistrationHash ?? '') ||
    !/^[a-f0-9]{40}$/.test(r.header.implementationCommit ?? '') || !r.header.attemptId)) throw new Error('Measured results require provenance');
  if (r.rows.some(row => !['not run', 'not captured', 'invalid capture', 'measured', 'mock: not measurement'].includes(row.status)))
    throw new Error('Invalid result status');
  if (r.rows.some(row => row.status === 'mock: not measurement')) throw new Error('Mock cannot enter the Arm A results table');
  if (r.state === 'not-yet-measured' && (r.rows.some(row => !['not run', 'not captured'].includes(row.status) ||
    [row.recall10, row.recall20, row.recall30, row.delta20].some(v => v !== null)) || r.perFamily.length || r.wholeHunk.length ||
    r.armB !== 'arm B not run')) throw new Error('Unmeasured state contains result values');
  return r;
}
