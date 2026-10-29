// Source-only guard: README percentages must be declared protocol constants or backed by measured results.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const PROTOCOL_PERCENTAGES = new Set([10, 20, 30, 40, 25, 95]);

export function checkReadmeNumbers(readme: string, results: unknown = null): string[] {
  const errors: string[] = [];
  const measuredNumbers = new Set<number>();
  const r = results as { schema?: unknown; state?: unknown; rows?: unknown } | null;
  const measured = r?.schema === 's45.results/1' && r.state === 'measured' && Array.isArray(r.rows);
  function collect(value: unknown): void {
    if (typeof value === 'number' && Number.isFinite(value)) measuredNumbers.add(Number((value * 100).toFixed(4)));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  }
  if (measured) collect(r.rows);
  for (const line of readme.split('\n')) for (const match of line.matchAll(/\b(\d+(?:\.\d+)?)\s*%/g)) {
    const value = Number(match[1]);
    const protocolContext = /\b(?:budget|sensitivity|interval|threshold|guard|protocol)\b/i.test(line);
    if (!(protocolContext && PROTOCOL_PERCENTAGES.has(value)) && !measuredNumbers.has(value)) {
      errors.push(`Unsupported README percentage: ${match[0]}`);
    }
  }
  if (!measured && /\b(?:achieved|observed|measured recall|outperformed)\b/i.test(readme)) {
    errors.push('README claims a measured outcome without measured results.');
  }
  return errors;
}

function main(): void {
  const root = new URL('../', import.meta.url);
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  let results: unknown = null;
  try { results = JSON.parse(readFileSync(new URL('results/results.json', root), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const errors = checkReadmeNumbers(readme, results);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('README numeric claims have protocol or results backing.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
