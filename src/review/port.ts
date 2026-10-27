import type { Atom, ChangeV1 } from '../core/types';

export interface ReviewerRequest {
  changeHash: string;
  files: ChangeV1['files'];
  selectedAtoms: Atom[];
  model: string;
  maxOutputTokens: number;
}
export interface ReviewComment { path: string; side: 'base' | 'head'; startLine: number; endLine: number; defectKind?: string }
export interface ReviewerResponse {
  comments: ReviewComment[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  status: 'mock: not measurement' | 'completed' | 'failed';
}
export interface ReviewerPort {
  readonly mode: 'mock' | 'live';
  review(request: ReviewerRequest): Promise<ReviewerResponse>;
}
/** Whitelist at the runtime boundary as well as the type boundary. Extra input metadata is never rendered. */
export function renderRequest(request: ReviewerRequest): string {
  return JSON.stringify({ changeHash: request.changeHash,
    files: request.files.map(f => ({ path: f.path, base: f.base, head: f.head })),
    selectedAtoms: request.selectedAtoms.map(a => ({ path: a.path, side: a.side, line: a.line })),
    model: request.model, maxOutputTokens: request.maxOutputTokens });
}
