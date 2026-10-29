import { createHash } from 'node:crypto';
import type { AnalysisV1, Hunk } from '../core/types';
import { compareText, tieKey } from '../policy/tiekey';

export interface BaselineReceipt {
  schema: 's45.baseline-receipt/1'; tool: 'fallow' | 'jscpd'; version: string;
  changeHash: string; baseSourceHash: string; headSourceHash: string;
  baseOutputHash: string; headOutputHash: string; mappingHash: string;
  command: string[]; exitCodes: [number, number]; recordedAt: string;
  probe: { passed: true; receiptHash: string }; mappingLockedOn: 'dev';
}
export interface BaselineContext {
  analysis: AnalysisV1; baseSourceHash: string; headSourceHash: string;
  /** Raw tool path -> exact ChangeV1 path. Mapping must have been locked on dev. */
  mapping: Record<string, string>;
}
export interface BaselineOrdering { status: 'not captured' | 'invalid capture' | 'captured'; note: string; hunks: Hunk[] }
export function baselineHash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function mappingHash(mapping: Record<string, string>): string {
  return baselineHash(JSON.stringify(Object.fromEntries(Object.entries(mapping).sort(([a], [b]) => compareText(a, b)))));
}
export function mappedPath(mapping: Record<string, string>, raw: unknown): string {
  if (typeof raw !== 'string' || !Object.hasOwn(mapping, raw) || typeof mapping[raw] !== 'string')
    throw new Error('Unmapped external path');
  return mapping[raw];
}
export function sourceTreeHash(analysis: AnalysisV1, side: 'base' | 'head'): string {
  return baselineHash(JSON.stringify(analysis.files.filter(f => side === 'base' ? f.baseSha256 !== null : f.headSha256 !== null)
    .map(f => ({ path: f.path, sha256: side === 'base' ? f.baseSha256 : f.headSha256 })).sort((a, b) => compareText(a.path, b.path))));
}
export function validateBaselineReceipt(tool: BaselineReceipt['tool'], receipt: BaselineReceipt, base: string, head: string, context: BaselineContext): void {
  const hashes = [receipt.changeHash, receipt.baseSourceHash, receipt.headSourceHash, receipt.baseOutputHash,
    receipt.headOutputHash, receipt.mappingHash, receipt.probe?.receiptHash];
  if (receipt.schema !== 's45.baseline-receipt/1' || receipt.tool !== tool ||
    receipt.version !== (tool === 'jscpd' ? '4.3.0' : '3.36.0') || hashes.some(h => !/^[a-f0-9]{64}$/.test(h ?? '')) ||
    receipt.changeHash !== context.analysis.inputHashes.change || receipt.baseSourceHash !== context.baseSourceHash ||
    receipt.headSourceHash !== context.headSourceHash || context.baseSourceHash !== sourceTreeHash(context.analysis, 'base') ||
    context.headSourceHash !== sourceTreeHash(context.analysis, 'head') || receipt.baseOutputHash !== baselineHash(base) ||
    receipt.headOutputHash !== baselineHash(head) || receipt.mappingHash !== mappingHash(context.mapping) ||
    !receipt.probe?.passed || receipt.mappingLockedOn !== 'dev' || !Array.isArray(receipt.command) || !receipt.command.length ||
    receipt.command.some(s => typeof s !== 'string' || !s.length) || !Array.isArray(receipt.exitCodes) ||
    receipt.exitCodes.length !== 2 || receipt.exitCodes.some(n => n !== 0) || !Number.isFinite(Date.parse(receipt.recordedAt)))
    throw new Error('Invalid capture receipt, source binding, probe, or dev-locked mapping');
  const paths = new Set(context.analysis.files.map(f => f.path));
  if (Object.values(context.mapping).some(p => !paths.has(p))) throw new Error('Mapping points outside analysed files');
}
export function orderByBaselineCounts(context: BaselineContext, counts: Map<string, number>): Hunk[] {
  return [...context.analysis.hunks].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) ||
    compareText(tieKey(context.analysis.changeId, a.id), tieKey(context.analysis.changeId, b.id)) || compareText(a.id, b.id));
}
interface Finding { rule: string; path: string; line: number; end: number; identity: string }
function findings(raw: string, mapping: Record<string, string>): Finding[] {
  const doc = JSON.parse(raw);
  if (doc.version !== '2.1.0' || !Array.isArray(doc.runs)) throw new Error('Expected SARIF 2.1.0 runs');
  const items: Finding[] = [];
  for (const run of doc.runs) {
    if (!run.tool?.driver?.name?.toLowerCase().includes('fallow') || !Array.isArray(run.results)) throw new Error('Unsupported SARIF tool or results');
    for (const r of run.results) {
      if (typeof r.ruleId !== 'string' || !Array.isArray(r.locations) || r.locations.length !== 1) throw new Error('Unmappable SARIF finding');
      const p = r.locations[0]?.physicalLocation; const path = mappedPath(mapping, p?.artifactLocation?.uri);
      const line = p?.region?.startLine; const end = p?.region?.endLine ?? line;
      if (!path || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(end) || end < line) throw new Error('Unmapped SARIF path or region');
      // Stable tool fingerprint is required: line-number subtraction would misclassify shifted pre-existing findings.
      const fingerprints = r.partialFingerprints ?? r.fingerprints;
      if (!fingerprints || typeof fingerprints !== 'object' || !Object.keys(fingerprints).length ||
          Object.values(fingerprints).some(v => typeof v !== 'string')) throw new Error('Stable SARIF fingerprint required by dev mapping');
      const fp = JSON.stringify(Object.fromEntries(Object.entries(fingerprints).sort(([a], [b]) => compareText(a, b))));
      items.push({ rule: r.ruleId, path, line, end, identity: `${path}|${r.ruleId}|${fp}` });
    }
  }
  return items;
}
export function sarifOrdering(context: BaselineContext, capture?: { base: string; head: string; receipt: BaselineReceipt }): BaselineOrdering {
  if (!capture) return { status: 'not captured', note: 'Normal-mode probe and capture pending', hunks: [] };
  try {
    validateBaselineReceipt('fallow', capture.receipt, capture.base, capture.head, context);
    const base = findings(capture.base, context.mapping); const head = findings(capture.head, context.mapping);
    const remaining = new Map<string, number>(); base.forEach(f => remaining.set(f.identity, (remaining.get(f.identity) ?? 0) + 1));
    const introduced = head.filter(f => { const n = remaining.get(f.identity) ?? 0; if (n) { remaining.set(f.identity, n - 1); return false; } return true; });
    const counts = new Map(context.analysis.hunks.map(h => [h.id, introduced.filter(f => f.path === h.path &&
      h.atoms.some(a => a.side === 'head' && a.line >= f.line && a.line <= f.end)).length]));
    return { status: 'captured', note: 'Introduced findings; capture is not a measured study result', hunks: orderByBaselineCounts(context, counts) };
  } catch (error) { return { status: 'invalid capture', note: error instanceof Error ? error.message : 'Invalid SARIF', hunks: [] }; }
}
