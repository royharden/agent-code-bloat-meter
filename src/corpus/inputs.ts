// plan 7.4 / 7.5 / 9 M2: the analysis side of the own corpus. Reads the edition manifest and the change inputs of one
// split, verifying every byte against the manifest (and, for the held-out split, against the commitment) before
// yielding anything. This module imports no label type and never reads a label file (plan 9 G4): analysis code
// (cli, demo, tune's analysis step) imports OwnCorpusInputs / readInputs from here, never from own-source.ts.
//
// Delivery layout (corpus-author-packet DELIVERABLES.md; corpus/heldout.commitment.README.md):
//   <corpusDir>/manifest.json               CorpusManifestV1 for the whole edition (both splits)
//   <corpusDir>/heldout.commitment.json     HeldoutCommitmentV1
//   <corpusDir>/dev/inputs/<changeId>.json  ChangeV1     (manifest key  dev/inputs/<changeId>.json)
//   <released heldout dir>/inputs/<id>.json ChangeV1     (manifest key  heldout/inputs/<id>.json)
// The held-out split is read only from a released scratch copy supplied by the caller (plan 7.5, P6 step 3); a
// path inside the outer `sealed\` custody folder is refused.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ChangeV1, CorpusManifestV1, Split } from './contract';
import { CorpusIntegrityError, CorpusUnavailable } from './port';
import type { CorpusInputsPort, HeldoutCommitmentV1 } from './port';

export const SPLITS: readonly Split[] = ['dev', 'heldout'];

/** Root and change ids double as file names: one safe segment, no dots, no separators. */
export const CORPUS_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const MANIFEST_FILE = 'manifest.json';
export const COMMITMENT_FILE = 'heldout.commitment.json';

/** Lowercase hex sha256 of exact bytes (strings are hashed as UTF-8). */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function isCorpusId(value: unknown): value is string {
  return typeof value === 'string' && CORPUS_ID_PATTERN.test(value);
}

/**
 * A manifest/commitment file key: a relative POSIX path whose first segment is the split (`dev/` or `heldout/`),
 * with no empty, `.` or `..` segment, no backslash, drive, NUL or leading slash.
 */
export function isSplitFileKey(key: string): boolean {
  if (key.length === 0 || key.includes('\\') || key.includes('\u0000') || key.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(key)) return false;
  const segments = key.split('/');
  if (segments.length < 2) return false;
  if (segments[0] !== 'dev' && segments[0] !== 'heldout') return false;
  return segments.every((s) => s.length > 0 && s !== '.' && s !== '..');
}

/** Manifest key of a per-change file, e.g. `dev/inputs/<id>.json`. */
export function changeFileKey(split: Split, folder: string, changeId: string): string {
  return `${split}/${folder}/${changeId}.json`;
}

/** UTF-8 decode that rejects invalid sequences instead of substituting U+FFFD. */
export function decodeUtf8(bytes: Uint8Array, where: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CorpusIntegrityError(`not valid UTF-8: ${where}`, where);
  }
}

