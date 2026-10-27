// plan 9 M2: Gate 1 file-checkable predicates (src/corpus/validate.ts). Written, never run in Dirty Mode.
// ENGINEERING FIXTURE ONLY: the label records below are shape-only stand-ins built in memory (no code, no witnesses,
// no sites). They are not study data and are never written to corpus/.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Atom, ChangeV1, CorpusManifestV1, Family, LabelV1, Split } from '../src/corpus/contract';
import { sha256Hex } from '../src/corpus/inputs';
import * as validate from '../src/corpus/validate';
import {
  FAMILIES,
  GATE1_PREDICATE_MAP,
  TRAP_IDS,
  canonicalJson,
  checkAuthorIndependence,
  checkCounts,
  checkReceiptReferences,
  checkRequiredAtomsExist,
  checkSizeBalance,
  checkSplitOverlap,
  checkWholeRootTree,
  validateLabels,
  validateManifest,
  verifyCommitment,
} from '../src/corpus/validate';
import type { PredicateResult } from '../src/corpus/validate';

const h = (s: string) => sha256Hex(s);

const EDITED_OPERATOR: Record<Family, string> = {
  boundary: 'boundary.flip-inclusive',
  null_optional: 'null_optional.optional-chain-to-dot',
  await_ordering: 'await_ordering.remove-await',
  authz_weakened: 'authz_weakened.delete-guard',
  validation_escaping: 'validation_escaping.unwrap-call',
  error_swallowed_mismapped: 'error_swallowed_mismapped.remap-error-class',
  state_cache_lifecycle: 'state_cache_lifecycle.change-key-part',
  logic_value: 'logic_value.swap-and-or',
};

interface Fixture {
  manifest: CorpusManifestV1;
  labels: LabelV1[];
}

/** Shape-complete edition: 20 roots per split, 4 changes per root, counts exactly at the Gate 1 values. */
function makeFixture(): Fixture {
  const roots: CorpusManifestV1['roots'] = [];
  const changes: CorpusManifestV1['changes'] = [];
  const files: Record<string, string> = {};
  const labels: LabelV1[] = [];
  for (const split of ['dev', 'heldout'] as const) {
    for (let i = 0; i < 20; i += 1) {
      const rootId = `${split}r${i}`;
      roots.push({ id: rootId, split, tsx: i < 4 });
      files[`${split}/roots/${rootId}/src/mod.ts`] = h(`root ${rootId}`);
      const cleanId = `${split}c${i}`;
      const mk = (id: string, label: LabelV1) => {
        const labelHash = h(`label ${id}`);
        const inputHash = h(`input ${id}`);
        changes.push({ id, rootId, inputHash, labelHash });
        files[`${split}/inputs/${id}.json`] = inputHash;
        files[`${split}/labels/${id}.json`] = labelHash;
        labels.push(label);
      };
      const base = { schema: 's45.label/1' as const, rootId, split, baseSanityReceipts: [] };
      mk(cleanId, { ...base, changeId: cleanId, kind: 'clean', cleanWitnesses: [{ path: 'w.test.ts', headPassHash: h('w') }] });
      [FAMILIES[(2 * i) % 8], FAMILIES[(2 * i + 1) % 8]].forEach((family, slot) => {
        const fam = family as Family;
        const id = `${split}d${i}s${slot}`;
        const baseDeletion = i === 0 && fam === 'null_optional';
        const operator = baseDeletion ? 'null_optional.delete-guard' : EDITED_OPERATOR[fam];
        const anchorKind = baseDeletion ? 'base-deletion' : fam === 'authz_weakened' ? 'r-del-gap' : 'edited';
        const side = baseDeletion ? 'base' : 'head';
        mk(id, {
          ...base,
          changeId: id,
          kind: 'defect',
          defect: {
            family: fam,
            operator,
            siteId: `${cleanId}#${operator}@src/mod.ts:1-2`,
            requiredAtoms: [{ path: 'src/mod.ts', side, line: 3 }],
            anchorKind,
            signatureBearing: false,
            cleanTwinId: cleanId,
            witnessTest: 'witness > case',
            cleanHeadPassHash: h('p'),
            headAssertionFailureHash: h('f'),
          },
        });
      });
      const nearId = `${split}n${i}`;
      mk(nearId, {
        ...base,
        changeId: nearId,
        kind: 'near_miss',
        trapIds: [TRAP_IDS[i % 8] as string],
        cleanWitnesses: [{ path: 'w.test.ts', headPassHash: h('w') }],
      });
    }
  }
  const manifest: CorpusManifestV1 = {
    schema: 's45.corpus/1',
    source: 's45-own',
    edition: 'e1',
    authorSession: 'author-session',
    authorHarness: 'harness',
    authorModel: 'model',
    custodianSession: 'author-session',
    licence: 'MIT',
    recipeHash: h('recipe'),
    familyListHash: h('families'),
    siteInventoryHash: h('inventory'),
    splitSeed: 45,
    placementSeed: 450045,
    roots,
    changes,
    files,
  };
  return { manifest, labels };
}

