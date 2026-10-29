// plan 6.1 / 6.2: per-file facts derived from a ChangeV1 — normalisation for comparison, roles, source kinds and line
// helpers. Pure: no filesystem, no network. Rules: docs/ATOMS.md sections 2-3, docs/METRICS.md section 1.
import type { FileRole } from './types';

/** Source kinds the analyser parses (plan D2: `.ts` / `.tsx` only, judged on the lower-cased path). */
export type SourceKind = 'ts' | 'tsx';

/** docs/ATOMS.md section 3: a null or empty side contributes no lines. */
export function sidePresent(text: string | null): text is string {
  return text !== null && text !== '';
}

/**
 * docs/ATOMS.md section 3: CRLF -> LF, then remaining CR -> LF, then append LF if missing. A null or empty side
 * normalises to the empty string. Used for diffing, line numbering and parsing only; hashes use the original text.
 */
export function normaliseText(text: string | null): string {
  if (!sidePresent(text)) return '';
  const lf = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return lf.endsWith('\n') ? lf : `${lf}\n`;
}

/** Number of LF characters (equals the line count of normalised text). */
export function countLineFeeds(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  return n;
}

/** Lines of normalised text without their LF terminators; line i (1-based) is element i - 1. */
export function splitLines(textLF: string): string[] {
  if (textLF === '') return [];
  return textLF.slice(0, -1).split('\n');
}

/** plan D2: `.ts` / `.tsx` by lower-cased extension; everything else is unsupported (null). */
export function sourceKindOf(path: string): SourceKind | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.ts')) return 'ts';
  return null;
}

/**
 * plan 6.1 / docs/METRICS.md section 1: role from the path only, never from input.
 * test: file name `*.test.ts(x)` / `*.spec.ts(x)`, or any path segment `__tests__`;
 * config: file name `*.config.ts(x)`; production otherwise.
 */
export function fileRoleOf(path: string): FileRole {
  const segments = path.toLowerCase().split('/');
  const name = segments[segments.length - 1] ?? '';
  if (segments.includes('__tests__') || /\.(test|spec)\.tsx?$/.test(name)) return 'test';
  if (/\.config\.tsx?$/.test(name)) return 'config';
  return 'production';
}
