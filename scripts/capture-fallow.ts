/** NORMAL MODE ONLY. Operator supplies probe-confirmed argument templates; no guessed fallow CLI syntax. */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { analyze } from '../src/diffmetrics/index';
import { baselineHash, mappingHash, sourceTreeHash, sarifOrdering } from '../src/orderings/sarif';
import type { BaselineReceipt } from '../src/orderings/sarif';

interface CaptureConfig {
  inputPath: string; outputDir: string; executable: string; args: string[];
  mappingPath: string; probeReceiptPath: string;
}
export function captureFallow(config: CaptureConfig): string {
  if (process.env.S45_NORMAL_MODE !== '1') throw new Error('Normal mode and explicit operator execution required');
  if (!Array.isArray(config.args) || !config.args.includes('{root}') || !config.args.includes('{output}'))
    throw new Error('Probe-confirmed args must contain standalone {root} and {output} placeholders');
  const probeRaw = readFileSync(config.probeReceiptPath, 'utf8');
  const probe = JSON.parse(probeRaw);
  if (probe.tool !== 'fallow' || probe.version !== '3.36.0' || probe.passed !== true || probe.mappingLockedOn !== 'dev')
    throw new Error('A passing Normal-mode dev mapping probe for fallow 3.36.0 is required');
  const mapping = JSON.parse(readFileSync(config.mappingPath, 'utf8')) as Record<string, string>;
  if (probe.mappingHash !== mappingHash(mapping) || JSON.stringify(probe.args) !== JSON.stringify(config.args))
    throw new Error('Probe mapping or argument mismatch');
  const change = JSON.parse(readFileSync(config.inputPath, 'utf8'));
  const analysis = analyze(change); // Shape/path/size safety is checked before materialising any supplied path.
  if (analysis.status !== 'ok') throw new Error('Capture requires complete supported analysis');
  if (change.files.some((f: { path: string }) => f.path.toLowerCase().split('/').includes('.git')))
    throw new Error('Source cannot materialize git metadata');
  const temp = mkdtempSync(join(tmpdir(), 's45-fallow-'));
  const environment = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: temp,
    USERPROFILE: temp, TMP: temp, TEMP: temp, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(temp, 'no-config'),
    GIT_TERMINAL_PROMPT: '0' };
  const version = execFileSync(config.executable, ['--version'], { env: environment, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  if (!/\b3\.36\.0\b/.test(version)) throw new Error('Installed fallow version does not match candidate pin');
  const outputs: string[] = [];
  for (const side of ['base', 'head'] as const) {
    const root = join(temp, side); mkdirSync(root);
    for (const file of change.files as { path: string; base: string | null; head: string | null }[]) {
      if (file[side] === null) continue;
      const target = join(root, file.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, file[side]!, 'utf8');
    }
    execFileSync('git', ['-c', 'core.hooksPath=', 'init', '--quiet', root], { env: environment, timeout: 15000 });
    const output = join(temp, `${side}.sarif`);
    execFileSync(config.executable, config.args.map(a => a === '{root}' ? root : a === '{output}' ? output : a),
      { cwd: root, env: environment, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    outputs.push(readFileSync(output, 'utf8'));
  }
  const [base, head] = outputs as [string, string];
  const receipt: BaselineReceipt = { schema: 's45.baseline-receipt/1', tool: 'fallow', version: '3.36.0',
    changeHash: analysis.inputHashes.change, baseSourceHash: sourceTreeHash(analysis, 'base'), headSourceHash: sourceTreeHash(analysis, 'head'),
    baseOutputHash: baselineHash(base), headOutputHash: baselineHash(head), mappingHash: mappingHash(mapping),
    command: [config.executable, ...config.args], exitCodes: [0, 0], recordedAt: new Date().toISOString(),
    probe: { passed: true, receiptHash: baselineHash(probeRaw) }, mappingLockedOn: 'dev' };
  const checked = sarifOrdering({ analysis, mapping, baseSourceHash: receipt.baseSourceHash, headSourceHash: receipt.headSourceHash }, { base, head, receipt });
  if (checked.status !== 'captured') throw new Error(`Invalid capture: ${checked.note}. Temp preserved: ${temp}`);
  const out = resolve(config.outputDir); mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'base.sarif'), base, { flag: 'wx' }); writeFileSync(join(out, 'head.sarif'), head, { flag: 'wx' });
  writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
  return temp; // Retain disposable repositories for operator inspection; no recursive cleanup.
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = process.argv[2]; if (!path) throw new Error('Usage: tsx scripts/capture-fallow.ts <operator-config.json>');
  console.log(`Capture verified; disposable repositories: ${captureFallow(JSON.parse(readFileSync(path, 'utf8')))}`);
}