const allOk = (rs: PredicateResult[]) => rs.every((r) => r.ok);
const failed = (rs: PredicateResult[]) => rs.filter((r) => !r.ok).map((r) => r.predicate);

describe('checkCounts (plan 7.3 predicate 2)', () => {
  it('passes a shape-complete edition for both splits', () => {
    const { manifest, labels } = makeFixture();
    for (const split of ['dev', 'heldout'] as Split[]) {
      const rs = checkCounts(manifest, labels, split);
      expect(failed(rs)).toEqual([]);
    }
  });

  it('fails per-family when a defect changes family', () => {
    const { manifest, labels } = makeFixture();
    const d = labels.find((l) => l.changeId === 'devd1s0');
    if (d?.defect === undefined) throw new Error('fixture');
    d.defect.family = 'logic_value';
    expect(failed(checkCounts(manifest, labels, 'dev'))).toContain('7.3.2 dev per-family');
  });

  it('fails traps when a near-miss loses its trapIds and a trap drops below 2', () => {
    const { manifest, labels } = makeFixture();
    for (const id of ['devn0', 'devn8', 'devn16']) delete labels.find((l) => l.changeId === id)?.trapIds;
    expect(failed(checkCounts(manifest, labels, 'dev'))).toContain('7.3.2 dev traps');
  });

  it('requires at least one base-deletion defect per split', () => {
    const { manifest, labels } = makeFixture();
    const d = labels.find((l) => l.changeId === 'heldoutd0s1');
    if (d?.defect === undefined) throw new Error('fixture');
    d.defect.anchorKind = 'edited';
    expect(failed(checkCounts(manifest, labels, 'heldout'))).toContain('7.3.2 heldout base-deletion');
    expect(failed(checkCounts(manifest, labels, 'dev'))).not.toContain('7.3.2 dev base-deletion');
  });

  it('fails when fewer than 4 TSX roots', () => {
    const { manifest, labels } = makeFixture();
    const r = manifest.roots.find((x) => x.id === 'devr0');
    if (r === undefined) throw new Error('fixture');
    r.tsx = false;
    expect(failed(checkCounts(manifest, labels, 'dev'))).toContain('7.3.2 dev tsx-roots');
  });

  it('reports label/manifest inconsistency and a twin in another root', () => {
    const { manifest, labels } = makeFixture();
    const d = labels.find((l) => l.changeId === 'devd2s0');
    if (d?.defect === undefined) throw new Error('fixture');
    d.defect.cleanTwinId = 'devc3';
    labels.splice(labels.findIndex((l) => l.changeId === 'devn5'), 1);
    const f = failed(checkCounts(manifest, labels, 'dev'));
    expect(f).toContain('7.3.2 dev clean-twins');
    expect(f).toContain('7.3.2 dev labels-match-manifest');
  });
});

