// plan 6.1 Git adapter: builds a ChangeV1 from two commits of a local repository without touching its working tree.
// Every git call is `execFile` with an argument array (no shell), env GIT_CONFIG_NOSYSTEM=1 / GIT_TERMINAL_PROMPT=0,
// and `-c core.hooksPath=/dev/null -c diff.external= -c core.fsmonitor=false`. Refs are resolved to full commit ids
// once; trees are listed with `ls-tree -r -z -l --full-tree`; blobs are read with `cat-file blob <oid>` only after
// the size caps pass. Never checkout, reset, worktree, textconv or external diff. Symlinks (120000) and submodules
// (160000) are rejected when they are changed or carry a `.ts` / `.tsx` path.
import { execFile } from 'node:child_process';
import { sourceKindOf } from './change';
import { ChangeRejectedError, decodeUtf8Strict, LIMITS, makeIssue } from './safety';
import type { ChangeV1, Issue } from './types';

/** Fixed config overrides passed before every git subcommand. */
export const GIT_CONFIG_ARGS: readonly string[] = Object.freeze([
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'diff.external=',
  '-c',
  'core.fsmonitor=false',
]);

/** Environment for every git call: the inherited environment plus the plan 6.1 overrides. */
export function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
}

export interface GitReadOptions {
  /** git executable (default `git`, resolved from PATH by execFile without a shell). */
  gitBinary?: string;
  /** Per-command timeout in milliseconds (default 30 s). */
  timeoutMs?: number;
  /** Change id for the ChangeV1 (default `git:<baseCommit>..<headCommit>`). */
  changeId?: string;
}

export interface GitChange {
  change: ChangeV1;
  /** Listing issues for files that were not read (pass to `analyze(change, { externalIssues })`). */
  issues: Issue[];
  baseCommit: string;
  headCommit: string;
  /** Blob ids per included path and side (null where the side is absent). */
  blobs: Record<string, { base: string | null; head: string | null }>;
}

/** A failed git invocation (non-zero exit, timeout, missing binary); carries no repository content. */
export class GitCommandError extends Error {
  readonly args: readonly string[];

  constructor(message: string, args: readonly string[]) {
    super(message);
    this.name = 'GitCommandError';
    this.args = args;
  }
}

function runGit(repo: string, args: readonly string[], options: GitReadOptions, maxBuffer: number): Promise<Buffer> {
  const fullArgs = [...GIT_CONFIG_ARGS, '-C', repo, ...args];
  return new Promise((resolve, reject) => {
    execFile(
      options.gitBinary ?? 'git',
      fullArgs,
      {
        encoding: 'buffer',
        env: gitEnv(),
        maxBuffer,
        timeout: options.timeoutMs ?? 30_000,
        windowsHide: true,
        shell: false,
      },
      (error, stdout) => {
        if (error) reject(new GitCommandError(`git ${args[0] ?? ''} failed: ${error.message}`, fullArgs));
        else resolve(stdout);
      },
    );
  });
}

/** A ref must be non-empty, must not look like an option, and must not contain NUL or line breaks. */
export function checkRef(ref: string): void {
  if (ref.length === 0 || ref.startsWith('-') || /[\u0000\r\n]/.test(ref)) {
    throw new ChangeRejectedError(`invalid git ref ${JSON.stringify(ref)}`, []);
  }
}

const COMMIT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** `git rev-parse --verify --end-of-options <ref>^{commit}` -> full commit id. */
export async function resolveCommit(repo: string, ref: string, options: GitReadOptions = {}): Promise<string> {
  checkRef(ref);
  const out = await runGit(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], options, 4096);
  const id = out.toString('utf8').trim();
  if (!COMMIT_ID.test(id)) throw new GitCommandError(`unexpected rev-parse output for ${ref}`, [ref]);
  return id;
}

export interface TreeEntry {
  mode: string;
  type: string;
  oid: string;
  /** Blob size in bytes from `ls-tree -l`; null for gitlinks (`-`). */
  size: number | null;
}

/**
 * Parses `ls-tree -r -z -l` output: `<mode> SP <type> SP <oid> SP+ <size> TAB <path> NUL`. Paths must be UTF-8.
 */
export function parseLsTree(output: Buffer): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>();
  let start = 0;
  while (start < output.length) {
    let end = output.indexOf(0, start);
    if (end < 0) end = output.length;
    const record = output.subarray(start, end);
    start = end + 1;
    if (record.length === 0) continue;
    const tab = record.indexOf(9);
    if (tab < 0) throw new GitCommandError('malformed ls-tree record', []);
    const header = record.subarray(0, tab).toString('latin1').trim().split(/ +/);
    const decoded = decodeUtf8Strict('<git path>', 'head', record.subarray(tab + 1));
    if (!decoded.ok) throw new ChangeRejectedError('git path is not valid UTF-8', [decoded.issue]);
    const [mode, type, oid, size] = header;
    if (mode === undefined || type === undefined || oid === undefined || size === undefined) {
      throw new GitCommandError('malformed ls-tree header', []);
    }
    entries.set(decoded.text, { mode, type, oid, size: size === '-' ? null : Number.parseInt(size, 10) });
  }
  return entries;
}

