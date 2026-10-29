import { describe, expect, it } from 'vitest';
import { MockReviewer, isMeasurement } from '../src/review/mock';
import { parseResults } from '../src/viewer/data';
import { readFileSync } from 'node:fs';

describe('mock provenance', () => {
  it('marks mock responses as non-measurements regardless of comment count', async () => {
    const response = await new MockReviewer([{ path: 'x.ts', side: 'base', startLine: 1, endLine: 1 }])
      .review({ changeHash: 'a'.repeat(64), files: [], selectedAtoms: [], model: 'mock', maxOutputTokens: 100 });
    expect(response.status).toBe('mock: not measurement'); expect(response.usage.costUsd).toBe(0);
    expect(isMeasurement(response)).toBe(false);
  });
  it('keeps the checked-in results empty and rejects mock rows promoted into an unmeasured table', () => {
    const result = JSON.parse(readFileSync(new URL('../public/data/results.json', import.meta.url), 'utf8'));
    expect(parseResults(result).state).toBe('not-yet-measured');
    result.rows[0].status = 'mock: not measurement';
    expect(() => parseResults(result)).toThrow('Mock cannot enter');
  });
  it('rejects a measured table lacking attempt provenance', () => {
    const result = JSON.parse(readFileSync(new URL('../public/data/results.json', import.meta.url), 'utf8'));
    result.state = 'measured'; expect(() => parseResults(result)).toThrow('provenance');
  });
});