export function parseJsonBytes(bytes: Uint8Array, where: string): unknown {
  const text = decodeUtf8(bytes, where);
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new CorpusIntegrityError(`invalid JSON in ${where}: ${(err as Error).message}`, where);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Minimal structural check of a manifest, enough to read files safely. `validateManifest` (validate.ts) adds the
 * full plan 7.4 schema checks. Returns problems; empty means usable.
 */
export function checkManifestShape(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ['manifest is not a JSON object'];
  if (value.schema !== 's45.corpus/1') problems.push(`manifest.schema must be 's45.corpus/1'`);
  if (!Array.isArray(value.roots)) problems.push('manifest.roots must be an array');
  else
    value.roots.forEach((r, i) => {
      if (!isRecord(r) || !isCorpusId(r.id)) problems.push(`manifest.roots[${i}].id is not a safe corpus id`);
      else if (r.split !== 'dev' && r.split !== 'heldout') problems.push(`manifest.roots[${i}].split is invalid`);
    });
  if (!Array.isArray(value.changes)) problems.push('manifest.changes must be an array');
  else
    value.changes.forEach((c, i) => {
      if (!isRecord(c) || !isCorpusId(c.id)) problems.push(`manifest.changes[${i}].id is not a safe corpus id`);
      else if (!isCorpusId(c.rootId)) problems.push(`manifest.changes[${i}].rootId is not a safe corpus id`);
      else {
        if (typeof c.inputHash !== 'string' || !SHA256_PATTERN.test(c.inputHash))
          problems.push(`manifest.changes[${i}].inputHash is not sha256 hex`);
        if (typeof c.labelHash !== 'string' || !SHA256_PATTERN.test(c.labelHash))
          problems.push(`manifest.changes[${i}].labelHash is not sha256 hex`);
      }
    });
  if (!isRecord(value.files)) problems.push('manifest.files must be an object');
  else
    for (const [key, hash] of Object.entries(value.files)) {
      if (!isSplitFileKey(key)) problems.push(`manifest.files key is not a split file key: ${JSON.stringify(key)}`);
      if (typeof hash !== 'string' || !SHA256_PATTERN.test(hash))
        problems.push(`manifest.files[${JSON.stringify(key)}] is not sha256 hex`);
    }
  return problems;
}

/** Structural check of `heldout.commitment.json`. Returns problems; empty means well-formed. */
export function checkCommitmentShape(value: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(value)) return ['commitment is not a JSON object'];
  const allowed = new Set([
    'schema',
    'edition',
    'authorSession',
    'manifestSha256',
    'splitSeed',
    'placementSeed',
    'siteInventoryHash',
    'files',
  ]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) problems.push(`commitment has unknown field ${key}`);
  if (value.schema !== 's45.heldout-commitment/1') problems.push(`commitment.schema must be 's45.heldout-commitment/1'`);
  if (typeof value.edition !== 'string' || value.edition.length === 0) problems.push('commitment.edition is empty');
  if (typeof value.authorSession !== 'string' || value.authorSession.length === 0)
    problems.push('commitment.authorSession is empty');
  if (typeof value.manifestSha256 !== 'string' || !SHA256_PATTERN.test(value.manifestSha256))
    problems.push('commitment.manifestSha256 is not sha256 hex');
  if (value.splitSeed !== 45) problems.push('commitment.splitSeed must be 45');
  if (value.placementSeed !== 450045) problems.push('commitment.placementSeed must be 450045');
  if (typeof value.siteInventoryHash !== 'string' || !SHA256_PATTERN.test(value.siteInventoryHash))
    problems.push('commitment.siteInventoryHash is not sha256 hex');
  if (!isRecord(value.files)) problems.push('commitment.files must be an object');
  else {
    const entries = Object.entries(value.files);
    if (entries.length === 0) problems.push('commitment.files is empty');
    for (const [key, hash] of entries) {
      if (!isSplitFileKey(key) || !key.startsWith('heldout/'))
        problems.push(`commitment.files key is not a heldout/ file key: ${JSON.stringify(key)}`);
      if (typeof hash !== 'string' || !SHA256_PATTERN.test(hash))
        problems.push(`commitment.files[${JSON.stringify(key)}] is not sha256 hex`);
    }
  }
  return problems;
}

/** plan 7.5: readers never open the sealed custody folder directly; only a released scratch copy. */
export function assertNotSealedPath(dir: string): void {
  const segments = resolve(dir).split(/[\\/]+/);
  if (segments.some((s) => s.toLowerCase() === 'sealed')) {
    throw new CorpusIntegrityError(
      `refusing to read held-out data from inside a 'sealed' folder (${dir}); pass the released scratch copy`,
      dir,
    );
  }
}

/** Map a manifest key (`<split>/rest`) to a file inside that split's directory, refusing any escape. */
export function resolveSplitFile(splitDir: string, split: Split, key: string): string {
  if (!isSplitFileKey(key) || !key.startsWith(`${split}/`)) {
    throw new CorpusIntegrityError(`key ${JSON.stringify(key)} is not a ${split}/ file key`, key);
  }
  const base = resolve(splitDir);
  const target = resolve(join(base, ...key.slice(split.length + 1).split('/')));
  const rel = relative(base, target);
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
    throw new CorpusIntegrityError(`key ${JSON.stringify(key)} escapes ${splitDir}`, key);
  }
  return target;
}

/** Read a file and require its sha256 to equal every expected hash given (all must agree). */
export async function readVerified(filePath: string, expected: readonly string[], label: string): Promise<Uint8Array> {
  if (expected.length === 0) throw new CorpusIntegrityError(`no expected hash for ${label}`, label);
  let bytes: Uint8Array;
  try {
    bytes = await readFile(filePath);
  } catch (err) {
    throw new CorpusIntegrityError(`cannot read ${label} (${filePath}): ${(err as Error).message}`, label);
  }
  const actual = sha256Hex(bytes);
  for (const want of expected) {
    if (want !== actual) {
      throw new CorpusIntegrityError(`sha256 mismatch for ${label}: expected ${want}, got ${actual}`, label);
    }
  }
  return bytes;
}

