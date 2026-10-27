import { mulberry32, randomIndex } from './prng';
import type { Interval } from './wilson';
export interface RootCount { rootId: string; defects: number; exposed: number; comparatorExposed: number }
export function quantile7(sorted: readonly number[], p: number): number {
  if (sorted.length === 0 || p < 0 || p > 1) throw new Error('Undefined quantile');
  const h = (sorted.length - 1) * p, i = Math.floor(h);
  return sorted[i]! + (h - i) * ((sorted[Math.min(i + 1, sorted.length - 1)]!) - sorted[i]!);
}
export function percentileInterval(draws: readonly (number | null)[]): Interval | null {
  const defined = draws.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (draws.length === 0 || defined.length === 0 || (draws.length - defined.length) / draws.length > 0.1) return null;
  const low = quantile7(defined, .025), high = quantile7(defined, .975);
  return { low, high, halfWidth: (high - low) / 2 };
}
/** Identical root draws for recall and the paired difference; keeps draw multiplicity. */
export function rootBootstrap(roots: readonly RootCount[], resamples = 10000, seed = 45) {
  if (roots.length === 0 || resamples < 1 || !Number.isInteger(resamples)) throw new Error('Invalid bootstrap population');
  const next = mulberry32(seed), recall: (number | null)[] = [], difference: (number | null)[] = [];
  for (let b = 0; b < resamples; b++) {
    let defects = 0, exposed = 0, comparator = 0;
    for (let r = 0; r < roots.length; r++) {
      const row = roots[randomIndex(next, roots.length)]!;
      defects += row.defects; exposed += row.exposed; comparator += row.comparatorExposed;
    }
    recall.push(defects ? exposed / defects : null);
    difference.push(defects ? (exposed - comparator) / defects : null);
  }
  return { recall: percentileInterval(recall), difference: percentileInterval(difference), undefinedDraws: recall.filter(x => x === null).length, resamples };
}
