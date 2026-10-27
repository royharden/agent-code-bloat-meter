// plan 9 M2: OwnCorpusInputs / OwnCorpusSource / S41CorpusSource. Written, never run in Dirty Mode.
// ENGINEERING FIXTURE ONLY: tiny shape-only records written to an OS temp directory, never to corpus/.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChangeV1, CorpusManifestV1, LabelV1 } from '../src/corpus/contract';
import { OwnCorpusInputs, readInputs, sha256Hex } from '../src/corpus/inputs';
import { OwnCorpusSource, readLabels } from '../src/corpus/own-source';
import { CorpusIntegrityError, CorpusUnavailable } from '../src/corpus/port';
import { S41CorpusSource } from '../src/corpus/s41-source';

let dir = '';
afterEach(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true });
  dir = '';
});

const change = (id: string): ChangeV1 => ({
  schema: 's45.change/1',
  id,
  files: [{ path: 'src/mod.ts', base: 'export const a = 1;\n', head: 'export const a = 2;\n' }],
});

const label = (id: string, rootId: string, split: 'dev' | 'heldout'): LabelV1 => ({
  schema: 's45.label/1',
  changeId: id,
  rootId,
  split,
  kind: 'clean',
  cleanWitnesses: [{ path: 'w.test.ts', headPassHash: sha256Hex('w') }],
  baseSanityReceipts: [],
});