export interface OwnCorpusOptions {
  /**
   * The repo's `corpus/` directory. After Gate 1 it holds `manifest.json`, `dev/` and `heldout.commitment.json`;
   * before Gate 1 it holds READMEs only and every read throws CorpusUnavailable.
   */
  corpusDir: string;
  /**
   * Released scratch copy of the held-out split (contents of the sealed `heldout\` folder, copied out by the P6
   * session after the freeze and the exclusive attempt record). Required for held-out reads; never `sealed\` itself.
   */
  heldoutReleaseDir?: string;
}

interface LoadedManifest {
  manifest: CorpusManifestV1;
  sha256: string;
}

/**
 * Shared reader for both sides. Owns path resolution, the manifest, the commitment binding and per-file
 * verification. It reads whatever per-change folder it is asked for; the label side (own-source.ts) is the only
 * caller that asks for anything other than `inputs`.
 */
export class OwnCorpusFiles {
  readonly corpusDir: string;
  readonly heldoutReleaseDir: string | null;
  private manifestPromise: Promise<LoadedManifest> | null = null;
  private commitmentPromise: Promise<HeldoutCommitmentV1> | null = null;

  constructor(options: OwnCorpusOptions) {
    this.corpusDir = options.corpusDir;
    this.heldoutReleaseDir = options.heldoutReleaseDir ?? null;
    if (this.heldoutReleaseDir !== null) assertNotSealedPath(this.heldoutReleaseDir);
  }

  loadManifest(): Promise<LoadedManifest> {
    this.manifestPromise ??= this.readManifest();
    return this.manifestPromise;
  }

  private async readManifest(): Promise<LoadedManifest> {
    const file = join(this.corpusDir, MANIFEST_FILE);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(file);
    } catch {
      throw new CorpusUnavailable(
        's45-own',
        `no corpus manifest at ${file}: the corpus is admitted only after Gate 1 (PENDING, ROY-DECISIONS-REQUEST R1)`,
      );
    }
    const value = parseJsonBytes(bytes, MANIFEST_FILE);
    const problems = checkManifestShape(value);
    if (problems.length > 0) throw new CorpusIntegrityError(`manifest invalid: ${problems.join('; ')}`, MANIFEST_FILE);
    return { manifest: value as CorpusManifestV1, sha256: sha256Hex(bytes) };
  }

  loadCommitment(): Promise<HeldoutCommitmentV1> {
    this.commitmentPromise ??= this.readCommitment();
    return this.commitmentPromise;
  }

  private async readCommitment(): Promise<HeldoutCommitmentV1> {
    const file = join(this.corpusDir, COMMITMENT_FILE);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(file);
    } catch {
      throw new CorpusUnavailable('s45-own', `no held-out commitment at ${file}`);
    }
    const value = parseJsonBytes(bytes, COMMITMENT_FILE);
    const problems = checkCommitmentShape(value);
    if (problems.length > 0) {
      throw new CorpusIntegrityError(`commitment invalid: ${problems.join('; ')}`, COMMITMENT_FILE);
    }
    return value as HeldoutCommitmentV1;
  }

  /** The directory holding a split's files; held-out requires a released copy. */
  splitDir(split: Split): string {
    if (split === 'dev') return join(this.corpusDir, 'dev');
    if (this.heldoutReleaseDir === null) {
      throw new CorpusUnavailable(
        's45-own',
        'held-out split not released: pass heldoutReleaseDir (a released scratch copy, never sealed\\) after the freeze',
      );
    }
    return this.heldoutReleaseDir;
  }

  /** Change ids of one split in ascending ordinal order (label-neutral; manifest order is not exposed). */
  async changeIds(split: Split): Promise<string[]> {
    const { manifest } = await this.loadManifest();
    const rootSplit = new Map<string, Split>();
    for (const root of manifest.roots) rootSplit.set(root.id, root.split);
    const ids: string[] = [];
    for (const change of manifest.changes) {
      const s = rootSplit.get(change.rootId);
      if (s === undefined) {
        throw new CorpusIntegrityError(`change ${change.id} names unknown root ${change.rootId}`, MANIFEST_FILE);
      }
      if (s === split) ids.push(change.id);
    }
    return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /**
   * Read and verify every per-change file of `folder` for one split, before returning any of them. Each file must
   * match `manifest.files[key]` and the per-change hash `pick(change)`; held-out files must also match the
   * commitment, and the manifest itself must match `commitment.manifestSha256`.
   */
  async readChangeFiles(
    split: Split,
    folder: string,
    pick: (change: CorpusManifestV1['changes'][number]) => string,
  ): Promise<{ id: string; key: string; bytes: Uint8Array }[]> {
    const dir = this.splitDir(split);
    const { manifest, sha256: manifestSha } = await this.loadManifest();
    let committed: Record<string, string> | null = null;
    if (split === 'heldout') {
      const commitment = await this.loadCommitment();
      if (commitment.manifestSha256 !== manifestSha) {
        throw new CorpusIntegrityError(
          `manifest.json sha256 ${manifestSha} does not match commitment.manifestSha256 ${commitment.manifestSha256}`,
          MANIFEST_FILE,
        );
      }
      committed = commitment.files;
    }
    const byId = new Map(manifest.changes.map((c) => [c.id, c]));
    const out: { id: string; key: string; bytes: Uint8Array }[] = [];
    for (const id of await this.changeIds(split)) {
      const change = byId.get(id);
      if (change === undefined) throw new CorpusIntegrityError(`change ${id} vanished from manifest`, MANIFEST_FILE);
      const key = changeFileKey(split, folder, id);
      const listed = manifest.files[key];
      if (listed === undefined) throw new CorpusIntegrityError(`manifest.files has no entry for ${key}`, key);
      const expected = [listed, pick(change)];
      if (committed !== null) {
        const c = committed[key];
        if (c === undefined) throw new CorpusIntegrityError(`commitment.files has no entry for ${key}`, key);
        expected.push(c);
      }
      const bytes = await readVerified(resolveSplitFile(dir, split, key), expected, key);
      out.push({ id, key, bytes });
    }
    return out;
  }
}

