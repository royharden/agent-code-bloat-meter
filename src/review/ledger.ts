import { appendFileSync, existsSync, readFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ReviewerPort, ReviewerRequest, ReviewerResponse } from './port';

export interface LedgerConfig { capUsd?: number; live?: boolean; royApprovalId?: string }
export interface LedgerRow {
  id: string; time: string; changeHash: string; mode: 'mock' | 'live';
  status: 'reserved' | 'refused' | 'failed' | 'completed' | 'mock: not measurement';
  reservedUsd: number; chargedUsd: number; approvalId: string | null; reason?: string;
}
/** Synchronous lock + append-before-dispatch. A crash leaves its full reservation charged conservatively. */
export class ReviewLedger {
  private readonly path: string;
  private readonly config: LedgerConfig;
  constructor(path: string, config: LedgerConfig = {}) { this.path = path; this.config = { ...config }; }
  rows(): LedgerRow[] {
    const rows = existsSync(this.path) ? readFileSync(this.path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as LedgerRow) : [];
    if (rows.some(r => !r || typeof r.id !== 'string' || !r.id || !['mock', 'live'].includes(r.mode) ||
      !['reserved', 'refused', 'failed', 'completed', 'mock: not measurement'].includes(r.status) ||
      !Number.isFinite(r.chargedUsd) || r.chargedUsd < 0 || !Number.isFinite(r.reservedUsd) || r.reservedUsd < 0 ||
      (r.mode === 'mock' && (r.chargedUsd !== 0 || r.reservedUsd !== 0)))) throw new Error('Corrupt ledger: refusing dispatch');
    return rows;
  }
  private append(row: LedgerRow): void { appendFileSync(this.path, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 }); }
  async dispatch(port: ReviewerPort, request: ReviewerRequest, maximumCostUsd: number): Promise<ReviewerResponse> {
    if (!Number.isFinite(maximumCostUsd) || maximumCostUsd < 0) throw new Error('Invalid maximum cost');
    const cap = this.config.capUsd ?? 0;
    if (!Number.isFinite(cap) || cap < 0 || cap > 40) throw new Error('Invalid cap (ceiling is not approval)');
    mkdirSync(dirname(this.path), { recursive: true });
    const lock = `${this.path}.lock`;
    const fd = openSync(lock, 'wx');
    const id = randomUUID();
    const row = (status: LedgerRow['status'], chargedUsd: number, reason?: string): LedgerRow => ({ id,
      time: new Date().toISOString(), changeHash: request.changeHash, mode: port.mode, status,
      reservedUsd: port.mode === 'live' ? maximumCostUsd : 0, chargedUsd,
      approvalId: this.config.royApprovalId ?? null, ...(reason ? { reason } : {}) });
    try {
      const latest = new Map(this.rows().map(r => [r.id, r]));
      const spent = [...latest.values()].reduce((n, r) => n + r.chargedUsd, 0);
      if (port.mode === 'live' && (cap === 0 || process.env.S45_LIVE !== '1' || !this.config.live || !this.config.royApprovalId?.trim() ||
          maximumCostUsd === 0 || spent + maximumCostUsd > cap)) {
        this.append(row('refused', 0, 'Live disabled, missing approval, zero cap, or reservation exceeds cap'));
        throw new Error('Live review refused before dispatch');
      }
      this.append(row('reserved', port.mode === 'live' ? maximumCostUsd : 0));
    } finally { closeSync(fd); unlinkSync(lock); }
    try {
      const response = await port.review(request);
      if (!Number.isFinite(response.usage.costUsd) || response.usage.costUsd < 0 ||
          (port.mode === 'live' && response.usage.costUsd > maximumCostUsd)) throw new Error('Usage exceeds reserved maximum');
      if (port.mode === 'mock' && (response.status !== 'mock: not measurement' || response.usage.costUsd !== 0))
        throw new Error('Mock attempted measured status or paid usage');
      // Failed attempts retain maximum reservation; a mock never becomes a measurement.
      this.append(row(port.mode === 'mock' ? 'mock: not measurement' : response.status === 'completed' ? 'completed' : 'failed',
        port.mode === 'mock' ? 0 : response.status === 'completed' ? response.usage.costUsd : maximumCostUsd));
      return response;
    } catch (error) {
      this.append(row('failed', port.mode === 'live' ? maximumCostUsd : 0, error instanceof Error ? error.message : 'Review failed'));
      throw error;
    }
  }
}
