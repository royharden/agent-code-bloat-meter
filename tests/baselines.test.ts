import { describe, expect, it } from 'vitest';
import { analyze } from '../src/diffmetrics';
import { jscpdOrdering } from '../src/orderings/jscpd';
import { baselineHash, mappingHash, sarifOrdering, sourceTreeHash } from '../src/orderings/sarif';
import type { BaselineContext, BaselineReceipt } from '../src/orderings/sarif';
const analysis = analyze({ schema: 's45.change/1', id: 'engineering-baseline', files: [{ path: 'a.ts', base: 'const x = 1;\n', head: 'const x = 2;\n' }] });
const context: BaselineContext = { analysis, mapping: { 'a.ts': 'a.ts' }, baseSourceHash: sourceTreeHash(analysis, 'base'), headSourceHash: sourceTreeHash(analysis, 'head') };
function receipt(tool: 'fallow' | 'jscpd', base: string, head: string): BaselineReceipt {
  return { schema: 's45.baseline-receipt/1', tool, version: tool === 'fallow' ? '3.36.0' : '4.3.0',
    changeHash: analysis.inputHashes.change, baseSourceHash: context.baseSourceHash, headSourceHash: context.headSourceHash,
    baseOutputHash: baselineHash(base), headOutputHash: baselineHash(head), mappingHash: mappingHash(context.mapping),
    command: [tool, 'engineering-probe-only'], exitCodes: [0, 0], recordedAt: '2026-10-27T00:00:00Z',
    probe: { passed: true, receiptHash: 'a'.repeat(64) }, mappingLockedOn: 'dev' };
}
describe('external baseline capture boundaries (synthetic engineering outputs)', () => {
  it('leaves missing tools uncaptured rather than inventing zero findings', () => {
    expect(sarifOrdering(context).status).toBe('not captured'); expect(jscpdOrdering(context).hunks).toEqual([]);
  });
  it('refuses a raw-output hash mismatch or source-tree mismatch', () => {
    const raw = JSON.stringify({ duplicates: [] }); const r = receipt('jscpd', raw, raw);
    expect(jscpdOrdering(context, { base: raw, head: raw + ' ', receipt: r }).status).toBe('invalid capture');
    expect(jscpdOrdering({ ...context, headSourceHash: 'b'.repeat(64) }, { base: raw, head: raw, receipt: r }).status).toBe('invalid capture');
  });
  it('requires every external location to use the locked mapping', () => {
    const raw = JSON.stringify({ duplicates: [{ firstFile: { name: 'missing.ts', start: 1, end: 1 }, secondFile: { name: 'a.ts', start: 1, end: 1 } }] });
    expect(jscpdOrdering(context, { base: raw, head: raw, receipt: receipt('jscpd', raw, raw) }).status).toBe('invalid capture');
  });
  it('does not treat unchanged stable fingerprints as introduced findings', () => {
    const result = (line: number) => ({ ruleId: 'engineering-rule', partialFingerprints: { stable: 'same' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.ts' }, region: { startLine: line } } }] });
    const sarif = (line: number) => JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'fallow' } }, results: [result(line)] }] });
    const base = sarif(10), head = sarif(1);
    const ordered = sarifOrdering(context, { base, head, receipt: receipt('fallow', base, head) });
    expect(ordered.status).toBe('captured'); expect(ordered.hunks).toHaveLength(analysis.hunks.length);
  });
  it('refuses SARIF without stable fingerprint evidence', () => {
    const raw = JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'fallow' } }, results: [{ ruleId: 'x', locations: [{ physicalLocation: { artifactLocation: { uri: 'a.ts' }, region: { startLine: 1 } } }] }] }] });
    expect(sarifOrdering(context, { base: raw, head: raw, receipt: receipt('fallow', raw, raw) }).status).toBe('invalid capture');
  });
});
