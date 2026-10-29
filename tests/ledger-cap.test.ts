import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewLedger } from '../src/review/ledger';
import { MockReviewer } from '../src/review/mock';
import type { ReviewerPort } from '../src/review/port';
const request = { changeHash: 'a'.repeat(64), files: [], selectedAtoms: [], model: 'engineering-stub', maxOutputTokens: 100 };
const path = () => join(mkdtempSync(join(tmpdir(), 's45-ledger-test-')), 'ledger.jsonl');
afterEach(() => vi.unstubAllEnvs());
describe('review budget ledger', () => {
  it('records refusal with cap zero before invoking even a live test stub', async () => {
    vi.stubEnv('S45_LIVE', '1'); let calls = 0;
    const port: ReviewerPort = { mode: 'live', async review() { calls++; throw new Error('must not dispatch'); } };
    const file = path(); const ledger = new ReviewLedger(file, { capUsd: 0, live: true, royApprovalId: 'engineering-only' });
    await expect(ledger.dispatch(port, request, 1)).rejects.toThrow('before dispatch');
    expect(calls).toBe(0); expect(JSON.parse(readFileSync(file, 'utf8').trim()).status).toBe('refused');
  });
  it('reserves the entire failed-attempt maximum before dispatch and refuses an over-cap retry', async () => {
    vi.stubEnv('S45_LIVE', '1'); const file = path(); let calls = 0;
    const ledger = new ReviewLedger(file, { capUsd: 2, live: true, royApprovalId: 'engineering-only' });
    const port: ReviewerPort = { mode: 'live', async review() {
      calls++; expect(ledger.rows().at(-1)?.status).toBe('reserved');
      expect(ledger.rows().at(-1)?.chargedUsd).toBe(2); throw new Error('engineering failure');
    } };
    await expect(ledger.dispatch(port, request, 2)).rejects.toThrow('engineering failure');
    expect(ledger.rows().at(-1)?.chargedUsd).toBe(2);
    await expect(ledger.dispatch(port, request, 1)).rejects.toThrow('before dispatch'); expect(calls).toBe(1);
  });
  it('requires environment enablement and approval independently of a positive cap', async () => {
    vi.stubEnv('S45_LIVE', '0'); const port: ReviewerPort = { mode: 'live', review: vi.fn() };
    await expect(new ReviewLedger(path(), { capUsd: 2, live: true, royApprovalId: 'engineering-only' }).dispatch(port, request, 1)).rejects.toThrow();
    vi.stubEnv('S45_LIVE', '1');
    await expect(new ReviewLedger(path(), { capUsd: 2, live: true }).dispatch(port, request, 1)).rejects.toThrow();
    expect(port.review).not.toHaveBeenCalled();
  });
  it('records mock dispatches with zero cost and a non-measurement terminal status', async () => {
    const ledger = new ReviewLedger(path()); await ledger.dispatch(new MockReviewer(), request, 0);
    expect(ledger.rows().at(-1)?.status).toBe('mock: not measurement'); expect(ledger.rows().at(-1)?.chargedUsd).toBe(0);
  });
});