describe('validateLabels (schema + FAMILIES.md consistency)', () => {
  it('accepts the fixture labels', () => {
    expect(failed(validateLabels(makeFixture().labels))).toEqual([]);
  });

  it('rejects an operator from another family, a wrong anchor and a wrong signatureBearing', () => {
    const { labels } = makeFixture();
    const d = labels.find((l) => l.changeId === 'devd0s0');
    if (d?.defect === undefined) throw new Error('fixture');
    d.defect.operator = 'logic_value.swap-and-or';
    const e = labels.find((l) => l.changeId === 'devd1s0');
    if (e?.defect === undefined) throw new Error('fixture');
    e.defect.signatureBearing = true;
    const rs = validateLabels(labels);
    expect(failed(rs)).toEqual(['7.4 labels.operator-consistency']);
    expect(rs.find((r) => !r.ok)?.detail).toContain('devd0s0');
    expect(rs.find((r) => !r.ok)?.detail).toContain('devd1s0');
  });

  it('requires signatureBearing true for the empty-catch operator', () => {
    const { labels } = makeFixture();
    const d = labels.find((l) => l.defect?.family === 'error_swallowed_mismapped');
    if (d?.defect === undefined) throw new Error('fixture');
    d.defect.operator = 'error_swallowed_mismapped.empty-catch';
    expect(failed(validateLabels(labels))).toEqual(['7.4 labels.operator-consistency']);
    d.defect.signatureBearing = true;
    expect(failed(validateLabels(labels))).toEqual([]);
  });

  it('enforces the label schema conditionals', () => {
    const { labels } = makeFixture();
    const bad: unknown[] = labels.map((l) => structuredClone(l));
    const d = bad.find((l) => (l as LabelV1).changeId === 'devd3s1') as Record<string, unknown>;
    d.cleanWitnesses = [{ path: 'x', headPassHash: h('x') }];
    const n = bad.find((l) => (l as LabelV1).changeId === 'devn1') as Record<string, unknown>;
    delete n.trapIds;
    const r = bad.find((l) => (l as LabelV1).changeId === 'devd5s1') as LabelV1;
    if (r.defect === undefined) throw new Error('fixture');
    r.defect.anchorKind = 'r-del-gap';
    r.defect.requiredAtoms = [1, 2, 3].map((line) => ({ path: 'src/mod.ts', side: 'head' as const, line }));
    const rs = validateLabels(bad);
    const detail = rs.find((x) => x.predicate === '7.3.3 schema.labels')?.detail ?? '';
    expect(detail).toContain('kind defect must not have cleanWitnesses');
    expect(detail).toContain('kind near_miss requires trapIds');
    expect(detail).toContain('r-del-gap allows at most 2 atoms');
  });
});

describe('validateManifest', () => {
  it('accepts the fixture manifest and matching expectations', () => {
    const { manifest } = makeFixture();
    expect(failed(validateManifest(manifest, { recipeHash: h('recipe'), familyListHash: h('families') }))).toEqual([]);
  });

  it('detects missing per-change file entries, bad seeds and unknown fields', () => {
    const { manifest } = makeFixture();
    delete manifest.files['dev/labels/devc0.json'];
    const m = manifest as unknown as Record<string, unknown>;
    m.splitSeed = 46;
    m.extra = true;
    const f = failed(validateManifest(m));
    expect(f).toContain('7.3.3 schema.manifest');
    expect(f).toContain('7.3.3 manifest.files-coverage');
  });

  it('rejects ids that are not safe file names', () => {
    const { manifest } = makeFixture();
    (manifest.changes[0] as { id: string }).id = '../escape';
    expect(failed(validateManifest(manifest))).toContain('7.3.3 schema.manifest');
  });
});

describe('checkSplitOverlap', () => {
  it('passes the fixture', () => {
    expect(allOk(checkSplitOverlap(makeFixture().manifest))).toBe(true);
  });

  it('fails on a root in both splits, a shared input and an identical root file', () => {
    const { manifest } = makeFixture();
    manifest.roots.push({ id: 'devr1', split: 'heldout', tsx: false });
    const heldoutChange = manifest.changes.find((c) => c.id === 'heldoutc2');
    const devChange = manifest.changes.find((c) => c.id === 'devc2');
    if (heldoutChange === undefined || devChange === undefined) throw new Error('fixture');
    heldoutChange.inputHash = devChange.inputHash;
    manifest.files['heldout/roots/heldoutr3/src/mod.ts'] = manifest.files['dev/roots/devr3/src/mod.ts'] as string;
    const f = failed(checkSplitOverlap(manifest));
    expect(f).toEqual(['7.3.3 split-overlap.ids', '7.3.3 split-overlap.inputs', '7.3.3 split-overlap.root-files']);
  });
});

