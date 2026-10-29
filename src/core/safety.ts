// plan 6.1: input safety for ChangeV1. Rejections (shape, paths, content) throw ChangeRejectedError and nothing is
// analysed; limits are listed as issues and make the change `incomplete` (cannot enter the study).
// Pure: no filesystem, no network. Analysed code is never executed anywhere in src/core or src/diffmetrics.
import { utf8ByteLength } from './hash';
import type { ChangeV1, Issue, IssueCode, Side } from './types';

/** plan 6.1 limits. */
export const LIMITS: Readonly<{
  maxFiles: number;
  maxSideBytes: number;
  maxTotalBytes: number;
  maxChangedAtoms: number;
}> = Object.freeze({
  maxFiles: 200,
  maxSideBytes: 256 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxChangedAtoms: 5000,
});

/** Thrown when an input is rejected (plan 6.1). `issues` lists every rejection found (empty for shape errors). */
export class ChangeRejectedError extends Error {
  readonly issues: Issue[];

  constructor(message: string, issues: Issue[]) {
    super(message);
    this.name = 'ChangeRejectedError';
    this.issues = issues;
  }
}

function issue(code: IssueCode, message: string, path?: string, side?: Side): Issue {
  const out: Issue = { code, message };
  if (path !== undefined) out.path = path;
  if (side !== undefined) out.side = side;
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * schemas/change.schema.json shape: `{schema:'s45.change/1', id, files:[{path, base, head}]}`, no extra keys,
 * id non-empty, base/head string or null and not both null. Throws ChangeRejectedError on the first violation.
 */
export function assertChangeShape(input: unknown): asserts input is ChangeV1 {
  const fail = (why: string): never => {
    throw new ChangeRejectedError(`invalid ChangeV1: ${why}`, []);
  };
  if (!isRecord(input)) fail('not an object');
  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== 'schema' && key !== 'id' && key !== 'files') fail(`unexpected key "${key}"`);
  }
  if (obj.schema !== 's45.change/1') fail('schema must be "s45.change/1"');
  if (typeof obj.id !== 'string' || obj.id.length === 0) fail('id must be a non-empty string');
  if (!Array.isArray(obj.files)) fail('files must be an array');
  (obj.files as unknown[]).forEach((file, i) => {
    if (!isRecord(file)) fail(`files[${i}] is not an object`);
    const f = file as Record<string, unknown>;
    for (const key of Object.keys(f)) {
      if (key !== 'path' && key !== 'base' && key !== 'head') fail(`files[${i}] has unexpected key "${key}"`);
    }
    if (typeof f.path !== 'string') fail(`files[${i}].path must be a string`);
    if (!(typeof f.base === 'string' || f.base === null)) fail(`files[${i}].base must be a string or null`);
    if (!(typeof f.head === 'string' || f.head === null)) fail(`files[${i}].head must be a string or null`);
    if (f.base === null && f.head === null) fail(`files[${i}] has neither base nor head`);
  });
}

/**
 * plan 6.1: canonical relative POSIX path. Returns the first violated rule, or null.
 * Order: NUL, UNC (`\\` or `//` prefix), backslash, drive, absolute, empty segment (incl. trailing slash), `.`/`..`.
 */
export function checkPath(path: string): Issue | null {
  if (path.includes('\u0000')) return issue('path_nul', 'path contains NUL', path);
  if (path.startsWith('\\\\') || path.startsWith('//')) return issue('path_unc', 'UNC path', path);
  if (path.includes('\\')) return issue('path_backslash', 'path contains a backslash', path);
  if (/^[A-Za-z]:/.test(path)) return issue('path_drive', 'path has a drive prefix', path);
  if (path.startsWith('/')) return issue('path_absolute', 'absolute path', path);
  const segments = path.split('/');
  if (segments.some((s) => s === '')) return issue('path_empty_segment', 'empty path segment', path);
  if (segments.some((s) => s === '.' || s === '..')) return issue('path_dotdot', '"." or ".." path segment', path);
  return null;
}

/** plan 6.1: every path canonical; no exact duplicates; no case collisions. */
export function checkPaths(paths: readonly string[]): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const folded = new Map<string, string>();
  for (const path of paths) {
    const bad = checkPath(path);
    if (bad !== null) issues.push(bad);
    if (seen.has(path)) {
      issues.push(issue('path_duplicate', 'duplicate path', path));
      continue;
    }
    seen.add(path);
    const lower = path.toLowerCase();
    const other = folded.get(lower);
    if (other !== undefined) issues.push(issue('path_case_collision', `case collision with "${other}"`, path));
    else folded.set(lower, path);
  }
  return issues;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * plan 6.1 content rules for one side given as a string: NUL character = binary; a lone surrogate cannot be UTF-8.
 */