async function listTree(repo: string, commit: string, options: GitReadOptions): Promise<Map<string, TreeEntry>> {
  const out = await runGit(repo, ['ls-tree', '-r', '-z', '-l', '--full-tree', commit], options, 64 * 1024 * 1024);
  return parseLsTree(out);
}

async function readBlob(
  repo: string,
  path: string,
  side: 'base' | 'head',
  entry: TreeEntry,
  options: GitReadOptions,
): Promise<string> {
  const bytes = await runGit(repo, ['cat-file', 'blob', entry.oid], options, LIMITS.maxSideBytes + 1);
  if (entry.size !== null && bytes.length !== entry.size) {
    throw new GitCommandError(`blob size mismatch for ${path}`, [entry.oid]);
  }
  const decoded = decodeUtf8Strict(path, side, bytes);
  if (!decoded.ok) throw new ChangeRejectedError(`change rejected: ${decoded.issue.code}`, [decoded.issue]);
  return decoded.text;
}

const SYMLINK_MODE = '120000';
const GITLINK_MODE = '160000';

/**
 * Builds the ChangeV1 for base..head. Every `.ts` / `.tsx` file of either tree is included (unchanged files give
 * clone and name-uniqueness context, plan D36); changed files with another extension are listed as
 * `unsupported_extension` without being read. Caps are checked from `ls-tree -l` sizes before any blob is read:
 * an over-limit file is listed and skipped; a file-count or total-byte cap reads nothing.
 */
export async function readGitChange(
  repo: string,
  baseRef: string,
  headRef: string,
  options: GitReadOptions = {},
): Promise<GitChange> {
  const baseCommit = await resolveCommit(repo, baseRef, options);
  const headCommit = await resolveCommit(repo, headRef, options);
  const baseTree = await listTree(repo, baseCommit, options);
  const headTree = await listTree(repo, headCommit, options);

  const issues: Issue[] = [];
  const rejections: Issue[] = [];
  const paths = [...new Set([...baseTree.keys(), ...headTree.keys()])].sort();
  const selected: { path: string; base: TreeEntry | null; head: TreeEntry | null }[] = [];
  for (const path of paths) {
    const base = baseTree.get(path) ?? null;
    const head = headTree.get(path) ?? null;
    const changed = base?.oid !== head?.oid || base?.mode !== head?.mode;
    const supported = sourceKindOf(path) !== null;
    for (const entry of [base, head]) {
      if (entry === null || !(changed || supported)) continue;
      if (entry.mode === SYMLINK_MODE) rejections.push(makeIssue('git_symlink', 'symbolic link', path));
      if (entry.mode === GITLINK_MODE) rejections.push(makeIssue('git_submodule', 'submodule (gitlink)', path));
    }
    if (!supported) {
      if (changed) issues.push(makeIssue('unsupported_extension', 'changed file with an unsupported extension', path));
      continue;
    }
    const overLimit = [base, head].some((e) => e !== null && (e.size === null || e.size > LIMITS.maxSideBytes));
    if (overLimit) {
      issues.push(makeIssue('limit_file_bytes', `a side exceeds ${LIMITS.maxSideBytes} bytes`, path));
      continue;
    }
    selected.push({ path, base, head });
  }
  if (rejections.length > 0) {
    throw new ChangeRejectedError(`change rejected: ${rejections.map((r) => r.code).join(', ')}`, rejections);
  }

  const totalBytes = selected.reduce((sum, f) => sum + (f.base?.size ?? 0) + (f.head?.size ?? 0), 0);
  let stop = false;
  if (selected.length > LIMITS.maxFiles) {
    issues.push(makeIssue('limit_files', `${selected.length} files > ${LIMITS.maxFiles}`));
    stop = true;
  }
  if (totalBytes > LIMITS.maxTotalBytes) {
    issues.push(makeIssue('limit_total_bytes', `${totalBytes} bytes base+head > ${LIMITS.maxTotalBytes}`));
    stop = true;
  }

  const files: ChangeV1['files'] = [];
  const blobs: GitChange['blobs'] = {};
  if (!stop) {
    for (const f of selected) {
      const baseText = f.base === null ? null : await readBlob(repo, f.path, 'base', f.base, options);
      const headText =
        f.head === null
          ? null
          : f.base !== null && f.head.oid === f.base.oid
            ? baseText
            : await readBlob(repo, f.path, 'head', f.head, options);
      files.push({ path: f.path, base: baseText, head: headText });
      blobs[f.path] = { base: f.base?.oid ?? null, head: f.head?.oid ?? null };
    }
  }

  return {
    change: {
      schema: 's45.change/1',
      id: options.changeId ?? `git:${baseCommit}..${headCommit}`,
      files,
    },
    issues,
    baseCommit,
    headCommit,
    blobs,
  };
}
