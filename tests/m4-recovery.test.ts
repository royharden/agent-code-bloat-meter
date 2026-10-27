// Engineering-only recovery scaffolding. No study inputs, labels, diagnostics or measured values.
// Written in Dirty Mode; execute only after Normal-mode activation.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginAttempt, recordAttemptFailure, recordFinalReport, recordPredictions, recoverFinalReport, releaseLabels, resumeAttempt } from '../src/heldout/attempt';
import type { AttemptRecord } from '../src/heldout/attempt';
import { sha256Hex } from '../src/core/hash';
import { exportResults, recoverEvaluation } from '../scripts/eval';
import { OwnCorpusSource } from '../src/corpus/own-source';
import { analyze } from '../src/diffmetrics';
import { evaluatePredictions, makePredictions } from '../src/orderings/evaluate';
import { frozenPolicy, requireGate, verifyFreeze } from '../src/heldout/custody';

const faults = vi.hoisted(() => ({ linkTarget: '', renameAt: 0, renames: 0, stagePath: '',
  stageFailure: '' as '' | 'open' | 'write' | 'fsync' | 'pending-fsync' | 'collision',
  descriptors: new Map<number, string>(), partialBytes: 0, pendingSyncs: 0, collisionPath: '' }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const stageTemporary = (path: string) => !!faults.stagePath && path.startsWith(`${faults.stagePath}.`) && path.endsWith('.tmp');
  const failure = (message: string) => Object.assign(new Error(message), { code: 'EIO' });
  return { ...fs,
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      const path = String(args[0]);
      if (stageTemporary(path) && args[1] === 'wx') {
        if (faults.stageFailure === 'open') throw failure('engineering staging open failure');
        if (faults.stageFailure === 'collision') {
          fs.writeFileSync(path, 'preexisting unrelated temporary file'); faults.collisionPath = path;
        }
      }
      const fd = fs.openSync(...args); faults.descriptors.set(fd, path); return fd;
    },
    closeSync: (fd: number) => { try { return fs.closeSync(fd); } finally { faults.descriptors.delete(fd); } },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      const path = typeof args[0] === 'number' ? faults.descriptors.get(args[0]) ?? '' : String(args[0]);
      if (stageTemporary(path) && faults.stageFailure === 'write') {
        const partial = String(args[1]).slice(0, 13); fs.writeFileSync(args[0], partial);
        faults.partialBytes = partial.length; throw failure('engineering staging partial write failure');
      }
      return fs.writeFileSync(...args);
    },
    fsyncSync: (fd: number) => {
      const path = faults.descriptors.get(fd) ?? '';
      if (stageTemporary(path) && faults.stageFailure === 'fsync') throw failure('engineering staging fsync failure');
      if (path === faults.stagePath) {
        if (faults.stageFailure === 'pending-fsync') throw failure('engineering pending fsync failure');
        faults.pendingSyncs++;
      }
      return fs.fsyncSync(fd);
    },
    linkSync: (source: string, target: string) => {
      if (target === faults.linkTarget) throw failure('engineering publication failure');
      return fs.linkSync(source, target);
    },
    renameSync: (source: string, target: string) => {
      faults.renames++;
      if (faults.renames === faults.renameAt) throw failure('engineering completion failure');
      return fs.renameSync(source, target);
    },
  };
});
vi.mock('../src/corpus/own-source', () => ({ OwnCorpusSource: vi.fn(() => { throw new Error('Recovery must not construct a corpus source or reopen labels'); }) }));
vi.mock('../src/diffmetrics', () => ({ analyze: vi.fn(() => { throw new Error('Recovery must not analyze'); }) }));
vi.mock('../src/orderings/evaluate', () => ({
  makePredictions: vi.fn(() => { throw new Error('Recovery must not predict'); }),
  evaluatePredictions: vi.fn(() => { throw new Error('Recovery must not evaluate'); }),
}));
vi.mock('../src/heldout/custody', () => ({ requireGate: vi.fn(), verifyFreeze: vi.fn(), frozenPolicy: vi.fn(() => { throw new Error('Recovery must not reconstruct a policy'); }) }));

