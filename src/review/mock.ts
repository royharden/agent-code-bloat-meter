import type { ReviewerPort, ReviewerRequest, ReviewerResponse, ReviewComment } from './port';

/** Engineering plumbing only. No model inference and no evidence of discovery. */
export class MockReviewer implements ReviewerPort {
  readonly mode = 'mock' as const;
  private readonly comments: ReviewComment[];
  constructor(comments: ReviewComment[] = []) { this.comments = comments.map(c => ({ ...c })); }
  async review(_request: ReviewerRequest): Promise<ReviewerResponse> {
    return { comments: this.comments.map(c => ({ ...c })),
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, status: 'mock: not measurement' };
  }
}
/** A mock or unsuccessful response cannot be promoted into measured result rows. */
export function isMeasurement(response: ReviewerResponse): boolean { return response.status === 'completed'; }
