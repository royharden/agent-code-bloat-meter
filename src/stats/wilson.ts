export interface Interval { low: number; high: number; halfWidth: number }
export function wilson95(successes: number, total: number): Interval | null {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || successes < 0 || successes > total) throw new Error('Invalid proportion');
  if (total === 0) return null;
  const z = 1.959963984540054, z2 = z * z, p = successes / total, d = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / d;
  const halfWidth = z * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total)) / d;
  return { low: Math.max(0, center - halfWidth), high: Math.min(1, center + halfWidth), halfWidth };
}
