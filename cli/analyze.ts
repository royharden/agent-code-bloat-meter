// plan 5 / 9 M3: `npm run analyze -- <change.json>` or
// `npm run analyze -- --git <repo> --base <ref> --head <ref> [--id <changeId>]`. Prints AnalysisV1 JSON to stdout.
// Exit codes: 0 analysed (any status: ok | incomplete | noop | unsupported), 1 usage or I/O error, 2 input rejected.
// Reads only the named input; writes only stdout/stderr; no network, no provider.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { analyze } from '../src/diffmetrics/index';
import { readGitChange } from '../src/core/git';
import { ChangeRejectedError, decodeUtf8Strict } from '../src/core/safety';

/** A ChangeV1 JSON file larger than this is refused before it is read (8 MiB of text plus JSON escaping). */
export const MAX_INPUT_FILE_BYTES = 32 * 1024 * 1024;

const USAGE = [
  'usage: analyze <change.json>',
  '       analyze --git <repo> --base <ref> --head <ref> [--id <changeId>]',
].join('\n');

export type CliArgs =
  | { mode: 'file'; path: string }
  | { mode: 'git'; repo: string; base: string; head: string; id?: string }
  | { mode: 'help' };

export function parseArgs(argv: readonly string[]): CliArgs {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { mode: 'help' };
  if (!argv.includes('--git')) {
    if (argv.length !== 1 || (argv[0] as string).startsWith('--')) throw new Error(USAGE);
    return { mode: 'file', path: argv[0] as string };
  }
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] as string;
    const value = argv[i + 1];
    if (!['--git', '--base', '--head', '--id'].includes(flag) || value === undefined || values.has(flag)) {
      throw new Error(USAGE);
    }
    values.set(flag, value);
  }
  const repo = values.get('--git');
  const base = values.get('--base');
  const head = values.get('--head');
  if (repo === undefined || base === undefined || head === undefined) throw new Error(USAGE);
  const id = values.get('--id');
  return id === undefined ? { mode: 'git', repo, base, head } : { mode: 'git', repo, base, head, id };
}

/** Reads a ChangeV1 JSON file with the size cap checked on the open descriptor before reading. */
export function readChangeFile(path: string): unknown {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size > MAX_INPUT_FILE_BYTES) throw new Error(`input file is ${size} bytes > ${MAX_INPUT_FILE_BYTES}`);
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const n = readSync(fd, bytes, offset, size - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    const decoded = decodeUtf8Strict(path, 'head', bytes.subarray(0, offset));
    if (!decoded.ok) throw new ChangeRejectedError('input file is not valid UTF-8 text', [decoded.issue]);
    return JSON.parse(decoded.text.replace(/^﻿/, '')) as unknown;
  } finally {
    closeSync(fd);
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
  if (args.mode === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  try {
    let analysis: ReturnType<typeof analyze>;
    if (args.mode === 'file') {
      analysis = analyze(readChangeFile(args.path) as Parameters<typeof analyze>[0]);
    } else {
      const git = await readGitChange(args.repo, args.base, args.head, args.id === undefined ? {} : { changeId: args.id });
      analysis = analyze(git.change, { externalIssues: git.issues });
    }
    process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof ChangeRejectedError) {
      process.stderr.write(`${JSON.stringify({ rejected: error.message, issues: error.issues }, null, 2)}\n`);
      return 2;
    }
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

// Run only when executed as the entry point, so tests can import parseArgs / readChangeFile.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