export function checkTextContent(path: string, side: Side, text: string | null): Issue[] {
  if (text === null) return [];
  if (text.includes('\u0000')) return [issue('content_binary', 'NUL byte (binary content)', path, side)];
  if (LONE_SURROGATE.test(text)) return [issue('content_invalid_utf8', 'lone UTF-16 surrogate', path, side)];
  return [];
}

/**
 * plan 6.1 content rules for one side given as bytes (git blobs, CLI input files): a NUL byte = binary; the bytes
 * must decode as strict UTF-8. A leading BOM is kept in the text (ignoreBOM), so the text re-encodes to the bytes.
 */
export function decodeUtf8Strict(
  path: string,
  side: Side,
  bytes: Uint8Array,
): { ok: true; text: string } | { ok: false; issue: Issue } {
  if (bytes.includes(0)) return { ok: false, issue: issue('content_binary', 'NUL byte (binary content)', path, side) };
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return { ok: true, text };
  } catch {
    return { ok: false, issue: issue('content_invalid_utf8', 'invalid UTF-8', path, side) };
  }
}

/** Every plan 6.1 rejection of a well-shaped ChangeV1: path rules, duplicates/collisions and content rules. */
export function findRejections(change: ChangeV1): Issue[] {
  const issues = checkPaths(change.files.map((f) => f.path));
  for (const f of change.files) {
    issues.push(...checkTextContent(f.path, 'base', f.base), ...checkTextContent(f.path, 'head', f.head));
  }
  return issues;
}

/** Throws ChangeRejectedError when the input is malformed or any plan 6.1 rejection applies. */
export function assertAcceptable(input: unknown): asserts input is ChangeV1 {
  assertChangeShape(input);
  const rejections = findRejections(input);
  if (rejections.length > 0) {
    throw new ChangeRejectedError(`change rejected: ${rejections.map((r) => r.code).join(', ')}`, rejections);
  }
}

/** Result of the plan 6.1 size limits (byte and file-count caps; the atom cap is applied after diffing). */
export interface LimitCheck {
  issues: Issue[];
  /** Paths with a side over `maxSideBytes`: listed and not analysed. */
  overLimitPaths: Set<string>;
  /** True when a whole-change cap (files, total bytes) is exceeded: nothing is analysed. */
  stop: boolean;
}

/** plan 6.1: 200 files, 256 KiB per side per file, 8 MiB total base + head. */
export function checkLimits(change: ChangeV1): LimitCheck {
  const issues: Issue[] = [];
  const overLimitPaths = new Set<string>();
  let stop = false;
  if (change.files.length > LIMITS.maxFiles) {
    issues.push(issue('limit_files', `${change.files.length} files > ${LIMITS.maxFiles}`));
    stop = true;
  }
  let total = 0;
  for (const f of change.files) {
    for (const side of ['base', 'head'] as const) {
      const text = f[side];
      if (text === null) continue;
      const bytes = utf8ByteLength(text);
      total += bytes;
      if (bytes > LIMITS.maxSideBytes) {
        issues.push(issue('limit_file_bytes', `${bytes} bytes > ${LIMITS.maxSideBytes}`, f.path, side));
        overLimitPaths.add(f.path);
      }
    }
  }
  if (total > LIMITS.maxTotalBytes) {
    issues.push(issue('limit_total_bytes', `${total} bytes base+head > ${LIMITS.maxTotalBytes}`));
    stop = true;
  }
  return { issues, overLimitPaths, stop };
}

/** plan 6.1: the changed-atom cap, applied after diffing. */
export function checkAtomLimit(atoms: number): Issue | null {
  return atoms > LIMITS.maxChangedAtoms
    ? issue('limit_changed_atoms', `${atoms} changed atoms > ${LIMITS.maxChangedAtoms}`)
    : null;
}

/** Issue codes that list (rather than reject) and make a change `incomplete`. */
export const LISTING_CODES: ReadonlySet<IssueCode> = new Set<IssueCode>([
  'limit_files',
  'limit_file_bytes',
  'limit_total_bytes',
  'limit_changed_atoms',
  'unsupported_extension',
]);

export { issue as makeIssue };