/** Shape check for one ChangeV1 payload (path safety and limits are src/core/safety's job, plan 6.1). */
export function checkChangeShape(value: unknown, expectedId: string): string[] {
  if (!isRecord(value)) return ['change is not a JSON object'];
  const problems: string[] = [];
  if (value.schema !== 's45.change/1') problems.push(`schema must be 's45.change/1'`);
  if (value.id !== expectedId) problems.push(`id ${JSON.stringify(value.id)} does not match manifest id ${expectedId}`);
  if (!Array.isArray(value.files)) problems.push('files must be an array');
  else
    value.files.forEach((f, i) => {
      if (!isRecord(f)) {
        problems.push(`files[${i}] is not an object`);
        return;
      }
      if (typeof f.path !== 'string' || f.path.length === 0) problems.push(`files[${i}].path is empty`);
      const baseOk = f.base === null || typeof f.base === 'string';
      const headOk = f.head === null || typeof f.head === 'string';
      if (!baseOk || !headOk) problems.push(`files[${i}] base/head must be string or null`);
      if (f.base === null && f.head === null) problems.push(`files[${i}] has neither base nor head`);
    });
  return problems;
}

/**
 * plan 7.4 analysis side of `OwnCorpusSource`: manifest and inputs only. Analysis code uses this class (or
 * `readInputs`) so that it never depends on the label side.
 */
export class OwnCorpusInputs implements CorpusInputsPort {
  protected readonly reader: OwnCorpusFiles;

  constructor(options: OwnCorpusOptions) {
    this.reader = new OwnCorpusFiles(options);
  }

  async manifest(): Promise<CorpusManifestV1> {
    return (await this.reader.loadManifest()).manifest;
  }

  /** Every input of the split is hash-verified before the first one is yielded. Order: change id ascending. */
  async *inputs(split: Split): AsyncIterable<ChangeV1> {
    const verified = await this.reader.readChangeFiles(split, 'inputs', (c) => c.inputHash);
    const parsed: ChangeV1[] = [];
    for (const { id, key, bytes } of verified) {
      const value = parseJsonBytes(bytes, key);
      const problems = checkChangeShape(value, id);
      if (problems.length > 0) throw new CorpusIntegrityError(`${key}: ${problems.join('; ')}`, key);
      parsed.push(value as ChangeV1);
    }
    yield* parsed;
  }
}

/** Convenience: collect one split's verified inputs. */
export async function readInputs(options: OwnCorpusOptions, split: Split): Promise<ChangeV1[]> {
  const source = new OwnCorpusInputs(options);
  const out: ChangeV1[] = [];
  for await (const change of source.inputs(split)) out.push(change);
  return out;
}