describe('checkRequiredAtomsExist (D34)', () => {
  const label = (): LabelV1 => {
    const l = makeFixture().labels.find((x) => x.changeId === 'devd1s0');
    if (l === undefined) throw new Error('fixture');
    return l;
  };
  const atom: Atom = { path: 'src/mod.ts', side: 'head', line: 3 };

  it('passes when the defect change has the atom', () => {
    expect(allOk(checkRequiredAtomsExist(new Map([['devd1s0', [atom]]]), [label()]))).toBe(true);
  });

  it("looks up the label's own changeId, never the clean twin's", () => {
    const atoms = new Map<string, Atom[]>([
      ['devc1', [atom]],
      ['devd1s0', [{ ...atom, line: 4 }]],
    ]);
    const rs = checkRequiredAtomsExist(atoms, [label()]);
    expect(rs[0]?.ok).toBe(false);
    expect(rs[0]?.detail).toContain('devd1s0');
  });

  it('fails when no atoms were supplied for the change', () => {
    expect(allOk(checkRequiredAtomsExist(new Map(), [label()]))).toBe(false);
  });
});

describe('checkSizeBalance (D18)', () => {
  it('passes at ratio 1 and fails at ratio 2', () => {
    const { labels } = makeFixture();
    const devDefects = labels.filter((l) => l.split === 'dev' && l.kind === 'defect');
    const atoms = (n: number): Atom[] => Array.from({ length: n }, (_, i) => ({ path: 'a.ts', side: 'head', line: i + 1 }));
    const equal = new Map<string, Atom[]>();
    const double = new Map<string, Atom[]>();
    for (const d of devDefects) {
      const twin = d.defect?.cleanTwinId as string;
      equal.set(twin, atoms(10));
      equal.set(d.changeId, atoms(10));
      double.set(twin, atoms(10));
      double.set(d.changeId, atoms(20));
    }
    expect(allOk(checkSizeBalance(equal, labels))).toBe(true);
    expect(allOk(checkSizeBalance(double, labels))).toBe(false);
  });
});

describe('checkReceiptReferences (7.3.1 file-checkable part)', () => {
  const receipt = (fields: Record<string, unknown>) => {
    const body = {
      schema: 's45.receipt/1',
      command: ['vitest', 'run'],
      exitCode: 0,
      sourceHash: h('src'),
      testHash: h('test'),
      harnessVersion: 'h1',
      recordedAt: '2026-01-01T00:00:00Z',
      ...fields,
    };
    return { ...body, sha256: sha256Hex(canonicalJson(body)) };
  };

  it('accepts matching receipts and rejects a tampered one', () => {
    const pass = receipt({ changeId: 'c1', side: 'head', outcome: 'pass' });
    const fail = receipt({ changeId: 'd1', side: 'head', outcome: 'assertion_fail', exitCode: 1, failedTest: 'w > t' });
    const base = receipt({ changeId: 'd1', side: 'base', outcome: 'pass' });
    const label: LabelV1 = {
      schema: 's45.label/1',
      changeId: 'd1',
      rootId: 'r1',
      split: 'dev',
      kind: 'defect',
      defect: {
        family: 'boundary',
        operator: 'boundary.flip-inclusive',
        siteId: 's',
        requiredAtoms: [{ path: 'a.ts', side: 'head', line: 1 }],
        anchorKind: 'edited',
        signatureBearing: false,
        cleanTwinId: 'c1',
        witnessTest: 'w > t',
        cleanHeadPassHash: pass.sha256,
        headAssertionFailureHash: fail.sha256,
      },
      baseSanityReceipts: [{ path: 'b.test.ts', basePassHash: base.sha256 }],
    };
    expect(allOk(checkReceiptReferences([label], [pass, fail, base]))).toBe(true);
    const tampered = { ...fail, failedTest: 'other' };
    expect(failed(checkReceiptReferences([label], [pass, tampered, base]))).toEqual([
      '7.3.1 receipts.self-hash',
      '7.3.1 receipts.references',
    ]);
  });

  it('canonicalJson sorts keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[2,{"e":0,"f":1}]},"b":1}');
  });
});

describe('checkWholeRootTree (D36) and checkAuthorIndependence', () => {
  it('requires every root file with base equal to the root text', () => {
    const { manifest } = makeFixture();
    const trees = new Map([['devr0', new Map([['src/mod.ts', 'export const a = 1;\n']])]]);
    const good: ChangeV1 = {
      schema: 's45.change/1',
      id: 'devc0',
      files: [{ path: 'src/mod.ts', base: 'export const a = 1;\n', head: 'export const a = 2;\n' }],
    };
    const bad: ChangeV1 = { schema: 's45.change/1', id: 'devd0s0', files: [] };
    expect(allOk(checkWholeRootTree(trees, [good], manifest))).toBe(true);
    expect(allOk(checkWholeRootTree(trees, [bad], manifest))).toBe(false);
  });

  it('fails when the author session is a builder session or the list is empty', () => {
    const { manifest } = makeFixture();
    expect(allOk(checkAuthorIndependence(manifest, ['builder-1']))).toBe(true);
    expect(allOk(checkAuthorIndependence(manifest, ['author-session']))).toBe(false);
    expect(allOk(checkAuthorIndependence(manifest, []))).toBe(false);
  });
});

