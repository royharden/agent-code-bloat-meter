import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256Hex } from '../core/hash';
export interface AttemptRecord {
  schema: 's45.attempt/1'; attemptId: string; preregHash: string; commitmentHash: string;
  implementationCommit: string; state: 'reserved' | 'predictions-recorded' | 'labels-released' | 'completed' | 'aborted';
  predictionsPath: string | null; predictionsHash: string | null; startedAt: string;
  finalReportPath?: string | null; finalReportHash?: string | null;
}
export type AttemptBinding = Pick<AttemptRecord, 'attemptId' | 'preregHash' | 'commitmentHash' | 'implementationCommit'>;
function syncAndClose(fd: number, text: string): void {
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
}
function exclusiveWrite(path: string, text: string): void {
  syncAndClose(openSync(path, 'wx', 0o600), text);
}
class FinalReportPersistenceError extends Error {}
export function beginAttempt(path: string, binding: Pick<AttemptRecord, 'attemptId' | 'preregHash' | 'commitmentHash' | 'implementationCommit'>): AttemptRecord {
  const record: AttemptRecord = { schema: 's45.attempt/1', ...binding, state: 'reserved', predictionsPath: null, predictionsHash: null, startedAt: new Date().toISOString() };
  // One fixed record per held-out edition; a different attempt id cannot bypass this lock.
  exclusiveWrite(path, JSON.stringify(record, null, 2) + '\n');
  return record;
}
export function recordPredictions(path: string, record: AttemptRecord, predictionsPath: string, predictions: unknown): AttemptRecord {
  if (record.state !== 'reserved') throw new Error('Predictions already recorded');
  const bytes = JSON.stringify(predictions, null, 2) + '\n';
  exclusiveWrite(predictionsPath, bytes);
  const next: AttemptRecord = { ...record, state: 'predictions-recorded', predictionsPath, predictionsHash: sha256Hex(bytes) };
  persistAttempt(path, next);
  return next;
}
export function persistAttempt(path: string, record: AttemptRecord): void {
  const prior = JSON.parse(readFileSync(path, 'utf8')) as AttemptRecord;
  if (prior.attemptId !== record.attemptId || prior.preregHash !== record.preregHash || prior.commitmentHash !== record.commitmentHash || prior.implementationCommit !== record.implementationCommit) throw new Error('Attempt binding changed');
  if ((prior.predictionsHash && (prior.predictionsHash !== record.predictionsHash || prior.predictionsPath !== record.predictionsPath)) ||
    (prior.finalReportHash && (prior.finalReportHash !== record.finalReportHash || prior.finalReportPath !== record.finalReportPath))) throw new Error('Attempt artifact identity changed');
  if ((prior.state === 'completed' && record.state !== 'completed') || (prior.finalReportHash && record.state === 'aborted')) throw new Error('Final report cannot be discarded');
  if (record.state === 'completed') {
    if (!record.finalReportPath || !record.finalReportHash) throw new Error('Completion requires a durable final report');
    const text = readFileSync(record.finalReportPath, 'utf8');
    if (sha256Hex(text) !== record.finalReportHash) throw new Error('Completion report hash mismatch');
    verifyReport(text, record);
  }
  // Never truncate the sole custody record: a crash leaves either complete old or complete new bytes.
  const temporary = `${path}.${randomUUID()}.tmp`;
  const bytes = JSON.stringify(record, null, 2) + '\n';
  // Open outside the cleanup region: EEXIST must never remove an inode we did not create.
  const fd = openSync(temporary, 'wx', 0o600);
  try { syncAndClose(fd, bytes); renameSync(temporary, path); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
/** Report I/O can retry before intent; all earlier scoring/integrity failures still spend the attempt. */
export function recordAttemptFailure(path: string, error: unknown): void {
  const latest = JSON.parse(readFileSync(path, 'utf8')) as AttemptRecord;
  if (latest.finalReportHash || latest.state === 'completed' ||
    (error instanceof FinalReportPersistenceError && latest.state === 'labels-released')) return;
  persistAttempt(path, { ...latest, state: 'aborted' });
}
export function releaseLabels(path: string, record: AttemptRecord): AttemptRecord {
  if (record.state !== 'predictions-recorded' || !record.predictionsPath || !record.predictionsHash || sha256Hex(readFileSync(record.predictionsPath)) !== record.predictionsHash) throw new Error('Predictions must be durably recorded before labels');
  const next: AttemptRecord = { ...record, state: 'labels-released' }; persistAttempt(path, next); return next;
}
/** Resume only the very same binding and prediction bytes; never recompute after label release. */
export function resumeAttempt(path: string, binding: AttemptBinding): AttemptRecord {
  const record = JSON.parse(readFileSync(path, 'utf8')) as AttemptRecord;
  if (Object.entries(binding).some(([key, value]) => record[key as keyof AttemptRecord] !== value)) throw new Error('Held-out spent: attempt binding mismatch');
  if (record.finalReportHash || record.finalReportPath || record.state === 'completed') throw new Error('Final report exists: use --recover-report; never recompute it');
  if (record.state === 'aborted' || !record.predictionsPath || !record.predictionsHash || sha256Hex(readFileSync(record.predictionsPath)) !== record.predictionsHash) throw new Error('Not an identical-hash continuation');
  return record;
}

/** Atomic, exclusive publication. An identical existing export is an idempotent success. */
export function writeImmutableArtifact(path: string, text: string): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    syncAndClose(fd, text);
    try { linkSync(temporary, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || readFileSync(path, 'utf8') !== text) throw error;
    }
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
function verifyReport(text: string, record: AttemptRecord): unknown {
  const report = JSON.parse(text) as { schema?: string; state?: string; header?: Record<string, unknown> };
  const header = report.header;
  if (report.schema !== 's45.results/1' || report.state !== 'measured' || !header ||
    header.attemptId !== record.attemptId || header.preregistrationHash !== record.preregHash ||
    header.corpusCommitment !== record.commitmentHash || header.implementationCommit !== record.implementationCommit) throw new Error('Final report binding mismatch');
  return report;
}
/** Stage and sync complete bytes BEFORE committing their identity; then use recovery only. */
export function recordFinalReport(path: string, record: AttemptRecord, reportPath: string, report: unknown): AttemptRecord {
  if (record.state !== 'labels-released' || !record.predictionsPath || !record.predictionsHash ||
    sha256Hex(readFileSync(record.predictionsPath)) !== record.predictionsHash) throw new Error('Final report requires recorded predictions and released labels');
  if (resolve(reportPath) !== resolve(path, '../heldout.report.json')) throw new Error('Final report must use the fixed custody path');
  const text = JSON.stringify(report, null, 2) + '\n';
  verifyReport(text, record);
  const next: AttemptRecord = { ...record, finalReportPath: reportPath, finalReportHash: sha256Hex(text) };
  try {
    // Only a fully written, synced temporary inode can become .pending. Interrupted private
    // temporary files are never read on retry, and an identical existing stage is accepted.
    const staged = `${reportPath}.pending`;
    writeImmutableArtifact(staged, text);
    const fd = openSync(staged, 'r+');
    try {
      if (readFileSync(fd, 'utf8') !== text) throw new Error('Staged final report bytes changed');
      // Also sync an identical orphan stage: its previous writer may have stopped before fsync.
      fsyncSync(fd);
    } finally { closeSync(fd); }
    persistAttempt(path, next);
    return recoverFinalReport(path, { attemptId: next.attemptId, preregHash: next.preregHash,
      commitmentHash: next.commitmentHash, implementationCommit: next.implementationCommit }).record;
  }
  catch (error) {
    // Limit the retry exception to filesystem failures in finalization. Report validation,
    // changed predictions and attempt-binding errors retain the normal abort behavior.
    if (error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string') {
      throw new FinalReportPersistenceError(`Final report persistence failed: ${error.message}`);
    }
    throw error;
  }
}
/** Recovery reads only custody artifacts. It never reloads a corpus, labels, diagnostics or evaluation. */
export function recoverFinalReport(path: string, binding: AttemptBinding): { record: AttemptRecord; text: string } {
  const record = JSON.parse(readFileSync(path, 'utf8')) as AttemptRecord;
  if (Object.entries(binding).some(([key, value]) => record[key as keyof AttemptRecord] !== value)) throw new Error('Held-out spent: attempt binding mismatch');
  if ((record.state !== 'completed' && record.state !== 'labels-released') || !record.finalReportPath || !record.finalReportHash ||
    resolve(record.finalReportPath) !== resolve(path, '../heldout.report.json') || !record.predictionsPath || !record.predictionsHash ||
    sha256Hex(readFileSync(record.predictionsPath)) !== record.predictionsHash) throw new Error('No recoverable run-bound final report');
  const reportPath = record.finalReportPath, published = existsSync(reportPath);
  const text = readFileSync(published ? reportPath : `${reportPath}.pending`, 'utf8');
  if (sha256Hex(text) !== record.finalReportHash) throw new Error('Final report hash mismatch');
  verifyReport(text, record);
  // Publish a fully written immutable inode; neither canonical nor exported paths expose partial writes.
  if (!published) writeImmutableArtifact(reportPath, text);
  if (record.state === 'completed') return { record, text };
  const completed: AttemptRecord = { ...record, state: 'completed' };
  persistAttempt(path, completed);
  return { record: completed, text };
}
