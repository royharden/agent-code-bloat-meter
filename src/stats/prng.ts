import { createHash } from 'node:crypto';
/** mulberry32; output is an unsigned integer, not an implementation-dependent float. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
export function randomIndex(next: () => number, length: number): number {
  if (!Number.isSafeInteger(length) || length < 1) throw new Error('Empty random population');
  return Math.floor(next() / 0x100000000 * length);
}
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items], next = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomIndex(next, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
export function changeRandomSeed(seed: number, changeId: string): number {
  return createHash('sha256').update(`s45-rand|${seed}|${changeId}`).digest().readUInt32BE(0);
}
