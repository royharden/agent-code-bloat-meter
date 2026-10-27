// plan D6 / 6.3 / docs/METRICS.md section 8: no_changed_test_reference. Never run in Dirty Mode.
import { describe, expect, it } from 'vitest';
import type { ChangeV1, FunctionRecord } from '../src/core/types';
import { analyze } from '../src/diffmetrics/index';

const PROD_BASE = 'export function alpha() {\n  return 1;\n}\nexport function beta() {\n  return 2;\n}\n';
const PROD_HEAD = 'export function alpha() {\n  return 10;\n}\nexport function beta() {\n  return 20;\n}\n';

function ref(files: ChangeV1['files'], key: string): FunctionRecord['noChangedTestReference'] {
  const r = analyze({ schema: 's45.change/1', id: 'testref', files }).functions.find((f) => f.key === key);
  if (r === undefined) throw new Error(`no record ${key}`);
  return r.noChangedTestReference;
}

describe('no_changed_test_reference', () => {
  it('false when an added test names the function (spans: the identifiers); true otherwise', () => {
    const files: ChangeV1['files'] = [
      { path: 'src/p.ts', base: PROD_BASE, head: PROD_HEAD },
      { path: 'src/p.test.ts', base: null, head: "import { alpha } from './p';\nalpha();\n" },
    ];
    const alpha = ref(files, 'src/p.ts#alpha');
    expect(alpha.value).toBe(false);
    expect(alpha.spans).toEqual([
      { path: 'src/p.test.ts', side: 'head', startLine: 1, endLine: 1 },
      { path: 'src/p.test.ts', side: 'head', startLine: 2, endLine: 2 },
    ]);
    expect(ref(files, 'src/p.ts#beta').value).toBe(true);
  });

  it('unchanged test files are not scanned (trap N7 by design)', () => {
    const test = "import { alpha } from './p';\nalpha();\n";
    const files: ChangeV1['files'] = [
      { path: 'src/p.ts', base: PROD_BASE, head: PROD_HEAD },
      { path: 'src/__tests__/p.ts', base: test, head: test },
    ];
    expect(ref(files, 'src/p.ts#alpha').value).toBe(true);
  });

  it('non-unique bare names across production files are unknown; accessors use the bare name', () => {
    const files: ChangeV1['files'] = [
      { path: 'src/p.ts', base: PROD_BASE, head: PROD_HEAD },
      { path: 'src/q.ts', base: 'export const x = 1;\n', head: 'export class Q {\n  alpha() {}\n  get gamma() { return 1; }\n}\n' },
      { path: 'src/q.test.ts', base: null, head: 'gamma;\n' },
    ];
    expect(ref(files, 'src/p.ts#alpha').value).toBe('unknown');
    expect(ref(files, 'src/q.ts#Q/get:gamma').value).toBe(false);
  });

  it('<top>, unchanged and deleted functions are unknown', () => {
    const files: ChangeV1['files'] = [
      {
        path: 'src/p.ts',
        base: 'run();\nexport function kept() {}\nexport function gone() {}\n',
        head: 'run(1);\nexport function kept() {}\n',
      },
    ];
    expect(ref(files, 'src/p.ts#<top>').value).toBe('unknown');
    expect(ref(files, 'src/p.ts#kept').value).toBe('unknown');
    expect(ref(files, 'src/p.ts#gone').value).toBe('unknown');
  });

  it('an unparseable changed test head makes every value unknown', () => {
    const files: ChangeV1['files'] = [
      { path: 'src/p.ts', base: PROD_BASE, head: PROD_HEAD },
      { path: 'src/p.test.ts', base: null, head: 'const = ;\n' },
    ];
    expect(ref(files, 'src/p.ts#beta').value).toBe('unknown');
  });

  it('unknown never fires the untested-size input and never makes a hunk manual', () => {
    const a = analyze({
      schema: 's45.change/1',
      id: 'testref-unknown',
      files: [
        { path: 'src/p.ts', base: PROD_BASE, head: PROD_HEAD },
        { path: 'src/q.ts', base: null, head: 'export function alpha() {}\n' },
      ],
    });
    const hunk = a.hunks.find((h) => h.path === 'src/p.ts' && h.headStart === 2);
    const m = a.metrics.find((x) => x.hunkId === hunk?.id);
    expect(m?.untestedChangedStatementMax.value).toBe(0);
    expect(m?.manual).toBe(false);
  });
});
