// Later Normal-mode CLI boundary: the evaluator runs in a bounded subprocess, never the viewer.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.execPath, [
  '--max-old-space-size=2048', '--import', 'tsx',
  fileURLToPath(new URL('./eval.ts', import.meta.url)), ...process.argv.slice(2),
], { shell: false, timeout: 15 * 60 * 1000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', windowsHide: true });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) { console.error(`Evaluation boundary failed: ${result.error.message}`); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;