/** corpus/ with dev (2 changes) and a released held-out copy (1 change) outside any 'sealed' folder. */
async function setup() {
  dir = await mkdtemp(join(tmpdir(), 's45-corpus-'));
  const corpusDir = join(dir, 'corpus');
  const releaseDir = join(dir, 'release', 'heldout');
  const plan: { id: string; rootId: string; split: 'dev' | 'heldout' }[] = [
    { id: 'zz2', rootId: 'r1', split: 'dev' },
    { id: 'aa1', rootId: 'r1', split: 'dev' },
    { id: 'hh1', rootId: 'r2', split: 'heldout' },
  ];
  const files: Record<string, string> = {};
  const changes: CorpusManifestV1['changes'] = [];
  for (const p of plan) {
    const splitDir = p.split === 'dev' ? join(corpusDir, 'dev') : releaseDir;
    await mkdir(join(splitDir, 'inputs'), { recursive: true });
    await mkdir(join(splitDir, 'labels'), { recursive: true });
    const inputText = JSON.stringify(change(p.id));
    const labelText = JSON.stringify(label(p.id, p.rootId, p.split));
    await writeFile(join(splitDir, 'inputs', `${p.id}.json`), inputText);
    await writeFile(join(splitDir, 'labels', `${p.id}.json`), labelText);
    files[`${p.split}/inputs/${p.id}.json`] = sha256Hex(inputText);
    files[`${p.split}/labels/${p.id}.json`] = sha256Hex(labelText);
    changes.push({ id: p.id, rootId: p.rootId, inputHash: sha256Hex(inputText), labelHash: sha256Hex(labelText) });
  }
  const manifest: CorpusManifestV1 = {
    schema: 's45.corpus/1',
    source: 's45-own',
    edition: 'e1',
    authorSession: 'author',
    authorHarness: 'harness',
    authorModel: 'model',
    custodianSession: 'author',
    licence: 'MIT',
    recipeHash: sha256Hex('r'),
    familyListHash: sha256Hex('f'),
    siteInventoryHash: sha256Hex('i'),
    splitSeed: 45,
    placementSeed: 450045,
    roots: [
      { id: 'r1', split: 'dev', tsx: false },
      { id: 'r2', split: 'heldout', tsx: true },
    ],
    changes,
    files,
  };
  const manifestText = JSON.stringify(manifest);
  await writeFile(join(corpusDir, 'manifest.json'), manifestText);
  const heldoutFiles = Object.fromEntries(Object.entries(files).filter(([k]) => k.startsWith('heldout/')));
  await writeFile(
    join(corpusDir, 'heldout.commitment.json'),
    JSON.stringify({
      schema: 's45.heldout-commitment/1',
      edition: 'e1',
      authorSession: 'author',
      manifestSha256: sha256Hex(manifestText),
      splitSeed: 45,
      placementSeed: 450045,
      siteInventoryHash: manifest.siteInventoryHash,
      files: heldoutFiles,
    }),
  );
  return { corpusDir, releaseDir };
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe('OwnCorpusInputs (analysis side)', () => {
  it('throws CorpusUnavailable before Gate 1 (no manifest)', async () => {
    dir = await mkdtemp(join(tmpdir(), 's45-empty-'));
    const src = new OwnCorpusInputs({ corpusDir: dir });
    await expect(src.manifest()).rejects.toBeInstanceOf(CorpusUnavailable);
    await expect(collect(src.inputs('dev'))).rejects.toBeInstanceOf(CorpusUnavailable);
  });

  it('yields verified dev inputs in ascending id order', async () => {
    const { corpusDir } = await setup();
    const ids = (await readInputs({ corpusDir }, 'dev')).map((c) => c.id);
    expect(ids).toEqual(['aa1', 'zz2']);
  });

  it('yields nothing when any input of the split is tampered with', async () => {
    const { corpusDir } = await setup();
    await writeFile(join(corpusDir, 'dev', 'inputs', 'zz2.json'), JSON.stringify(change('zz2')) + ' ');
    const seen: string[] = [];
    const run = async () => {
      for await (const c of new OwnCorpusInputs({ corpusDir }).inputs('dev')) seen.push(c.id);
    };
    await expect(run()).rejects.toBeInstanceOf(CorpusIntegrityError);
    expect(seen).toEqual([]);
  });

  it('requires a released copy for held-out and refuses a sealed path', async () => {
    const { corpusDir, releaseDir } = await setup();
    await expect(collect(new OwnCorpusInputs({ corpusDir }).inputs('heldout'))).rejects.toBeInstanceOf(CorpusUnavailable);
    expect(() => new OwnCorpusInputs({ corpusDir, heldoutReleaseDir: join(dir, 'sealed', 'heldout') })).toThrow(
      CorpusIntegrityError,
    );
    const ids = (await readInputs({ corpusDir, heldoutReleaseDir: releaseDir }, 'heldout')).map((c) => c.id);
    expect(ids).toEqual(['hh1']);
  });

  it('refuses held-out reads when the manifest no longer matches the commitment', async () => {
    const { corpusDir, releaseDir } = await setup();
    const path = join(corpusDir, 'manifest.json');
    await writeFile(path, (await readFile(path, 'utf8')) + '\n');
    await expect(readInputs({ corpusDir, heldoutReleaseDir: releaseDir }, 'heldout')).rejects.toBeInstanceOf(
      CorpusIntegrityError,
    );
  });

  it('the inputs module names no label type (plan 9 G4)', async () => {
    const text = await readFile(new URL('../src/corpus/inputs.ts', import.meta.url), 'utf8');
    expect(text).not.toMatch(/\bLabelV1\b/);
    expect(text).not.toMatch(/from '\.\/(own-source|validate)'/);
  });
});

describe('OwnCorpusSource (scorer side)', () => {
  it('reads verified labels of the split', async () => {
    const { corpusDir, releaseDir } = await setup();
    const dev = await readLabels({ corpusDir }, 'dev');
    expect(dev.map((l) => l.changeId)).toEqual(['aa1', 'zz2']);
    const held = await readLabels({ corpusDir, heldoutReleaseDir: releaseDir }, 'heldout');
    expect(held.map((l) => l.changeId)).toEqual(['hh1']);
  });

  it('rejects a label whose bytes differ from the commitment', async () => {
    const { corpusDir, releaseDir } = await setup();
    await writeFile(join(releaseDir, 'labels', 'hh1.json'), JSON.stringify(label('hh1', 'r2', 'dev')));
    const src = new OwnCorpusSource({ corpusDir, heldoutReleaseDir: releaseDir });
    await expect(collect(src.labels('heldout'))).rejects.toBeInstanceOf(CorpusIntegrityError);
  });
});

describe('S41CorpusSource', () => {
  it('throws CorpusUnavailable from every method', () => {
    const s41 = new S41CorpusSource();
    expect(() => s41.manifest()).toThrow(CorpusUnavailable);
    expect(() => s41.inputs('dev')).toThrow(CorpusUnavailable);
    expect(() => s41.labels('heldout')).toThrow(CorpusUnavailable);
  });
});
