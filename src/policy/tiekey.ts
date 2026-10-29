import { sha256Hex } from '../core/hash';
export function tieKey(changeId: string, hunkId: string): string {
  return sha256Hex(`s45-tie-v1|${changeId}|${hunkId}`);
}
export function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
