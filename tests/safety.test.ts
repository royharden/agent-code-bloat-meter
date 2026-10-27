// plan 6.1 / 9 M3: every input rejection and every limit has a code path and a test. Written in Dirty Mode, never run
// there (docs/DEFERRED-VALIDATION.md DV-M3-01).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GIT_CONFIG_ARGS, checkRef, gitEnv, parseLsTree, readGitChange } from '../src/core/git';
import { ChangeRejectedError, LIMITS, checkPath, checkPaths, decodeUtf8Strict } from '../src/core/safety';
import type { ChangeV1, IssueCode } from '../src/core/types';
import { analyze } from '../src/diffmetrics/index';

function change(files: ChangeV1['files'], id = 'safety'): ChangeV1 {
  return { schema: 's45.change/1', id, files };
}

function rejectionCodes(input: unknown): IssueCode[] {
  try {
    analyze(input as ChangeV1);
  } catch (error) {
    expect(error).toBeInstanceOf(ChangeRejectedError);
    return (error as ChangeRejectedError).issues.map((i) => i.code);
  }
  throw new Error('expected a rejection');
}

describe('path rules (plan 6.1)', () => {
  it.each([
    ['/abs/a.ts', 'path_absolute'],
    ['C:/a.ts', 'path_drive'],
    ['c:a.ts', 'path_drive'],
    ['\\\\server\\share\\a.ts', 'path_unc'],
    ['//server/share/a.ts', 'path_unc'],
    ['src\\a.ts', 'path_backslash'],
    ['src/../a.ts', 'path_dotdot'],
    ['../a.ts', 'path_dotdot'],
    ['./a.ts', 'path_dotdot'],
    ['src//a.ts', 'path_empty_segment'],
    ['src/', 'path_empty_segment'],
    ['', 'path_empty_segment'],
    ['src/a\u0000.ts', 'path_nul'],
  ] as const)('%j -> %s', (path, code) => {
    expect(checkPath(path)?.code).toBe(code);
    expect(rejectionCodes(change([{ path, base: null, head: 'x;\n' }]))).toContain(code);
  });

  it('accepts canonical relative POSIX paths', () => {
    expect(checkPath('src/a.ts')).toBeNull();
    expect(checkPath('a.ts')).toBeNull();
    expect(checkPath('src/.hidden/a.ts')).toBeNull();
  });

  it('rejects duplicates and case collisions', () => {
    expect(checkPaths(['a.ts', 'a.ts']).map((i) => i.code)).toEqual(['path_duplicate']);
    expect(checkPaths(['src/A.ts', 'src/a.ts']).map((i) => i.code)).toEqual(['path_case_collision']);
    expect(
      rejectionCodes(
        change([
          { path: 'src/A.ts', base: null, head: 'a;\n' },
          { path: 'src/a.ts', base: null, head: 'b;\n' },
        ]),
      ),
    ).toEqual(['path_case_collision']);
  });
});

describe('content rules (plan 6.1)', () => {
  it('rejects a NUL character as binary', () => {
    expect(rejectionCodes(change([{ path: 'a.ts', base: 'a\u0000b\n', head: 'x\n' }]))).toEqual(['content_binary']);
  });

  it('rejects a lone surrogate as invalid UTF-8', () => {
    expect(rejectionCodes(change([{ path: 'a.ts', base: null, head: 'const s = "\uD800";\n' }]))).toEqual([
      'content_invalid_utf8',
    ]);
  });

  it('rejects invalid UTF-8 and NUL bytes when bytes are supplied', () => {
    const bad = decodeUtf8Strict('a.ts', 'head', new Uint8Array([0x61, 0xc3, 0x28]));
    expect(bad.ok ? null : bad.issue.code).toBe('content_invalid_utf8');
    const nul = decodeUtf8Strict('a.ts', 'head', new Uint8Array([0x61, 0x00]));
    expect(nul.ok ? null : nul.issue.code).toBe('content_binary');
    const bom = decodeUtf8Strict('a.ts', 'head', new Uint8Array([0xef, 0xbb, 0xbf, 0x61]));
    expect(bom.ok ? bom.text : null).toBe('\uFEFFa');
  });
});