const directories: string[] = [];
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 's45-report-recovery-engineering-'));
  directories.push(dir);
  const root = join(dir, 'repo'), custodyDir = join(dir, 'sealed', 'custody');
  mkdirSync(root); mkdirSync(custodyDir, { recursive: true });
  const preregBytes = JSON.stringify({ hashes: { corpusCommitment: 'b'.repeat(64), implementationCommit: 'c'.repeat(40) } });
  writeFileSync(join(root, 'preregistration.json'), preregBytes);
  const binding = { attemptId: 'engineering-recovery-only', preregHash: sha256Hex(preregBytes), commitmentHash: 'b'.repeat(64), implementationCommit: 'c'.repeat(40) };
  const path = join(custodyDir, 'heldout.attempt.json'), reportPath = join(custodyDir, 'heldout.report.json');
  const recorded = recordPredictions(path, beginAttempt(path, binding), join(custodyDir, 'predictions.json'), []);
  const released = releaseLabels(path, recorded);
  const report = {
    schema: 's45.results/1' as const, state: 'measured' as const,
    header: { attemptId: binding.attemptId, preregistrationHash: binding.preregHash, corpusCommitment: binding.commitmentHash,
      implementationCommit: binding.implementationCommit, policyHash: 'd'.repeat(64), primarySizeComparator: 'size-asc' as const,
      verdict: 'undefined', precision: 'imprecise' },
    rows: [], perFamily: [], wholeHunk: [], armB: 'arm B not run', namedFailures: [],
    supplementary: { tierShares: { all: null, clean: null, twins: null, nearMiss: null,
      counts: { all: { atoms: 0, tier2: 0 }, clean: { atoms: 0, tier2: 0 }, twins: { atoms: 0, tier2: 0 }, nearMiss: { atoms: 0, tier2: 0 } },
      cleanFlagged: 0, cleanChanges: 0, cleanFlaggedInterval: null, traps: {}, nearMissesFlagged: 0, manualHunks: 0 }, endpoints: [],
      diagnostics: { operatorSession: 'engineering-only', evidenceHash: 'e'.repeat(64) },
      randomPartialHunkConvention: 'engineering-only' },
  } satisfies ReturnType<typeof recoverEvaluation>;
  return { root, custodyDir, path, reportPath, binding, released, report,
    options: { root, gate: join(dir, 'engineering-gate.json'), split: 'heldout' as const, attemptId: binding.attemptId, custodyDir } };
}
// Exercise the same failure handler called by evaluate(), without making a corpus or diagnostics fixture.
function finalize(t: ReturnType<typeof setup>) {
  try { return recordFinalReport(t.path, t.released, t.reportPath, t.report); }
  catch (error) { recordAttemptFailure(t.path, error); throw error; }
}
afterEach(() => {
  faults.linkTarget = ''; faults.renameAt = 0; faults.renames = 0; faults.stagePath = ''; faults.stageFailure = '';
  faults.descriptors.clear(); faults.partialBytes = 0; faults.pendingSyncs = 0; faults.collisionPath = ''; vi.clearAllMocks();
  // Only directories allocated by this engineering test, never real study custody.
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('M4-R1 immutable final report recovery (engineering only)', () => {
  it.each(['open', 'write', 'fsync', 'pending-fsync'] as const)('retains identical continuation after staging %s failure, before intent', failure => {
    const t = setup(); faults.stagePath = `${t.reportPath}.pending`; faults.stageFailure = failure;
    expect(() => finalize(t)).toThrow(/engineering (staging|pending)/);
    const saved = JSON.parse(readFileSync(t.path, 'utf8')) as AttemptRecord;
    expect(saved.state).toBe('labels-released');
    expect(saved.finalReportHash).toBeUndefined(); expect(saved.finalReportPath).toBeUndefined();
    expect(saved.predictionsHash).toBe(t.released.predictionsHash);
    expect(existsSync(t.reportPath)).toBe(false);
    expect(existsSync(faults.stagePath)).toBe(failure === 'pending-fsync');
    if (failure === 'write') expect(faults.partialBytes).toBeGreaterThan(0);
    expect(resumeAttempt(t.path, t.binding)).toEqual(saved);
    expect(() => resumeAttempt(t.path, { ...t.binding, attemptId: 'different' })).toThrow(/binding/);
    expect(() => recoverEvaluation(t.options)).toThrow(/recoverable/); // no committed identity yet
    faults.stageFailure = '';
    expect(finalize(t).state).toBe('completed');
    expect(faults.pendingSyncs).toBe(1);
    expect(recoverEvaluation(t.options)).toEqual(t.report);
    for (const blocked of [OwnCorpusSource, analyze, makePredictions, evaluatePredictions, frozenPolicy]) expect(blocked).not.toHaveBeenCalled();
  });

  it('retains a synced orphan stage when intent persistence fails and accepts its identical EEXIST retry', () => {
    const t = setup(); faults.stagePath = `${t.reportPath}.pending`; faults.renames = 0; faults.renameAt = 1;
    expect(() => finalize(t)).toThrow(/completion/);
    const text = JSON.stringify(t.report, null, 2) + '\n';
    expect(readFileSync(faults.stagePath, 'utf8')).toBe(text);
    expect(faults.pendingSyncs).toBe(1);
    expect(resumeAttempt(t.path, t.binding).state).toBe('labels-released');
    expect(JSON.parse(readFileSync(t.path, 'utf8')).finalReportHash).toBeUndefined();
    faults.renameAt = 0;
    expect(finalize(t).state).toBe('completed');
    expect(faults.pendingSyncs).toBe(2); // an existing matching inode is synced again before intent
    expect(readFileSync(t.reportPath, 'utf8')).toBe(text);
  });

  it.each(['partial', 'complete'] as const)('ignores an abandoned %s private stage without deleting it', kind => {
    const t = setup();
    const orphan = `${t.reportPath}.pending.interrupted.tmp`;
    const text = kind === 'partial' ? '{"schema":' : JSON.stringify(t.report, null, 2) + '\n';
    writeFileSync(orphan, text);
    expect(finalize(t).state).toBe('completed');
    expect(readFileSync(orphan, 'utf8')).toBe(text);
  });

  it('preserves a conflicting partial fixed stage and remains resumable until the conflict is moved aside', () => {
    const t = setup(), pending = `${t.reportPath}.pending`, preserved = `${pending}.operator-preserved`;
    writeFileSync(pending, 'preexisting partial stage');
    expect(() => finalize(t)).toThrow(); expect(() => finalize(t)).toThrow();
    expect(readFileSync(pending, 'utf8')).toBe('preexisting partial stage');
    expect(resumeAttempt(t.path, t.binding).state).toBe('labels-released');
    expect(existsSync(t.reportPath)).toBe(false);
    // Explicit engineering simulation of an operator preserving a conflict; product code never removes it.
    renameSync(pending, preserved);
    expect(finalize(t).state).toBe('completed');
    expect(readFileSync(preserved, 'utf8')).toBe('preexisting partial stage');
  });

  it('does not delete an EEXIST temporary file that its exclusive open did not create', () => {
    const t = setup(); faults.stagePath = `${t.reportPath}.pending`; faults.stageFailure = 'collision';
    expect(() => finalize(t)).toThrow();
    const collision = faults.collisionPath;
    expect(readFileSync(collision, 'utf8')).toBe('preexisting unrelated temporary file');
    expect(resumeAttempt(t.path, t.binding).state).toBe('labels-released');
    faults.stageFailure = '';
    expect(finalize(t).state).toBe('completed');
    expect(readFileSync(collision, 'utf8')).toBe('preexisting unrelated temporary file');
  });

  it.each(['predictions', 'binding', 'scoring'] as const)('still aborts a real %s integrity/scoring failure before final intent', kind => {
    const t = setup();
    if (kind === 'predictions') writeFileSync(t.released.predictionsPath!, 'changed engineering predictions');
    let error: unknown;
    try {
      if (kind === 'scoring') throw Object.assign(new Error('engineering scoring failure'), { code: 'EIO' });
      const report = kind === 'binding' ? { ...t.report, header: { ...t.report.header, attemptId: 'changed' } } : t.report;
      recordFinalReport(t.path, t.released, t.reportPath, report);
    } catch (caught) { error = caught; recordAttemptFailure(t.path, caught); }
    expect(error).toBeInstanceOf(Error);
    expect(JSON.parse(readFileSync(t.path, 'utf8')).state).toBe('aborted');
    expect(() => resumeAttempt(t.path, t.binding)).toThrow(/continuation/);
    expect(existsSync(`${t.reportPath}.pending`)).toBe(false);
  });

  it('pins a durable canonical report before completion and recovers without labels, analysis or evaluation', () => {
    const t = setup();
    const completed = recordFinalReport(t.path, t.released, t.reportPath, t.report);
    expect(completed.state).toBe('completed');
    expect(completed.finalReportPath).toBe(t.reportPath);
    expect(completed.finalReportHash).toBe(sha256Hex(readFileSync(t.reportPath)));
    expect(() => resumeAttempt(t.path, t.binding)).toThrow(/recover-report/);
    expect(() => beginAttempt(t.path, { ...t.binding, attemptId: 'different' })).toThrow();
    faults.linkTarget = t.reportPath; // completed recovery must be read-only, even when publication is unavailable
    expect(recoverEvaluation(t.options)).toEqual(t.report);
    expect(requireGate).toHaveBeenCalledOnce(); expect(verifyFreeze).toHaveBeenCalledOnce();
    for (const blocked of [OwnCorpusSource, analyze, makePredictions, evaluatePredictions, frozenPolicy]) expect(blocked).not.toHaveBeenCalled();
  });

  it('recovers a synced staging report if canonical publication fails, without repeating scoring', () => {
    const t = setup(); faults.linkTarget = t.reportPath;
    expect(() => recordFinalReport(t.path, t.released, t.reportPath, t.report)).toThrow(/publication/);
    const saved = JSON.parse(readFileSync(t.path, 'utf8')) as AttemptRecord;
    expect(saved.state).toBe('labels-released');
    expect(saved.finalReportHash).toBe(sha256Hex(readFileSync(`${t.reportPath}.pending`)));
    expect(existsSync(t.reportPath)).toBe(false);
    expect(() => resumeAttempt(t.path, t.binding)).toThrow(/recover-report/);
    faults.linkTarget = '';
    expect(recoverEvaluation(t.options)).toEqual(t.report);
    expect(JSON.parse(readFileSync(t.path, 'utf8')).state).toBe('completed');
    expect(OwnCorpusSource).not.toHaveBeenCalled(); expect(evaluatePredictions).not.toHaveBeenCalled();
  });

  it('recovers if completion persistence fails after the final report exists', () => {
    const t = setup(); faults.renames = 0; faults.renameAt = 2; // intent succeeds; completion rename fails
    expect(() => recordFinalReport(t.path, t.released, t.reportPath, t.report)).toThrow(/completion/);
    expect(existsSync(t.reportPath)).toBe(true);
    expect(JSON.parse(readFileSync(t.path, 'utf8')).state).toBe('labels-released');
    faults.renameAt = 0;
    expect(recoverFinalReport(t.path, t.binding).record.state).toBe('completed');
  });

  it('repairs the JSON-then-Markdown export boundary and permits repeated identical exports', () => {
    const t = setup(); recordFinalReport(t.path, t.released, t.reportPath, t.report);
    faults.linkTarget = join(t.root, 'results', 'results.md');
    expect(() => exportResults(t.root, t.report)).toThrow(/publication/);
    expect(existsSync(join(t.root, 'results', 'results.json'))).toBe(true);
    expect(existsSync(join(t.root, 'results', 'results.md'))).toBe(false);
    const canonical = readFileSync(t.reportPath, 'utf8');
    faults.linkTarget = '';
    exportResults(t.root, recoverEvaluation(t.options)); exportResults(t.root, recoverEvaluation(t.options));
    expect(readFileSync(join(t.root, 'results', 'results.json'), 'utf8')).toBe(canonical);
    expect(readFileSync(join(t.root, 'results', 'results.md'), 'utf8')).toContain('Defect exposure recall');
    expect(readFileSync(t.reportPath, 'utf8')).toBe(canonical);
    expect(OwnCorpusSource).not.toHaveBeenCalled(); expect(evaluatePredictions).not.toHaveBeenCalled();
  });

  it.each(['results.json', 'results.md'])('preserves a conflicting %s and still recovers the custody report', filename => {
    const t = setup(); recordFinalReport(t.path, t.released, t.reportPath, t.report);
    mkdirSync(join(t.root, 'results')); writeFileSync(join(t.root, 'results', filename), 'preexisting engineering conflict');
    expect(() => exportResults(t.root, t.report)).toThrow();
    expect(readFileSync(join(t.root, 'results', filename), 'utf8')).toBe('preexisting engineering conflict');
    expect(recoverEvaluation(t.options)).toEqual(t.report);
  });

  it('retains the canonical report if rendering fails', () => {
    const t = setup(); recordFinalReport(t.path, t.released, t.reportPath, t.report);
    const broken = { ...t.report, get rows(): typeof t.report.rows { throw new Error('engineering render failure'); } };
    expect(() => exportResults(t.root, broken)).toThrow(/render/);
    expect(existsSync(join(t.root, 'results', 'results.json'))).toBe(false);
    expect(recoverEvaluation(t.options)).toEqual(t.report);
  });

  it('rejects changed bindings, predictions, report bytes and label-reopening flags', () => {
    const t = setup(); recordFinalReport(t.path, t.released, t.reportPath, t.report);
    expect(() => recoverFinalReport(t.path, { ...t.binding, preregHash: 'f'.repeat(64) })).toThrow(/binding/);
    for (const extra of [{ resume: true }, { releaseDir: 'not-read' }, { diagnostics: 'not-read' }]) expect(() => recoverEvaluation({ ...t.options, ...extra })).toThrow(/combined/);
    writeFileSync(t.reportPath, 'changed engineering artifact');
    expect(() => recoverFinalReport(t.path, t.binding)).toThrow(/hash/);
    writeFileSync(t.reportPath, JSON.stringify(t.report, null, 2) + '\n');
    writeFileSync(join(t.custodyDir, 'predictions.json'), 'changed engineering predictions');
    expect(() => recoverFinalReport(t.path, t.binding)).toThrow(/recoverable/);
    expect(OwnCorpusSource).not.toHaveBeenCalled(); expect(evaluatePredictions).not.toHaveBeenCalled();
  });
});
