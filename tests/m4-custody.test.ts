import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { beginAttempt, recordPredictions, releaseLabels, resumeAttempt } from '../src/heldout/attempt';
import { sha256Hex } from '../src/core/hash';
describe('engineering-only attempt state machine', () => {
  it('reserves exclusively, records prediction bytes before release, rejects drift on continuation', () => {
    const dir = mkdtempSync(join(tmpdir(), 's45-custody-engineering-'));
    try {
      const path = join(dir, 'attempt.json'), predictionsPath = join(dir, 'predictions.json');
      const binding = { attemptId: 'engineering-only', preregHash: 'a'.repeat(64), commitmentHash: 'b'.repeat(64), implementationCommit: 'c'.repeat(40) };
      const reserved = beginAttempt(path, binding);
      expect(() => beginAttempt(path, binding)).toThrow();
      expect(() => releaseLabels(path, reserved)).toThrow();
      const recorded = recordPredictions(path, reserved, predictionsPath, { engineering: true });
      expect(recorded.predictionsHash).toBe(sha256Hex(readFileSync(predictionsPath)));
      const released = releaseLabels(path, recorded);
      expect(released.state).toBe('labels-released');
      expect(resumeAttempt(path, binding).state).toBe('labels-released');
      expect(() => resumeAttempt(path, { ...binding, preregHash: 'd'.repeat(64) })).toThrow();
      writeFileSync(predictionsPath, 'changed');
      expect(() => resumeAttempt(path, binding)).toThrow();
    } finally {
      // Only the test-owned temporary engineering directory, never a study custody directory.
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
