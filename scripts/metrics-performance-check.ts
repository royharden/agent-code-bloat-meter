// Normal mode ONLY. Bounded in-memory ENGINEERING inputs, never study data, source evaluation or a benchmark claim.
// Command: node --import tsx scripts/metrics-performance-check.ts
// Parent watchdog bounds the whole worker to D25's 15 min; worker checks OS peak RSS against 2 GiB. Heap is capped
// at 1536 MiB to leave non-heap room. Any timeout, signal, OOM, status/shape mismatch or ceiling breach fails.
// These cap-shaped examples and repetitive stress cases cannot establish a universal worst-case complexity bound.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { LIMITS } from '../src/core/safety';
import type { ChangeV1 } from '../src/core/types';
import { findClonePairs } from '../src/diffmetrics/clones';
import { analyze } from '../src/diffmetrics/index';

const MAX_MS = 15 * 60 * 1000;
const MAX_RSS = 2 * 1024 ** 3;

function runWorker(): void {
  const start = performance.now();
  const rows: unknown[] = [];
  const measure = (name: string, action: () => unknown): void => {
    const before = performance.now();
    const result = action();
    const peakRss = process.resourceUsage().maxRSS * 1024; // Node reports KiB on supported platforms.
    const elapsedMs = performance.now() - start;
    assert.ok(peakRss <= MAX_RSS, `${name}: peak RSS ${peakRss} exceeds ${MAX_RSS}`);
    assert.ok(elapsedMs <= MAX_MS, `${name}: cumulative time ${elapsedMs} exceeds ${MAX_MS}`);
    const row = { name, durationMs: performance.now() - before, cumulativeMs: elapsedMs, peakRssBytes: peakRss, result };
    rows.push(row);
    console.log(JSON.stringify(row));
  };

  measure('200-files-8MiB-5000-added-atoms', () => {
    // Each file has exactly 25 head lines; comments supply bytes without exceeding the line or parser caps.
    // Total is exactly maxTotalBytes, each individual side remains below maxSideBytes.
    const count = LIMITS.maxFiles;
    const lines = LIMITS.maxChangedAtoms / count;
    assert.equal(lines, Math.floor(lines));
    let remaining = LIMITS.maxTotalBytes;
    const files = Array.from({ length: count }, (_, i) => {
      const bytes = Math.floor(remaining / (count - i));
      remaining -= bytes;
      const code = Array.from({ length: lines - 1 }, (_, j) => `const v${i}_${j} = ${i + j};`).join('\n');
      const padding = bytes - Buffer.byteLength(`/**/\n${code}\n`);
      const head = `/*${'x'.repeat(padding)}*/\n${code}\n`;
      assert.equal(Buffer.byteLength(head), bytes);
      assert.ok(bytes <= LIMITS.maxSideBytes);
      return { path: `engineering/f${i}.ts`, base: null, head };
    });
    const input: ChangeV1 = { schema: 's45.change/1', id: 'engineering-performance-caps', files };
    const output = analyze(input);
    assert.equal(output.status, 'ok');
    assert.equal(output.totals.atoms, LIMITS.maxChangedAtoms);
    return { status: output.status, files: files.length, bytes: LIMITS.maxTotalBytes, atoms: output.totals.atoms };
  });

  measure('two-256KiB-sides-5000-replacement-atoms', () => {
    const side = (declaration: string): string => {
      const count = LIMITS.maxChangedAtoms / 2;
      const lines = Array.from({ length: count }, (_, i) => `${declaration} v${i} = ${i};`);
      // Padding stays on the existing first line; every base line differs from its corresponding head line.
      const bytes = Buffer.byteLength(lines.join('\n') + '\n');
      lines[0] += ` /*${'x'.repeat(LIMITS.maxSideBytes - bytes - 5)}*/`;
      const text = lines.join('\n') + '\n';
      assert.equal(Buffer.byteLength(text), LIMITS.maxSideBytes);
      return text;
    };
    const output = analyze({ schema: 's45.change/1', id: 'engineering-performance-diff', files: [{ path: 'engineering/replacement.ts', base: side('const'), head: side('let') }] });
    assert.equal(output.status, 'ok');
    assert.equal(output.totals.atoms, LIMITS.maxChangedAtoms);
    return { status: output.status, atoms: output.totals.atoms, bytesPerSide: LIMITS.maxSideBytes };
  });

  measure('bounded-repetitive-clone-partner-stress', () => {
    const tokens = Array.from({ length: 256 }, (_, i) => ({ id: i % 40, startLine: i + 1, endLine: i + 1 }));
    const pairs = findClonePairs(['a.ts', 'b.ts', 'c.ts'].map((path) => ({ path, tokens })));
    assert.ok(pairs.length > 0);
    return { files: 3, tokensPerFile: tokens.length, pairs: pairs.length };
  });
  console.log(JSON.stringify({ check: 'engineering-performance-ceilings', status: 'pass', rows: rows.length, maxMs: MAX_MS, maxRssBytes: MAX_RSS, studyData: false }));
}

if (process.argv.length === 3 && process.argv[2] === '--worker') runWorker();
else if (process.argv.length === 2) {
  const child = spawn(process.execPath, ['--max-old-space-size=1536', '--import', 'tsx', fileURLToPath(import.meta.url), '--worker'], { stdio: 'inherit', shell: false, windowsHide: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, MAX_MS);
  child.on('error', (error) => { clearTimeout(timer); console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    if (timedOut || signal !== null || code !== 0) {
      console.error(JSON.stringify({ check: 'engineering-performance-ceilings', status: 'fail', timedOut, code, signal }));
      process.exitCode = 1;
    }
  });
} else throw new Error('usage: node --import tsx scripts/metrics-performance-check.ts');