describe('GATE1_PREDICATE_MAP', () => {
  it('maps every 7.3 predicate to exported functions or a Normal-mode-only note', () => {
    expect(GATE1_PREDICATE_MAP.map((e) => e.item)).toEqual(['7.3.1', '7.3.2', '7.3.3', '7.3.4', '7.3.5', '7.3.6']);
    for (const e of GATE1_PREDICATE_MAP) {
      expect(e.checkedBy.length > 0 || e.normalModeOnly !== null).toBe(true);
      for (const fn of e.checkedBy) expect(typeof (validate as unknown as Record<string, unknown>)[fn]).toBe('function');
    }
  });
});

describe('verifyCommitment', () => {
  let dir = '';
  afterEach(async () => {
    if (dir !== '') await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  async function setup() {
    dir = await mkdtemp(join(tmpdir(), 's45-commit-'));
    const held = join(dir, 'release');
    await mkdir(join(held, 'inputs'), { recursive: true });
    await mkdir(join(held, 'labels'), { recursive: true });
    const inputBytes = '{"schema":"s45.change/1","id":"hc1","files":[]}';
    const labelBytes = '{"schema":"s45.label/1"}';
    await writeFile(join(held, 'inputs', 'hc1.json'), inputBytes);
    await writeFile(join(held, 'labels', 'hc1.json'), labelBytes);
    const files = { 'heldout/inputs/hc1.json': h(inputBytes), 'heldout/labels/hc1.json': h(labelBytes) };
    const manifest = { ...makeFixture().manifest, files };
    const manifestText = JSON.stringify(manifest);
    await writeFile(join(dir, 'manifest.json'), manifestText);
    const commitment = {
      schema: 's45.heldout-commitment/1',
      edition: manifest.edition,
      authorSession: manifest.authorSession,
      manifestSha256: h(manifestText),
      splitSeed: 45,
      placementSeed: 450045,
      siteInventoryHash: manifest.siteInventoryHash,
      files,
    };
    await writeFile(join(dir, 'heldout.commitment.json'), JSON.stringify(commitment));
    return { held, commitmentPath: join(dir, 'heldout.commitment.json'), manifestPath: join(dir, 'manifest.json') };
  }

  it('passes on matching bytes', async () => {
    const { held, commitmentPath, manifestPath } = await setup();
    expect(failed(await verifyCommitment(commitmentPath, manifestPath, held))).toEqual([]);
  });

  it('fails on a changed byte and on an unlisted file', async () => {
    const { held, commitmentPath, manifestPath } = await setup();
    await writeFile(join(held, 'labels', 'hc1.json'), '{"schema":"s45.label/1" }');
    await writeFile(join(held, 'extra.txt'), 'x');
    const f = failed(await verifyCommitment(commitmentPath, manifestPath, held));
    expect(f).toEqual(['7.3.3 commitment.file-hashes', '7.3.3 commitment.no-extra-files']);
  });

  it('allows missing label files only when asked (inputs-only release)', async () => {
    const { held, commitmentPath, manifestPath } = await setup();
    await rm(join(held, 'labels'), { recursive: true });
    expect(failed(await verifyCommitment(commitmentPath, manifestPath, held))).toEqual(['7.3.3 commitment.file-hashes']);
    expect(failed(await verifyCommitment(commitmentPath, manifestPath, held, { allowMissing: true }))).toEqual([]);
  });

  it('fails when the manifest bytes change after commitment', async () => {
    const { held, commitmentPath, manifestPath } = await setup();
    await writeFile(manifestPath, JSON.stringify({ ...makeFixture().manifest, files: {} }));
    expect(failed(await verifyCommitment(commitmentPath, manifestPath, held))).toContain('7.3.3 commitment.manifest-binding');
  });
});
