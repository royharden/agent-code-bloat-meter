// plan 7.3 / 7.4 / D34 / D36 / 9 M2: file-checkable Gate 1 predicates and the post-release atom check.
// SCORER SIDE: this module reads labels (plan 9 G4 allows src/corpus). It never executes corpus code or witnesses:
// predicates that need execution or a registry/session lookup are listed in GATE1_PREDICATE_MAP as Normal-mode only.
//
// Every check returns PredicateResult[]; a run passes only if every result is ok. Results never throw for bad data
// (they report it); they throw only for programming errors.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Atom, ChangeV1, CorpusManifestV1, Family, LabelV1, Split } from './contract';
import {
  CORPUS_ID_PATTERN,
  SHA256_PATTERN,
  checkCommitmentShape,
  checkManifestShape,
  isSplitFileKey,
  sha256Hex,
} from './inputs';
import type { HeldoutCommitmentV1 } from './port';

export interface PredicateResult {
  /** Plan item and check name, e.g. `7.3.2 counts.roots`. */
  predicate: string;
  ok: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Protocol constants (plan 7.2, 7.3, docs/FAMILIES.md, docs/TRAPS.md)
// ---------------------------------------------------------------------------------------------------------------

export const FAMILIES: readonly Family[] = [
  'boundary',
  'null_optional',
  'await_ordering',
  'authz_weakened',
  'validation_escaping',
  'error_swallowed_mismapped',
  'state_cache_lifecycle',
  'logic_value',
];

export const TRAP_IDS = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'] as const;

/** plan 7.3 predicate 2 (counts per split). */
export const GATE1_COUNTS = {
  rootsPerSplit: 20,
  tsxRootsMinPerSplit: 4,
  changesPerSplit: 80,
  cleanPerSplit: 20,
  defectsPerSplit: 40,
  defectsPerFamilyPerSplit: 5,
  defectsPerRoot: 2,
  nearMissPerSplit: 20,
  trapMinPerSplit: 2,
  baseDeletionMinPerSplit: 1,
} as const;

/** plan 7.3 predicate 4 / D18: dev median(defect atoms / clean twin atoms) must lie in this closed interval. */
export const SIZE_BALANCE_RANGE = { min: 0.67, max: 1.5 } as const;

type AnchorKind = NonNullable<LabelV1['defect']>['anchorKind'];

/** docs/FAMILIES.md section 2: operator id -> family and allowed anchor kinds. */
export const OPERATORS: Readonly<Record<string, { family: Family; anchorKinds: readonly AnchorKind[] }>> = {
  'boundary.flip-inclusive': { family: 'boundary', anchorKinds: ['edited'] },
  'boundary.index-plus-one': { family: 'boundary', anchorKinds: ['edited'] },
  'boundary.index-minus-one': { family: 'boundary', anchorKinds: ['edited'] },
  'null_optional.delete-guard': { family: 'null_optional', anchorKinds: ['r-del-gap', 'base-deletion'] },
  'null_optional.optional-chain-to-dot': { family: 'null_optional', anchorKinds: ['edited'] },
  'await_ordering.remove-await': { family: 'await_ordering', anchorKinds: ['edited'] },
  'await_ordering.swap-awaited': { family: 'await_ordering', anchorKinds: ['edited'] },
  'authz_weakened.delete-guard': { family: 'authz_weakened', anchorKinds: ['r-del-gap', 'base-deletion'] },
  'validation_escaping.unwrap-call': { family: 'validation_escaping', anchorKinds: ['edited'] },
  'error_swallowed_mismapped.empty-catch': { family: 'error_swallowed_mismapped', anchorKinds: ['edited'] },
  'error_swallowed_mismapped.remap-error-class': { family: 'error_swallowed_mismapped', anchorKinds: ['edited'] },
  'state_cache_lifecycle.delete-release': {
    family: 'state_cache_lifecycle',
    anchorKinds: ['r-del-gap', 'base-deletion'],
  },
  'state_cache_lifecycle.change-key-part': { family: 'state_cache_lifecycle', anchorKinds: ['edited'] },
  'logic_value.negate-condition': { family: 'logic_value', anchorKinds: ['edited'] },
  'logic_value.swap-and-or': { family: 'logic_value', anchorKinds: ['edited'] },
  'logic_value.replace-constant': { family: 'logic_value', anchorKinds: ['edited'] },
};

/** docs/FAMILIES.md C10: the only signature-bearing operator. */
export const SIGNATURE_BEARING_OPERATOR = 'error_swallowed_mismapped.empty-catch';

// ---------------------------------------------------------------------------------------------------------------
// Gate 1 predicate map (plan 9 M2 acceptance: each 7.3 predicate maps to a function or is Normal-mode only)
// ---------------------------------------------------------------------------------------------------------------

export interface Gate1PredicateEntry {
  item: string;
  text: string;
  /** Functions in this module that check the file-checkable part. */
  checkedBy: readonly string[];
  /** What cannot be decided from files alone (null when fully file-checkable). */
  normalModeOnly: string | null;
}

export const GATE1_PREDICATE_MAP: readonly Gate1PredicateEntry[] = [
  {
    item: '7.3.1',
    text: 'witness passes on clean twin and fails on defect head at the named test; base-sanity passes on base; clean heads and near-misses pass all witnesses; equivalent mutants listed',
    checkedBy: ['checkReceiptReferences', 'checkDeliveredTestIdentity'],
    normalModeOnly:
      'C1 check-data and the independent gate operator must run checkReceiptReferences and checkDeliveredTestIdentity, hash the actual delivered test bytes against manifest.files/testHash, and reconstruct each executed source tree to verify sourceHash. Actual execution and named-test selection are independently rechecked in Normal mode; receipt agreement alone does not prove execution. Equivalent mutants are listed in each placement record (rejected, reason equivalent); reading that list is a gate-operator step.',
  },
  {
    item: '7.3.2',
    text: 'counts per split (20 roots, 20 clean, 40 defects with 5 per family, 20 near-misses, each trap >= 2, >= 4 TSX roots, >= 1 base-deletion); every input parses (D35); payloads include the whole root module tree (D36)',
    checkedBy: ['checkCounts', 'checkWholeRootTree'],
    normalModeOnly:
      'the D35 parse check needs the pinned typescript package (createSourceFile) and runs in Normal mode, by C1 check-data and by the product analyser',
  },
  {
    item: '7.3.3',
    text: 'schemas validate; no split overlap; commitment hashes verify; provenance lists C1 harness/model/session id; C1 session differs from every builder session (AgentNamer registry)',
    checkedBy: ['validateManifest', 'validateLabels', 'checkSplitOverlap', 'verifyCommitment', 'checkAuthorIndependence'],
    normalModeOnly:
      'full JSON Schema 2020-12 validation with a validator package (deferred: DV-M1-07); reading the AgentNamer registry to obtain the builder session list (gate operator, Normal mode); normalised-fingerprint near-duplicate detection across splits (C1 harness)',
  },
  {
    item: '7.3.4',
    text: 'dev size balance in [0.67, 1.5]; family-eligibility counts published',
    checkedBy: ['checkSizeBalance'],
    normalModeOnly:
      'checkSizeBalance needs per-change atoms (src/core atoms or C1 harness, Normal mode run of the pinned diff). Family-eligibility counts are a C1 publication the gate operator checks for presence and agreement with the site inventory',
  },
  {
    item: '7.3.5',
    text: "C1's independent worksheet (plan 8.6: budget 0, cut hunk, R-del gap, replacement block, equal primary keys resolved by tie key) delivered",
    checkedBy: [],
    normalModeOnly: 'gate operator confirms delivery and coverage of the five properties; not file-checkable by code',
  },
  {
    item: '7.3.6',
    text: 'every requiredAtoms entry of every admitted defect is an atom of its own change under docs/ATOMS.md (D34); product lockfile pins the same diff version',
    checkedBy: ['checkRequiredAtomsExist'],
    normalModeOnly:
      'producing the atoms needs the pinned diff package (Normal mode); the lockfile/version comparison needs an install (DV-M1-01, DV-M1-06)',
  },
];

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------

const MAX_LISTED = 40;

function result(predicate: string, problems: readonly string[], okDetail: string): PredicateResult {
  if (problems.length === 0) return { predicate, ok: true, detail: okDetail };
  const shown = problems.slice(0, MAX_LISTED).join('; ');
  const more = problems.length > MAX_LISTED ? ` (+${problems.length - MAX_LISTED} more)` : '';
  return { predicate, ok: false, detail: `${problems.length} problem(s): ${shown}${more}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSha(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function extraKeys(obj: Record<string, unknown>, allowed: readonly string[]): string[] {
  const set = new Set(allowed);
  return Object.keys(obj).filter((k) => !set.has(k));
}

export function atomKey(atom: Atom): string {
  return `${atom.path}\u0000${atom.side}\u0000${atom.line}`;
}

function rootSplitMap(manifest: CorpusManifestV1): Map<string, Split> {
  const map = new Map<string, Split>();
  for (const r of manifest.roots) map.set(r.id, r.split);
  return map;
}

/**
 * Canonical JSON used for receipt self-hashes (corpus-author-packet DELIVERABLES.md): object keys sorted by UTF-16
 * code unit order at every depth, arrays in order, no whitespace, standard JSON.stringify escaping.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------------------------------------------
// 7.3.3 schemas: manifest
// ---------------------------------------------------------------------------------------------------------------

const MANIFEST_KEYS = [
  'schema',
  'source',
  'edition',
  'authorSession',
  'authorHarness',
  'authorModel',
  'custodianSession',
  'licence',
  'recipeHash',
  'familyListHash',
  'siteInventoryHash',
  'splitSeed',
  'placementSeed',
  'roots',
  'changes',
  'files',
] as const;

export interface ManifestExpectations {
  /** sha256 of the recipe edition C1 declares (default: the packet's docs/DATA.md bytes). */
  recipeHash?: string;
  /** sha256 of the packet's docs/FAMILIES.md bytes. */
  familyListHash?: string;
}

/**
 * plan 7.4 / schemas/corpus-manifest.schema.json, plus the delivery-layout rules: ids are safe file names, every
 * change's `<split>/inputs/<id>.json` and `<split>/labels/<id>.json` are listed in `files` with the same hashes as
 * `inputHash`/`labelHash`, and every `files` key lies under its split.
 */
export function validateManifest(manifest: unknown, expected: ManifestExpectations = {}): PredicateResult[] {
  const out: PredicateResult[] = [];
  const shape = checkManifestShape(manifest);
  if (!isRecord(manifest) || shape.length > 0) {
    out.push(result('7.3.3 schema.manifest', shape.length > 0 ? shape : ['not an object'], ''));
    return out;
  }
  const m = manifest;
  const problems: string[] = [];
  for (const k of extraKeys(m, MANIFEST_KEYS)) problems.push(`unknown field ${k}`);
  for (const k of MANIFEST_KEYS) if (!(k in m)) problems.push(`missing field ${k}`);
  if (m.source !== 's45-own' && m.source !== 's41-adapter') problems.push('source is invalid');
  for (const k of ['edition', 'authorSession', 'authorHarness', 'authorModel', 'custodianSession'] as const) {
    if (!isNonEmptyString(m[k])) problems.push(`${k} must be a non-empty string`);
  }
  if (m.licence !== 'MIT') problems.push(`licence must be 'MIT'`);
  for (const k of ['recipeHash', 'familyListHash', 'siteInventoryHash'] as const) {
    if (!isSha(m[k])) problems.push(`${k} is not sha256 hex`);
  }
  if (m.splitSeed !== 45) problems.push('splitSeed must be 45');
  if (m.placementSeed !== 450045) problems.push('placementSeed must be 450045');
  const roots = m.roots as unknown[];
  const changes = m.changes as unknown[];
  const rootIds = new Set<string>();
  roots.forEach((r, i) => {
    const rr = r as Record<string, unknown>;
    for (const k of extraKeys(rr, ['id', 'split', 'tsx'])) problems.push(`roots[${i}] unknown field ${k}`);
    if (typeof rr.tsx !== 'boolean') problems.push(`roots[${i}].tsx must be boolean`);
    const id = rr.id as string;
    if (rootIds.has(id)) problems.push(`duplicate root id ${id}`);
    rootIds.add(id);
  });
  const changeIds = new Set<string>();
  changes.forEach((c, i) => {
    const cc = c as Record<string, unknown>;
    for (const k of extraKeys(cc, ['id', 'rootId', 'inputHash', 'labelHash'])) {
      problems.push(`changes[${i}] unknown field ${k}`);
    }
    const id = cc.id as string;
    if (changeIds.has(id)) problems.push(`duplicate change id ${id}`);
    if (rootIds.has(id)) problems.push(`change id ${id} equals a root id`);
    changeIds.add(id);
    if (!rootIds.has(cc.rootId as string)) problems.push(`changes[${i}] names unknown root ${String(cc.rootId)}`);
  });
  out.push(result('7.3.3 schema.manifest', problems, `manifest well-formed: ${roots.length} roots, ${changes.length} changes`));

  out.push(
    result(
      '7.3.3 provenance',
      ['authorSession', 'authorHarness', 'authorModel'].filter((k) => !isNonEmptyString(m[k])).map((k) => `${k} missing`),
      `author ${String(m.authorHarness)} / ${String(m.authorModel)} / session ${String(m.authorSession)}`,
    ),
  );
  out.push(result('7.1 source', m.source === 's45-own' ? [] : [`source is ${String(m.source)}, not s45-own`], 's45-own'));

  // delivery layout coverage
  const typed = manifest as unknown as CorpusManifestV1;
  const splitOf = rootSplitMap(typed);
  const files = typed.files;
  const coverage: string[] = [];
  for (const c of typed.changes) {
    const split = splitOf.get(c.rootId);
    if (split === undefined) continue;
    const inputKey = `${split}/inputs/${c.id}.json`;
    const labelKey = `${split}/labels/${c.id}.json`;
    if (files[inputKey] !== c.inputHash) coverage.push(`files[${inputKey}] missing or differs from inputHash`);
    if (files[labelKey] !== c.labelHash) coverage.push(`files[${labelKey}] missing or differs from labelHash`);
  }
  const perChangeKey = /^(dev|heldout)\/(inputs|labels)\/([^/]+)\.json$/;
  for (const key of Object.keys(files)) {
    if (!isSplitFileKey(key)) coverage.push(`bad files key ${JSON.stringify(key)}`);
    const match = perChangeKey.exec(key);
    if (match !== null) {
      const [, split, , id] = match;
      if (id === undefined || !changeIds.has(id)) coverage.push(`files key ${key} names no manifest change`);
      else if (splitOf.get(typed.changes.find((c) => c.id === id)?.rootId ?? '') !== split) {
        coverage.push(`files key ${key} lies in the wrong split`);
      }
    }
  }
  out.push(result('7.3.3 manifest.files-coverage', coverage, `${Object.keys(files).length} files listed`));

  if (expected.recipeHash !== undefined) {
    out.push(
      result(
        '7.2 recipeHash',
        m.recipeHash === expected.recipeHash ? [] : [`recipeHash ${String(m.recipeHash)} != expected ${expected.recipeHash}`],
        'matches',
      ),
    );
  }
  if (expected.familyListHash !== undefined) {
    out.push(
      result(
        '7.2 familyListHash',
        m.familyListHash === expected.familyListHash
          ? []
          : [`familyListHash ${String(m.familyListHash)} != expected ${expected.familyListHash}`],
        'matches',
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 7.3.3 schemas: labels (schemas/label.schema.json) and operator consistency (docs/FAMILIES.md)
// ---------------------------------------------------------------------------------------------------------------

const LABEL_KEYS = ['schema', 'changeId', 'rootId', 'split', 'kind', 'trapIds', 'defect', 'cleanWitnesses', 'baseSanityReceipts'];
const DEFECT_KEYS = [
  'family',
  'operator',
  'siteId',
  'requiredAtoms',
  'anchorKind',
  'signatureBearing',
  'cleanTwinId',
  'witnessTest',
  'cleanHeadPassHash',
  'headAssertionFailureHash',
];

function checkAtomShape(a: unknown, where: string, problems: string[]): void {
  if (!isRecord(a)) {
    problems.push(`${where} is not an object`);
    return;
  }
  for (const k of extraKeys(a, ['path', 'side', 'line'])) problems.push(`${where} unknown field ${k}`);
  if (!isNonEmptyString(a.path)) problems.push(`${where}.path empty`);
  if (a.side !== 'base' && a.side !== 'head') problems.push(`${where}.side invalid`);
  if (typeof a.line !== 'number' || !Number.isInteger(a.line) || a.line < 1) problems.push(`${where}.line must be an integer >= 1`);
}

function checkOneLabelSchema(label: unknown, i: number, problems: string[]): void {
  const at = `labels[${i}]`;
  if (!isRecord(label)) {
    problems.push(`${at} is not an object`);
    return;
  }
  const where = isNonEmptyString(label.changeId) ? `${at}(${label.changeId})` : at;
  for (const k of extraKeys(label, LABEL_KEYS)) problems.push(`${where} unknown field ${k}`);
  if (label.schema !== 's45.label/1') problems.push(`${where}.schema invalid`);
  if (!isNonEmptyString(label.changeId) || !CORPUS_ID_PATTERN.test(label.changeId)) problems.push(`${where}.changeId invalid`);
  if (!isNonEmptyString(label.rootId) || !CORPUS_ID_PATTERN.test(label.rootId)) problems.push(`${where}.rootId invalid`);
  if (label.split !== 'dev' && label.split !== 'heldout') problems.push(`${where}.split invalid`);
  const kind = label.kind;
  if (kind !== 'clean' && kind !== 'defect' && kind !== 'near_miss') problems.push(`${where}.kind invalid`);
  if ('trapIds' in label) {
    const t = label.trapIds;
    if (!Array.isArray(t) || t.length === 0) problems.push(`${where}.trapIds must be a non-empty array`);
    else {
      if (new Set(t).size !== t.length) problems.push(`${where}.trapIds not unique`);
      for (const id of t) if (typeof id !== 'string' || !/^N[1-8]$/.test(id)) problems.push(`${where}.trapIds has ${String(id)}`);
    }
  }
  if (!Array.isArray(label.baseSanityReceipts) || label.baseSanityReceipts.length === 0) problems.push(`${where}.baseSanityReceipts must be a non-empty array`);
  else
    label.baseSanityReceipts.forEach((r, j) => {
      const at2 = `${where}.baseSanityReceipts[${j}]`;
      if (!isRecord(r)) {
        problems.push(`${at2} not an object`);
        return;
      }
      for (const k of extraKeys(r, ['path', 'basePassHash'])) problems.push(`${at2} unknown field ${k}`);
      if (!isNonEmptyString(r.path)) problems.push(`${at2}.path empty`);
      if (!isSha(r.basePassHash)) problems.push(`${at2}.basePassHash not sha256`);
    });
  if ('cleanWitnesses' in label) {
    const cw = label.cleanWitnesses;
    if (!Array.isArray(cw) || cw.length === 0) problems.push(`${where}.cleanWitnesses must be a non-empty array`);
    else
      cw.forEach((w, j) => {
        const at2 = `${where}.cleanWitnesses[${j}]`;
        if (!isRecord(w)) {
          problems.push(`${at2} not an object`);
          return;
        }
        for (const k of extraKeys(w, ['path', 'headPassHash'])) problems.push(`${at2} unknown field ${k}`);
        if (!isNonEmptyString(w.path)) problems.push(`${at2}.path empty`);
        if (!isSha(w.headPassHash)) problems.push(`${at2}.headPassHash not sha256`);
      });
  }
  if (kind === 'defect') {
    if (!('defect' in label)) problems.push(`${where} kind defect requires defect`);
    if ('cleanWitnesses' in label) problems.push(`${where} kind defect must not have cleanWitnesses`);
  } else if (kind === 'clean' || kind === 'near_miss') {
    if (!('cleanWitnesses' in label)) problems.push(`${where} kind ${kind} requires cleanWitnesses`);
    if ('defect' in label) problems.push(`${where} kind ${kind} must not have defect`);
  }
  if (kind === 'near_miss' && !('trapIds' in label)) problems.push(`${where} kind near_miss requires trapIds`);
  if ('defect' in label) {
    const d = label.defect;
    if (!isRecord(d)) {
      problems.push(`${where}.defect not an object`);
      return;
    }
    for (const k of extraKeys(d, DEFECT_KEYS)) problems.push(`${where}.defect unknown field ${k}`);
    for (const k of DEFECT_KEYS) if (!(k in d)) problems.push(`${where}.defect missing ${k}`);
    if (!FAMILIES.includes(d.family as Family)) problems.push(`${where}.defect.family invalid`);
    for (const k of ['operator', 'siteId', 'cleanTwinId', 'witnessTest'] as const) {
      if (!isNonEmptyString(d[k])) problems.push(`${where}.defect.${k} empty`);
    }
    if (typeof d.signatureBearing !== 'boolean') problems.push(`${where}.defect.signatureBearing must be boolean`);
    for (const k of ['cleanHeadPassHash', 'headAssertionFailureHash'] as const) {
      if (!isSha(d[k])) problems.push(`${where}.defect.${k} not sha256`);
    }
    const anchor = d.anchorKind;
    if (anchor !== 'edited' && anchor !== 'r-del-gap' && anchor !== 'base-deletion') {
      problems.push(`${where}.defect.anchorKind invalid`);
    }
    const atoms = d.requiredAtoms;
    if (!Array.isArray(atoms) || atoms.length === 0) problems.push(`${where}.defect.requiredAtoms must be non-empty`);
    else {
      atoms.forEach((a, j) => checkAtomShape(a, `${where}.defect.requiredAtoms[${j}]`, problems));
      const wantSide = anchor === 'base-deletion' ? 'base' : 'head';
      if (atoms.some((a) => isRecord(a) && a.side !== wantSide)) {
        problems.push(`${where}.defect anchorKind ${String(anchor)} requires ${wantSide}-side atoms only`);
      }
      if (anchor === 'r-del-gap' && atoms.length > 2) problems.push(`${where}.defect r-del-gap allows at most 2 atoms`);
      const keys = atoms.filter(isRecord).map((a) => `${String(a.path)}|${String(a.side)}|${String(a.line)}`);
      if (new Set(keys).size !== keys.length) problems.push(`${where}.defect.requiredAtoms has duplicates`);
    }
  }
}

/**
 * plan 7.4 / schemas/label.schema.json (hand-written equivalent; a JSON Schema validator run is deferred,
 * DV-M1-07) plus docs/FAMILIES.md operator consistency and unique change ids.
 */
export function validateLabels(labels: readonly unknown[]): PredicateResult[] {
  const schemaProblems: string[] = [];
  labels.forEach((l, i) => checkOneLabelSchema(l, i, schemaProblems));
  const out: PredicateResult[] = [result('7.3.3 schema.labels', schemaProblems, `${labels.length} labels well-formed`)];

  const dupProblems: string[] = [];
  const seen = new Set<string>();
  for (const l of labels) {
    if (!isRecord(l) || typeof l.changeId !== 'string') continue;
    if (seen.has(l.changeId)) dupProblems.push(`duplicate label for change ${l.changeId}`);
    seen.add(l.changeId);
  }
  out.push(result('7.3.3 labels.unique', dupProblems, 'one label per change'));

  const opProblems: string[] = [];
  for (const l of labels) {
    if (!isRecord(l) || l.kind !== 'defect' || !isRecord(l.defect)) continue;
    const d = l.defect;
    const where = `label ${String(l.changeId)}`;
    const op = typeof d.operator === 'string' ? OPERATORS[d.operator] : undefined;
    if (op === undefined) {
      opProblems.push(`${where}: unknown operator ${String(d.operator)}`);
      continue;
    }
    if (op.family !== d.family) opProblems.push(`${where}: operator ${String(d.operator)} belongs to ${op.family}, not ${String(d.family)}`);
    if (!op.anchorKinds.includes(d.anchorKind as AnchorKind)) {
      opProblems.push(`${where}: operator ${String(d.operator)} does not allow anchorKind ${String(d.anchorKind)}`);
    }
    const wantSig = d.operator === SIGNATURE_BEARING_OPERATOR;
    if (d.signatureBearing !== wantSig) opProblems.push(`${where}: signatureBearing must be ${wantSig} for ${String(d.operator)}`);
    if (d.cleanTwinId === l.changeId) opProblems.push(`${where}: cleanTwinId is the defect itself`);
  }
  out.push(result('7.4 labels.operator-consistency', opProblems, 'operators, anchor kinds and signatureBearing consistent'));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 7.3.3 split overlap
// ---------------------------------------------------------------------------------------------------------------

/**
 * plan 7.2 step 6 / 7.3.3: whole roots stay in their split. Checks, within one edition manifest: no root or change id
 * in both splits (by construction one entry each, so duplicates are caught here too), no identical input bytes across
 * splits, and no identical root-tree file (`<split>/roots/...`) across splits (declared shared boilerplate must be
 * grouped into one split). Near-duplicate detection by normalised fingerprints is C1's harness (Normal mode).
 */
export function checkSplitOverlap(manifest: CorpusManifestV1): PredicateResult[] {
  const out: PredicateResult[] = [];
  const idProblems: string[] = [];
  const rootSplits = new Map<string, Set<Split>>();
  for (const r of manifest.roots) {
    const s = rootSplits.get(r.id) ?? new Set<Split>();
    s.add(r.split);
    rootSplits.set(r.id, s);
  }
  for (const [id, s] of rootSplits) if (s.size > 1) idProblems.push(`root ${id} in both splits`);
  const splitOf = rootSplitMap(manifest);
  const changeSplits = new Map<string, Set<Split>>();
  for (const c of manifest.changes) {
    const split = splitOf.get(c.rootId);
    if (split === undefined) continue;
    const s = changeSplits.get(c.id) ?? new Set<Split>();
    s.add(split);
    changeSplits.set(c.id, s);
  }
  for (const [id, s] of changeSplits) if (s.size > 1) idProblems.push(`change ${id} in both splits`);
  out.push(result('7.3.3 split-overlap.ids', idProblems, 'no root or change id in both splits'));

  const inputProblems: string[] = [];
  const inputBySplit = new Map<string, Split>();
  for (const c of manifest.changes) {
    const split = splitOf.get(c.rootId);
    if (split === undefined) continue;
    const prev = inputBySplit.get(c.inputHash);
    if (prev !== undefined && prev !== split) inputProblems.push(`input bytes ${c.inputHash} appear in both splits`);
    inputBySplit.set(c.inputHash, split);
  }
  out.push(result('7.3.3 split-overlap.inputs', inputProblems, 'no identical input across splits'));

  const fileProblems: string[] = [];
  const devRootFiles = new Map<string, string>();
  for (const [key, hash] of Object.entries(manifest.files)) if (key.startsWith('dev/roots/')) devRootFiles.set(hash, key);
  for (const [key, hash] of Object.entries(manifest.files)) {
    if (!key.startsWith('heldout/roots/')) continue;
    const devKey = devRootFiles.get(hash);
    if (devKey !== undefined) fileProblems.push(`${key} is byte-identical to ${devKey}`);
  }
  out.push(result('7.3.3 split-overlap.root-files', fileProblems, 'no byte-identical root file across splits'));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 7.3.2 counts and label/manifest consistency
// ---------------------------------------------------------------------------------------------------------------

/**
 * plan 7.3 predicate 2 (file-checkable part) for one split, plus label/manifest consistency, near-miss trapIds and
 * clean-twin links. `labels` may contain both splits; only labels of `split` are counted, and a label whose split
 * disagrees with its manifest root is reported.
 */
export function checkCounts(manifest: CorpusManifestV1, labels: readonly LabelV1[], split: Split): PredicateResult[] {
  const C = GATE1_COUNTS;
  const out: PredicateResult[] = [];
  const p = (name: string) => `7.3.2 ${split} ${name}`;
  const splitOf = rootSplitMap(manifest);
  const roots = manifest.roots.filter((r) => r.split === split);
  const rootIds = new Set(roots.map((r) => r.id));
  const changes = manifest.changes.filter((c) => rootIds.has(c.rootId));
  const changeRoot = new Map(changes.map((c) => [c.id, c.rootId]));

  // label / manifest consistency
  const consistency: string[] = [];
  const byId = new Map<string, LabelV1>();
  const manifestRootOf = new Map(manifest.changes.map((c) => [c.id, c.rootId]));
  for (const l of labels) {
    const manifestRoot = manifestRootOf.get(l.changeId);
    if (manifestRoot === undefined) {
      if (l.split === split) consistency.push(`label ${l.changeId} has no manifest change`);
      continue;
    }
    const rootSplit = splitOf.get(manifestRoot);
    if (rootSplit !== split && l.split !== split) continue;
    if (l.rootId !== manifestRoot) consistency.push(`label ${l.changeId} rootId ${l.rootId} != manifest ${manifestRoot}`);
    if (l.split !== rootSplit) consistency.push(`label ${l.changeId} split ${l.split} != root split ${String(rootSplit)}`);
    if (rootSplit !== split) continue;
    if (byId.has(l.changeId)) consistency.push(`duplicate label ${l.changeId}`);
    byId.set(l.changeId, l);
  }
  for (const c of changes) if (!byId.has(c.id)) consistency.push(`change ${c.id} has no label`);
  out.push(result(p('labels-match-manifest'), consistency, `${byId.size} labels match ${changes.length} changes`));

  const splitLabels = [...byId.values()];
  const clean = splitLabels.filter((l) => l.kind === 'clean');
  const defects = splitLabels.filter((l) => l.kind === 'defect');
  const nearMisses = splitLabels.filter((l) => l.kind === 'near_miss');
  const tsx = roots.filter((r) => r.tsx).length;

  const eq = (name: string, actual: number, want: number) =>
    out.push(result(p(name), actual === want ? [] : [`${actual} (want ${want})`], String(actual)));
  const atLeast = (name: string, actual: number, want: number) =>
    out.push(result(p(name), actual >= want ? [] : [`${actual} (want >= ${want})`], String(actual)));

  eq('roots', roots.length, C.rootsPerSplit);
  atLeast('tsx-roots', tsx, C.tsxRootsMinPerSplit);
  eq('changes', changes.length, C.changesPerSplit);
  eq('clean', clean.length, C.cleanPerSplit);
  eq('defects', defects.length, C.defectsPerSplit);
  eq('near-misses', nearMisses.length, C.nearMissPerSplit);

  // per family: exactly 5, in distinct roots
  const famProblems: string[] = [];
  for (const fam of FAMILIES) {
    const ofFam = defects.filter((d) => d.defect?.family === fam);
    if (ofFam.length !== C.defectsPerFamilyPerSplit) famProblems.push(`${fam}: ${ofFam.length} (want ${C.defectsPerFamilyPerSplit})`);
    const famRoots = new Set(ofFam.map((d) => d.rootId));
    if (famRoots.size !== ofFam.length) famProblems.push(`${fam}: defects not in distinct roots`);
  }
  out.push(result(p('per-family'), famProblems, `${C.defectsPerFamilyPerSplit} per family in distinct roots`));

  // per root: 1 clean, 2 defects of distinct families, 1 near-miss
  const rootProblems: string[] = [];
  for (const r of roots) {
    const mine = splitLabels.filter((l) => l.rootId === r.id);
    const nClean = mine.filter((l) => l.kind === 'clean').length;
    const mineDefects = mine.filter((l) => l.kind === 'defect');
    const nNear = mine.filter((l) => l.kind === 'near_miss').length;
    if (nClean !== 1) rootProblems.push(`${r.id}: ${nClean} clean (want 1)`);
    if (nNear !== 1) rootProblems.push(`${r.id}: ${nNear} near-miss (want 1)`);
    if (mineDefects.length !== C.defectsPerRoot) rootProblems.push(`${r.id}: ${mineDefects.length} defects (want ${C.defectsPerRoot})`);
    const fams = new Set(mineDefects.map((d) => d.defect?.family));
    if (fams.size !== mineDefects.length) rootProblems.push(`${r.id}: defect families not distinct`);
  }
  out.push(result(p('per-root'), rootProblems, 'every root: 1 clean, 2 defects (distinct families), 1 near-miss'));

  // traps
  const trapProblems: string[] = [];
  const trapCount = new Map<string, number>();
  for (const n of nearMisses) {
    if (n.trapIds === undefined || n.trapIds.length === 0) trapProblems.push(`near-miss ${n.changeId} has no trapIds`);
    for (const t of n.trapIds ?? []) trapCount.set(t, (trapCount.get(t) ?? 0) + 1);
  }
  for (const t of TRAP_IDS) {
    const n = trapCount.get(t) ?? 0;
    if (n < C.trapMinPerSplit) trapProblems.push(`${t}: ${n} (want >= ${C.trapMinPerSplit})`);
  }
  out.push(
    result(
      p('traps'),
      trapProblems,
      TRAP_IDS.map((t) => `${t}=${trapCount.get(t) ?? 0}`).join(' '),
    ),
  );

  const baseDel = defects.filter((d) => d.defect?.anchorKind === 'base-deletion').length;
  atLeast('base-deletion', baseDel, C.baseDeletionMinPerSplit);

  // clean twins
  const twinProblems: string[] = [];
  for (const d of defects) {
    const twinId = d.defect?.cleanTwinId;
    const twin = twinId === undefined ? undefined : byId.get(twinId);
    if (twin === undefined) twinProblems.push(`${d.changeId}: cleanTwinId ${String(twinId)} is not a label of this split`);
    else {
      if (twin.kind !== 'clean') twinProblems.push(`${d.changeId}: twin ${twin.changeId} is ${twin.kind}, not clean`);
      if (twin.rootId !== d.rootId) twinProblems.push(`${d.changeId}: twin ${twin.changeId} is in another root`);
    }
    if (changeRoot.get(d.changeId) !== d.rootId) twinProblems.push(`${d.changeId}: root mismatch`);
  }
  out.push(result(p('clean-twins'), twinProblems, 'every defect names the clean change of its own root'));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 7.3.2 whole root module tree (D36)
// ---------------------------------------------------------------------------------------------------------------

/**
 * D36: every change payload contains every file of its root module tree, with base text equal to the root file.
 * `rootTrees`: rootId -> (relative POSIX path -> root file text), read by the caller from `<split>/roots/<rootId>/`.
 */
export function checkWholeRootTree(
  rootTrees: ReadonlyMap<string, ReadonlyMap<string, string>>,
  changes: readonly ChangeV1[],
  manifest: CorpusManifestV1,
): PredicateResult[] {
  const problems: string[] = [];
  const rootOf = new Map(manifest.changes.map((c) => [c.id, c.rootId]));
  for (const change of changes) {
    const rootId = rootOf.get(change.id);
    if (rootId === undefined) {
      problems.push(`change ${change.id} not in manifest`);
      continue;
    }
    const tree = rootTrees.get(rootId);
    if (tree === undefined) {
      problems.push(`no root tree for ${rootId} (change ${change.id})`);
      continue;
    }
    const byPath = new Map(change.files.map((f) => [f.path, f]));
    for (const [path, text] of tree) {
      const f = byPath.get(path);
      if (f === undefined) problems.push(`change ${change.id} lacks root file ${path}`);
      else if (f.base !== text) problems.push(`change ${change.id} base of ${path} differs from root ${rootId}`);
    }
  }
  return [result('7.3.2 whole-root-tree (D36)', problems, `${changes.length} payloads include their whole root tree`)];
}

// ---------------------------------------------------------------------------------------------------------------
// 7.3.3 author independence (pure comparison; the registry lookup is the gate operator's)
// ---------------------------------------------------------------------------------------------------------------

export function checkAuthorIndependence(
  manifest: CorpusManifestV1,
  builderSessions: readonly string[],
): PredicateResult[] {
  const problems: string[] = [];
  if (builderSessions.length === 0) problems.push('no builder session list supplied (read it from the AgentNamer registry)');
  if (builderSessions.includes(manifest.authorSession)) problems.push(`authorSession ${manifest.authorSession} is a builder session`);
  if (builderSessions.includes(manifest.custodianSession)) {
    problems.push(`custodianSession ${manifest.custodianSession} is a builder session`);
  }
  return [result('7.3.3 author-not-builder', problems, `author differs from ${builderSessions.length} builder sessions`)];
}

// ---------------------------------------------------------------------------------------------------------------
// 7.3.3 commitment
// ---------------------------------------------------------------------------------------------------------------

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(dir, prefix), { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...(await listFiles(dir, rel)));
    else out.push(rel);
  }
  return out;
}

export interface VerifyCommitmentOptions {
  /**
   * Allow committed files to be absent (a release copy that holds inputs but not yet labels). Every file that is
   * present must still match, and no unlisted file may be present.
   */
  allowMissing?: boolean;
}

/**
 * plan 7.3 predicate 3 / 7.5: verify `heldout.commitment.json` against the edition manifest and the held-out bytes.
 * `heldoutDir` holds the held-out split's contents (key `heldout/x/y` <-> `<heldoutDir>/x/y`): C1's delivery
 * folder before sealing (gate operator) or the released scratch copy (P6 session). Builder sessions never point this
 * at the sealed custody folder.
 */
export async function verifyCommitment(
  commitmentPath: string,
  manifestPath: string,
  heldoutDir: string,
  options: VerifyCommitmentOptions = {},
): Promise<PredicateResult[]> {
  const out: PredicateResult[] = [];
  let commitmentValue: unknown;
  let manifestBytes: Uint8Array;
  let manifestValue: unknown;
  try {
    commitmentValue = JSON.parse(await readFile(commitmentPath, 'utf8')) as unknown;
    manifestBytes = await readFile(manifestPath);
    manifestValue = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as unknown;
  } catch (err) {
    return [result('7.3.3 commitment.readable', [(err as Error).message], '')];
  }
  const shape = checkCommitmentShape(commitmentValue);
  out.push(result('7.3.3 commitment.schema', shape, 'well-formed'));
  const mShape = checkManifestShape(manifestValue);
  if (mShape.length > 0) out.push(result('7.3.3 commitment.manifest-schema', mShape, ''));
  if (shape.length > 0 || mShape.length > 0) return out;
  const commitment = commitmentValue as HeldoutCommitmentV1;
  const manifest = manifestValue as CorpusManifestV1;

  const binding: string[] = [];
  const manifestSha = sha256Hex(manifestBytes);
  if (commitment.manifestSha256 !== manifestSha) binding.push(`manifestSha256 ${commitment.manifestSha256} != sha256(manifest) ${manifestSha}`);
  if (commitment.edition !== manifest.edition) binding.push('edition differs from manifest');
  if (commitment.authorSession !== manifest.authorSession) binding.push('authorSession differs from manifest');
  if (commitment.siteInventoryHash !== manifest.siteInventoryHash) binding.push('siteInventoryHash differs from manifest');
  if (commitment.splitSeed !== manifest.splitSeed || commitment.placementSeed !== manifest.placementSeed) {
    binding.push('seeds differ from manifest');
  }
  out.push(result('7.3.3 commitment.manifest-binding', binding, `bound to manifest ${manifestSha}`));

  const listProblems: string[] = [];
  const manifestHeldout = Object.entries(manifest.files).filter(([k]) => k.startsWith('heldout/'));
  const committedKeys = Object.keys(commitment.files);
  for (const [k, v] of manifestHeldout) {
    if (commitment.files[k] === undefined) listProblems.push(`${k} in manifest but not committed`);
    else if (commitment.files[k] !== v) listProblems.push(`${k} hash differs between manifest and commitment`);
  }
  const manifestKeys = new Set(manifestHeldout.map(([k]) => k));
  for (const k of committedKeys) if (!manifestKeys.has(k)) listProblems.push(`${k} committed but not in manifest`);
  out.push(result('7.3.3 commitment.files-match-manifest', listProblems, `${committedKeys.length} held-out files`));

  const hashProblems: string[] = [];
  let missing = 0;
  for (const key of committedKeys) {
    const rel = key.slice('heldout/'.length);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(join(heldoutDir, ...rel.split('/')));
    } catch {
      missing += 1;
      if (options.allowMissing !== true) hashProblems.push(`${key} missing`);
      continue;
    }
    const actual = sha256Hex(bytes);
    if (actual !== commitment.files[key]) hashProblems.push(`${key} sha256 ${actual} != committed ${String(commitment.files[key])}`);
  }
  out.push(
    result(
      '7.3.3 commitment.file-hashes',
      hashProblems,
      `${committedKeys.length - missing} files verified${missing > 0 ? `, ${missing} not present (allowed)` : ''}`,
    ),
  );

  const extraProblems: string[] = [];
  let present: string[] = [];
  try {
    present = await listFiles(heldoutDir);
  } catch (err) {
    extraProblems.push(`cannot list ${heldoutDir}: ${(err as Error).message}`);
  }
  const committedSet = new Set(committedKeys);
  for (const rel of present) if (!committedSet.has(`heldout/${rel}`)) extraProblems.push(`unlisted file heldout/${rel}`);
  out.push(result('7.3.3 commitment.no-extra-files', extraProblems, `${present.length} files present, all committed`));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 7.3.1 receipts (file-checkable part)
// ---------------------------------------------------------------------------------------------------------------

function namedTestPattern(name: string): string {
  return `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

/** Packet command convention: one delivered test file, optionally one exact full test title. */
function receiptTestPath(receipt: Record<string, unknown>): string | undefined {
  const command = receipt.command;
  if (!Array.isArray(command) || !command.every(isNonEmptyString)) return undefined;
  if (command[0] !== 'vitest' || command[1] !== 'run') return undefined;
  if (command.length !== 3 && !(command.length === 5 && command[3] === '--testNamePattern')) return undefined;
  return command[2] as string;
}

/**
 * plan 7.3 predicate 1, file-checkable part. Each receipt's `sha256` must equal sha256(canonicalJson(receipt without
 * sha256)). Each label hash must name a delivered receipt with the expected change, side and outcome:
 * - `defect.cleanHeadPassHash`        -> changeId = cleanTwinId, side head, outcome pass
 * - `defect.headAssertionFailureHash` -> changeId = the defect,  side head, outcome assertion_fail, failedTest = witnessTest
 * - `cleanWitnesses[].headPassHash`   -> changeId = the label,   side head, outcome pass
 * - `baseSanityReceipts[].basePassHash` -> changeId = the label, side base, outcome pass
 * Each defect pair also binds identical testHash, command (including exact named-test selection), and harnessVersion.
 * Delivered test-byte identity is checked separately by checkDeliveredTestIdentity. Actual execution is Normal-mode only.
 */
export function checkReceiptReferences(labels: readonly LabelV1[], receipts: readonly unknown[]): PredicateResult[] {
  const selfProblems: string[] = [];
  const bySha = new Map<string, Record<string, unknown>>();
  receipts.forEach((r, i) => {
    if (!isRecord(r)) {
      selfProblems.push(`receipts[${i}] not an object`);
      return;
    }
    if (r.schema !== 's45.receipt/1') selfProblems.push(`receipts[${i}].schema invalid`);
    if (!isSha(r.testHash) || !isSha(r.sourceHash)) selfProblems.push(`receipts[${i}] sourceHash/testHash invalid`);
    if (!isNonEmptyString(r.harnessVersion)) selfProblems.push(`receipts[${i}].harnessVersion empty`);
    if (receiptTestPath(r) === undefined) selfProblems.push(`receipts[${i}].command must select one delivered test file`);
    if (!['pass', 'assertion_fail', 'other_fail', 'timeout'].includes(String(r.outcome))) {
      selfProblems.push(`receipts[${i}].outcome invalid`);
    }
    if (!Number.isInteger(r.exitCode) || (r.outcome === 'pass' ? r.exitCode !== 0 : r.exitCode === 0)) {
      selfProblems.push(`receipts[${i}] outcome/exitCode inconsistent`);
    }
    if (r.outcome === 'pass' && 'failedTest' in r) selfProblems.push(`receipts[${i}] pass cannot name a failedTest`);
    if (r.outcome === 'assertion_fail' && !isNonEmptyString(r.failedTest)) selfProblems.push(`receipts[${i}] assertion_fail needs failedTest`);
    const claimed = r.sha256;
    if (!isSha(claimed)) {
      selfProblems.push(`receipts[${i}].sha256 not sha256 hex`);
      return;
    }
    const rest: Record<string, unknown> = { ...r };
    delete rest.sha256;
    const actual = sha256Hex(canonicalJson(rest));
    if (actual !== claimed) selfProblems.push(`receipts[${i}] sha256 ${claimed} != canonical ${actual}`);
    if (bySha.has(claimed)) selfProblems.push(`duplicate receipt ${claimed}`);
    bySha.set(claimed, r);
  });
  const refProblems: string[] = [];
  const expectReceipt = (
    hash: string,
    where: string,
    want: { changeId: string; side: 'base' | 'head'; outcome: string; failedTest?: string },
  ): void => {
    const r = bySha.get(hash);
    if (r === undefined) {
      refProblems.push(`${where}: no receipt ${hash}`);
      return;
    }
    if (r.changeId !== want.changeId) refProblems.push(`${where}: receipt is for ${String(r.changeId)}, want ${want.changeId}`);
    if (r.side !== want.side) refProblems.push(`${where}: receipt side ${String(r.side)}, want ${want.side}`);
    if (r.outcome !== want.outcome) refProblems.push(`${where}: receipt outcome ${String(r.outcome)}, want ${want.outcome}`);
    if (want.failedTest !== undefined && r.failedTest !== want.failedTest) {
      refProblems.push(`${where}: failedTest ${String(r.failedTest)}, want ${want.failedTest}`);
    }
  };
  for (const l of labels) {
    if (l.baseSanityReceipts.length === 0) refProblems.push(`${l.changeId}: baseSanityReceipts must be non-empty`);
    if (l.defect !== undefined) {
      const d = l.defect;
      expectReceipt(d.cleanHeadPassHash, `${l.changeId}.cleanHeadPassHash`, { changeId: d.cleanTwinId, side: 'head', outcome: 'pass' });
      expectReceipt(d.headAssertionFailureHash, `${l.changeId}.headAssertionFailureHash`, {
        changeId: l.changeId,
        side: 'head',
        outcome: 'assertion_fail',
        failedTest: d.witnessTest,
      });
      const clean = bySha.get(d.cleanHeadPassHash);
      const failure = bySha.get(d.headAssertionFailureHash);
      if (clean !== undefined && failure !== undefined) {
        for (const key of ['testHash', 'command', 'harnessVersion'] as const) {
          if (canonicalJson(clean[key]) !== canonicalJson(failure[key])) refProblems.push(`${l.changeId}: witness ${key} differs between clean and defect`);
        }
        for (const r of [clean, failure]) {
          const command = r.command;
          if (!Array.isArray(command) || command.length !== 5 || command[3] !== '--testNamePattern' || command[4] !== namedTestPattern(d.witnessTest)) {
            refProblems.push(`${l.changeId}: witness command must select exactly ${d.witnessTest}`);
          }
        }
      }
    }
    for (const w of l.cleanWitnesses ?? []) {
      expectReceipt(w.headPassHash, `${l.changeId}.cleanWitnesses(${w.path})`, { changeId: l.changeId, side: 'head', outcome: 'pass' });
    }
    for (const b of l.baseSanityReceipts) {
      expectReceipt(b.basePassHash, `${l.changeId}.baseSanityReceipts(${b.path})`, { changeId: l.changeId, side: 'base', outcome: 'pass' });
    }
  }
  return [
    result('7.3.1 receipts.self-hash', selfProblems, `${receipts.length} receipts self-hash verified`),
    result('7.3.1 receipts.references', refProblems, 'every label hash references a matching receipt'),
  ];
}

/**
 * Bind every referenced test to its delivered manifest entry, without executing it. Label paths are relative to
 * <split>/witnesses/<rootId>/. Defect witness paths come from the same canonical command in both receipts.
 * C1/check-data and the independent gate operator must additionally hash the ACTUAL delivered bytes and reconstruct
 * executed sourceHash (Normal mode). A manifest/hash agreement cannot prove that the recorded command was executed.
 */
export function checkDeliveredTestIdentity(
  labels: readonly LabelV1[],
  receipts: readonly unknown[],
  manifest: CorpusManifestV1,
): PredicateResult[] {
  const problems: string[] = [];
  const bySha = new Map<string, Record<string, unknown>>();
  for (const r of receipts) if (isRecord(r) && isSha(r.sha256)) bySha.set(r.sha256, r);
  const check = (l: LabelV1, hash: string, relativePath?: string): void => {
    const r = bySha.get(hash);
    if (r === undefined) {
      problems.push(`${l.changeId}: missing receipt ${hash}`);
      return;
    }
    const prefix = `${l.split}/witnesses/${l.rootId}/`;
    const commandPath = receiptTestPath(r);
    const expectedPath = relativePath === undefined ? commandPath : `${prefix}${relativePath}`;
    if (expectedPath === undefined || !expectedPath.startsWith(prefix) || !isSplitFileKey(expectedPath) || commandPath !== expectedPath) {
      problems.push(`${l.changeId}: receipt test path does not match delivered witness path`);
      return;
    }
    const expectedHash = manifest.files[expectedPath];
    if (expectedHash === undefined || r.testHash !== expectedHash) problems.push(`${l.changeId}: testHash does not match manifest file ${expectedPath}`);
  };
  for (const l of labels) {
    if (l.defect !== undefined) {
      check(l, l.defect.cleanHeadPassHash);
      check(l, l.defect.headAssertionFailureHash);
    }
    for (const w of l.cleanWitnesses ?? []) check(l, w.headPassHash, w.path);
    if (l.baseSanityReceipts.length === 0) problems.push(`${l.changeId}: baseSanityReceipts must be non-empty`);
    for (const b of l.baseSanityReceipts) check(l, b.basePassHash, b.path);
  }
  return [result('7.3.1 receipts.delivered-test-identity', problems, 'every referenced test path/hash matches the delivery manifest')];
}

// ---------------------------------------------------------------------------------------------------------------
// 7.3.6 / D34 required atoms exist; 7.3.4 size balance (both need atoms computed in Normal mode)
// ---------------------------------------------------------------------------------------------------------------

/**
 * D34 / plan 7.3 predicate 6, and the post-release check in eval/tune (a miss aborts before scoring).
 * `atomsByChange`: changeId -> every atom of that change under docs/ATOMS.md. Each defect's requiredAtoms are looked
 * up in the atoms of the label's OWN changeId (never the clean twin's).
 */
export function checkRequiredAtomsExist(
  atomsByChange: ReadonlyMap<string, readonly Atom[]>,
  labels: readonly LabelV1[],
): PredicateResult[] {
  const problems: string[] = [];
  let checked = 0;
  for (const l of labels) {
    if (l.kind !== 'defect' || l.defect === undefined) continue;
    checked += 1;
    const atoms = atomsByChange.get(l.changeId);
    if (atoms === undefined) {
      problems.push(`${l.changeId}: no atoms supplied for this change`);
      continue;
    }
    if (l.defect.requiredAtoms.length === 0) problems.push(`${l.changeId}: requiredAtoms is empty`);
    const have = new Set(atoms.map(atomKey));
    for (const a of l.defect.requiredAtoms) {
      if (!have.has(atomKey(a))) problems.push(`${l.changeId}: required atom ${a.path}:${a.side}:${a.line} is not an atom of the change`);
    }
  }
  return [result('7.3.6 required-atoms-exist (D34)', problems, `${checked} defects: every required atom exists`)];
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * plan 7.3 predicate 4 / D18: on dev, median over defect heads of (defect change total atoms / clean twin total
 * atoms) must lie in [0.67, 1.5]. Total atoms = the length of the change's atom list (all files).
 */
export function checkSizeBalance(
  atomsByChange: ReadonlyMap<string, readonly Atom[]>,
  labels: readonly LabelV1[],
  split: Split = 'dev',
): PredicateResult[] {
  const problems: string[] = [];
  const ratios: number[] = [];
  for (const l of labels) {
    if (l.split !== split || l.kind !== 'defect' || l.defect === undefined) continue;
    const mine = atomsByChange.get(l.changeId);
    const twin = atomsByChange.get(l.defect.cleanTwinId);
    if (mine === undefined || twin === undefined) {
      problems.push(`${l.changeId}: atoms missing for the defect or its twin`);
      continue;
    }
    if (twin.length === 0) {
      problems.push(`${l.changeId}: clean twin ${l.defect.cleanTwinId} has no atoms`);
      continue;
    }
    ratios.push(mine.length / twin.length);
  }
  if (ratios.length === 0) problems.push(`no ${split} defects with atoms`);
  const m = ratios.length > 0 ? median(ratios) : Number.NaN;
  if (ratios.length > 0 && (m < SIZE_BALANCE_RANGE.min || m > SIZE_BALANCE_RANGE.max)) {
    problems.push(`median ratio ${m.toFixed(4)} outside [${SIZE_BALANCE_RANGE.min}, ${SIZE_BALANCE_RANGE.max}]`);
  }
  return [result(`7.3.4 ${split} size-balance (D18)`, problems, `median ratio ${m.toFixed(4)} over ${ratios.length} defects`)];
}