describe('shape rules', () => {
  it.each([
    [null],
    [{ schema: 's45.change/2', id: 'x', files: [] }],
    [{ schema: 's45.change/1', id: '', files: [] }],
    [{ schema: 's45.change/1', id: 'x', files: [{ path: 'a.ts', base: null, head: null }] }],
    [{ schema: 's45.change/1', id: 'x', files: [{ path: 'a.ts', base: 1, head: null }] }],
    [{ schema: 's45.change/1', id: 'x', files: [], extra: true }],
  ])('rejects %j', (input) => {
    expect(() => analyze(input as unknown as ChangeV1)).toThrow(ChangeRejectedError);
  });
});

describe('limits and statuses (plan 6.1)', () => {
  it(`more than ${LIMITS.maxFiles} files -> incomplete, nothing analysed`, () => {
    const files = Array.from({ length: LIMITS.maxFiles + 1 }, (_, i) => ({ path: `f${i}.ts`, base: null, head: 'x;\n' }));
    const a = analyze(change(files));
    expect(a.status).toBe('incomplete');
    expect(a.issues.map((i) => i.code)).toContain('limit_files');
    expect(a.hunks).toEqual([]);
  });

  it('a side over 256 KiB -> listed and skipped, change incomplete', () => {
    const big = 'x;\n'.repeat(Math.ceil((LIMITS.maxSideBytes + 1) / 3));
    const a = analyze(
      change([
        { path: 'big.ts', base: null, head: big },
        { path: 'small.ts', base: null, head: 'y;\n' },
      ]),
    );
    expect(a.status).toBe('incomplete');
    expect(a.issues.find((i) => i.code === 'limit_file_bytes')?.path).toBe('big.ts');
    expect(a.hunks.map((h) => h.path)).toEqual(['small.ts']);
  });

  it('more than 8 MiB base+head -> incomplete, nothing analysed', () => {
    const chunk = 'x;\n'.repeat(80_000); // 240,000 bytes per side, under the per-file cap
    const files = Array.from({ length: 36 }, (_, i) => ({ path: `f${i}.ts`, base: chunk, head: chunk }));
    const a = analyze(change(files));
    expect(a.status).toBe('incomplete');
    expect(a.issues.map((i) => i.code)).toContain('limit_total_bytes');
    expect(a.hunks).toEqual([]);
  });

  it(`more than ${LIMITS.maxChangedAtoms} changed atoms -> incomplete`, () => {
    const head = Array.from({ length: LIMITS.maxChangedAtoms + 1 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const a = analyze(change([{ path: 'a.ts', base: null, head }]));
    expect(a.status).toBe('incomplete');
    expect(a.issues.map((i) => i.code)).toContain('limit_changed_atoms');
    expect(a.totals.atoms).toBe(LIMITS.maxChangedAtoms + 1);
    expect(a.metrics).toEqual([]);
  });

  it('a changed unsupported file -> listed, incomplete; unchanged unsupported files are ignored', () => {
    const a = analyze(
      change([
        { path: 'a.ts', base: 'a;\n', head: 'b;\n' },
        { path: 'README.md', base: 'x\n', head: 'y\n' },
        { path: 'logo.svg', base: '<svg/>\n', head: '<svg/>\n' },
      ]),
    );
    expect(a.status).toBe('incomplete');
    expect(a.issues.filter((i) => i.code === 'unsupported_extension').map((i) => i.path)).toEqual(['README.md']);
  });

  it('nothing analysable -> unsupported, never zero findings', () => {
    const a = analyze(change([{ path: 'a.js', base: 'a\n', head: 'b\n' }]));
    expect(a.status).toBe('unsupported');
  });

  it('no atoms -> noop (CRLF-only and final-newline-only changes normalise away)', () => {
    const a = analyze(change([{ path: 'a.ts', base: 'a;\r\nb;', head: 'a;\nb;\n' }]));
    expect(a.status).toBe('noop');
    expect(a.totals.atoms).toBe(0);
  });

  it('an analysable change -> ok', () => {
    expect(analyze(change([{ path: 'a.ts', base: 'a;\n', head: 'b;\n' }])).status).toBe('ok');
  });

  it('external adapter issues make the change incomplete', () => {
    const a = analyze(change([{ path: 'a.ts', base: 'a;\n', head: 'b;\n' }]), {
      externalIssues: [{ code: 'unsupported_extension', path: 'x.png', message: 'not read' }],
    });
    expect(a.status).toBe('incomplete');
  });
});

describe('git adapter (plan 6.1)', () => {
  it('passes the fixed config overrides and environment', () => {
    expect(GIT_CONFIG_ARGS).toEqual([
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'diff.external=',
      '-c',
      'core.fsmonitor=false',
    ]);
    const env = gitEnv();
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('refuses refs that look like options or contain line breaks', () => {
    for (const ref of ['', '--output=x', '-x', 'a\nb', 'a\u0000b']) expect(() => checkRef(ref)).toThrow(ChangeRejectedError);
    expect(() => checkRef('HEAD~1')).not.toThrow();
  });

  it('parses ls-tree -l -z records, including gitlinks', () => {
    const out = Buffer.from(
      '100644 blob 1111111111111111111111111111111111111111     12\tsrc/a.ts\u0000' +
        '160000 commit 2222222222222222222222222222222222222222       -\tvendor/sub\u0000',
      'utf8',
    );
    const entries = parseLsTree(out);
    expect(entries.get('src/a.ts')).toEqual({
      mode: '100644',
      type: 'blob',
      oid: '1111111111111111111111111111111111111111',
      size: 12,
    });
    expect(entries.get('vendor/sub')?.size).toBeNull();
  });

  const hasGit = ((): boolean => {
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasGit)('reads a change from two commits and rejects symlinks and submodules', async () => {
    const repo = mkdtempSync(join(tmpdir(), 's45-git-'));
    const git = (args: string[], input?: string): string =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-C', repo, ...args], {
        input,
        encoding: 'utf8',
        env: gitEnv(),
      }).trim();
    try {
      git(['init', '-q']);
      const blob = (text: string): string => git(['hash-object', '-w', '--stdin'], text);
      const commit = (entries: string[], parents: string[]): string => {
        const tree = git(['mktree'], entries.join('\n') + '\n');
        return git(['commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-m', 'c']);
      };
      // `git mktree` builds one tree level, so every path here is top-level.
      const a1 = blob('export const a = 1;\n');
      const a2 = blob('export const a = 2;\n');
      const c1 = commit([`100644 blob ${a1}\ta.ts`, `100644 blob ${blob('# x\n')}\tREADME.md`], []);
      const c2 = commit([`100644 blob ${a2}\ta.ts`, `100644 blob ${blob('# y\n')}\tREADME.md`], [c1]);
      const result = await readGitChange(repo, c1, c2);
      expect(result.change.files).toEqual([{ path: 'a.ts', base: 'export const a = 1;\n', head: 'export const a = 2;\n' }]);
      expect(result.issues.map((i) => i.code)).toEqual(['unsupported_extension']);
      expect(analyze(result.change, { externalIssues: result.issues }).status).toBe('incomplete');

      const c3 = commit([`100644 blob ${a2}\ta.ts`, `120000 blob ${blob('a.ts')}\tlink.ts`], [c2]);
      await expect(readGitChange(repo, c2, c3)).rejects.toMatchObject({ issues: [{ code: 'git_symlink' }] });
      const c4 = commit([`100644 blob ${a2}\ta.ts`, `160000 commit ${c1}\tvendor`], [c2]);
      await expect(readGitChange(repo, c2, c4)).rejects.toMatchObject({ issues: [{ code: 'git_submodule' }] });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
