// plan 6 / 9 M3: `analyze(input: ChangeV1): AnalysisV1`. Pure: no filesystem, no network, no provider, no labels.
// Emits per-hunk tier INPUTS (plan 8.2); tier assignment, ordering and budgets belong to src/policy and
// src/orderings (M4). Rules: docs/ATOMS.md (hunks, atoms, parse) and docs/METRICS.md (metrics m1).
import type ts from 'typescript';
import { atomTotals, emptySideLines, fileLineSets, hunkLineSets } from '../core/atoms';
import type { SideLines } from '../core/atoms';
import { fileRoleOf, normaliseText, sidePresent, sourceKindOf } from '../core/change';
import type { SourceKind } from '../core/change';
import { changeInputHash, sideHash } from '../core/hash';
import { computeFileHunks } from '../core/hunks';
import { parseSide, scanNonTriviaTokens, tokenLines, topLevelImports } from '../core/parse';
import type { ImportFact, ParsedSide, ScannedToken } from '../core/parse';
import { assertAcceptable, checkAtomLimit, checkLimits, LISTING_CODES, makeIssue } from '../core/safety';
import type {
  AnalysedFile,
  AnalysisV1,
  ChangeStatus,
  ChangeV1,
  FileRole,
  FunctionRecord,
  Hunk,
  HunkMetrics,
  Issue,
  ManualReason,
  Side,
  Span,
} from '../core/types';
import { findSwallowingCatches, swallowingCatchesHit } from './catches';
import { cloneHitsForHunk, findClonePairs, leafTokens } from './clones';
import type { ClonePair } from './clones';
import { buildFunctionEntries, collectSideFunctions, entryHits, sideFunctionSpans } from './functions';
import type { FunctionEntry, SideFunction, SideFunctionMap } from './functions';
import { hunkSize, metricValue, unknownValue } from './size';
import { buildTestReferenceContext, testReferenceValue } from './testref';
import { findUnreachableStatements, unreachableHit } from './unreachable';

export interface AnalyzeOptions {
  /**
   * Listing issues found by an input adapter for files it did not read (e.g. src/core/git.ts: changed files with an
   * unsupported extension, over-limit blobs). Any `limit_*` or `unsupported_extension` issue makes the change
   * `incomplete`.
   */
  externalIssues?: readonly Issue[];
}

/** Scanner tokens of one side, indexed by the lines each token covers (plan 8.2 T0a/T0b). */
interface SideTokens {
  tokens: ScannedToken[];
  lines: Set<number>;
  byLine: Map<number, number[]>;
}

interface FileState {
  path: string;
  role: FileRole;
  kind: SourceKind | null;
  baseLF: string;
  headLF: string;
  basePresent: boolean;
  headPresent: boolean;
  changed: boolean;
  overLimit: boolean;
  baseParsed: ParsedSide | null;
  headParsed: ParsedSide | null;
  /** D35: a present side failed to parse; every hunk of the file is `manual`. */
  failed: boolean;
  baseMap: SideFunctionMap | null;
  headMap: SideFunctionMap | null;
  entries: FunctionEntry[];
  hunks: Hunk[];
  catchSpans: Span[];
  unreachableSpans: Span[];
  tokenCache: Partial<Record<Side, SideTokens>>;
  importCache: Partial<Record<Side, ImportFact[]>>;
}

function sideTokens(state: FileState, side: Side): SideTokens {
  const cached = state.tokenCache[side];
  if (cached !== undefined) return cached;
  const present = side === 'base' ? state.basePresent : state.headPresent;
  const text = side === 'base' ? state.baseLF : state.headLF;
  const tokens = present && state.kind !== null ? scanNonTriviaTokens(text, state.kind) : [];
  const byLine = new Map<number, number[]>();
  tokens.forEach((t, i) => {
    for (let line = t.startLine; line <= t.endLine; line++) {
      const list = byLine.get(line);
      if (list === undefined) byLine.set(line, [i]);
      else list.push(i);
    }
  });
  const result: SideTokens = { tokens, lines: tokenLines(tokens), byLine };
  state.tokenCache[side] = result;
  return result;
}

function sideImports(state: FileState, side: Side): ImportFact[] | null {
  const cached = state.importCache[side];
  if (cached !== undefined) return cached;
  const parsed = side === 'base' ? state.baseParsed : state.headParsed;
  const present = side === 'base' ? state.basePresent : state.headPresent;
  if (present && (parsed === null || parsed.failed)) return null;
  const facts = parsed === null ? [] : topLevelImports(parsed.sourceFile);
  state.importCache[side] = facts;
  return facts;
}

/** Non-trivia tokens covering any of `lines`, in source order. */
function tokensOnLines(tokens: SideTokens, lines: ReadonlySet<number>): ScannedToken[] {
  const indices = new Set<number>();
  for (const line of lines) for (const i of tokens.byLine.get(line) ?? []) indices.add(i);
  return [...indices].sort((a, b) => a - b).map((i) => tokens.tokens[i] as ScannedToken);
}

/** plan 8.2 tier-0 inputs T0a-T0c (T0d is the file role). */
function tierZeroInputs(state: FileState, lines: SideLines): { t0a: boolean; t0b: boolean; t0c: boolean } {
  const base = sideTokens(state, 'base');
  const head = sideTokens(state, 'head');
  const noToken = (set: ReadonlySet<number>, tokenLineSet: ReadonlySet<number>): boolean =>
    [...set].every((line) => !tokenLineSet.has(line));
  // T0a: every changed line on both sides carries no non-trivia token.
  const t0a = noToken(lines.base, base.lines) && noToken(lines.head, head.lines);
  // T0b: the hunk's base-side and head-side non-trivia token sequences (kind + text) are equal.
  const baseSeq = tokensOnLines(base, lines.base);
  const headSeq = tokensOnLines(head, lines.head);
  const t0b =
    baseSeq.length === headSeq.length &&
    baseSeq.every((t, i) => t.kind === (headSeq[i] as ScannedToken).kind && t.text === (headSeq[i] as ScannedToken).text);
  // T0c: every changed line inside a top-level ImportDeclaration, and the file's import multisets are equal.
  let t0c = false;
  const baseImports = sideImports(state, 'base');
  const headImports = sideImports(state, 'head');
  if (baseImports !== null && headImports !== null) {
    const inside = (set: ReadonlySet<number>, facts: readonly ImportFact[]): boolean =>
      [...set].every((line) => facts.some((f) => line >= f.startLine && line <= f.endLine));
    const multiset = (facts: readonly ImportFact[]): string[] => facts.map((f) => f.normalisedText).sort();
    const a = multiset(baseImports);
    const b = multiset(headImports);
    t0c =
      inside(lines.base, baseImports) &&
      inside(lines.head, headImports) &&
      a.length === b.length &&
      a.every((text, i) => text === b[i]);
  }
  return { t0a, t0b, t0c };
}

function uniqueSpans(spans: readonly Span[]): Span[] {
  const seen = new Map<string, Span>();
  for (const s of spans) seen.set(`${s.path}|${s.side}|${s.startLine}|${s.endLine}`, s);
  return [...seen.values()];
}

/** plan 6.3 / 8.2: metric values and tier inputs for one hunk. */
function hunkMetrics(hunk: Hunk, state: FileState, clonePairs: readonly ClonePair[]): HunkMetrics {
  const lines = hunkLineSets(hunk);
  const size = hunkSize(hunk);
  const production = state.role === 'production';
  const hits = state.failed ? [] : state.entries.filter((e) => e.record.class !== 'anonymous' && entryHits(e, lines));

  const manualReasons: ManualReason[] = [];
  if (state.failed) manualReasons.push('parse_failure');
  if (production && hits.some((e) => e.record.class === 'ambiguous')) manualReasons.push('ambiguous_function');

  const intersectingFunctionKeys = [
    ...new Set(
      hits
        .filter((e) => e.record.isTop || e.record.class === 'matched' || e.record.class === 'new')
        .map((e) => e.record.key as string),
    ),
  ];
  const { t0a, t0b, t0c } = tierZeroInputs(state, lines);
  const base: Omit<
    HunkMetrics,
    'maxPositiveDelta' | 'catchMaySwallow' | 'untestedChangedStatementMax' | 'duplicatedAddedAtoms' | 'unreachableStatements'
  > = {
    hunkId: hunk.id,
    ...size,
    intersectingFunctionKeys,
    t0aTriviaOnly: t0a,
    t0bTokenEqual: t0b,
    t0cImportReorder: t0c,
    t0dTestFile: state.role === 'test',
    manual: manualReasons.length > 0,
    manualReasons,
  };

  if (state.failed) {
    return {
      ...base,
      maxPositiveDelta: unknownValue<number>(),
      catchMaySwallow: unknownValue<boolean>(),
      untestedChangedStatementMax: unknownValue<number>(),
      duplicatedAddedAtoms: unknownValue<number>(),
      unreachableStatements: unknownValue<number>(),
    };
  }

  // docs/METRICS.md section 5: max positive delta over matched/new production functions (incl. `<top>`).
  let maxDelta = 0;
  let deltaSpans: Span[] = [];
  if (production) {
    for (const e of hits) {
      if (e.record.class !== 'matched' && e.record.class !== 'new') continue;
      const d = e.record.cyclomaticDelta.value;
      if (typeof d !== 'number' || d <= 0) continue;
      if (d > maxDelta) {
        maxDelta = d;
        deltaSpans = [];
      }
      if (d === maxDelta) deltaSpans.push(...sideFunctionSpans(e.head));
    }
  }

  // plan 8.2 R2-untested-size input: max head statements over intersecting changed production functions whose
  // no_changed_test_reference is true ('unknown' never fires).
  let untestedMax = 0;
  let untestedSpans: Span[] = [];
  if (production) {
    for (const e of hits) {
      const r = e.record;
      if (r.isTop || !r.changed || r.noChangedTestReference.value !== true) continue;
      const n = r.statementCount.value;
      if (typeof n !== 'number') continue;
      if (n > untestedMax) {
        untestedMax = n;
        untestedSpans = [];
      }
      if (n === untestedMax && n > 0) untestedSpans.push(...sideFunctionSpans(e.head));
    }
  }

  const catchHits = production ? swallowingCatchesHit(state.catchSpans, lines.head) : [];
  const clone = cloneHitsForHunk(clonePairs, hunk.path, lines.head);
  const unreachable = unreachableHit(state.unreachableSpans, lines.head);

  return {
    ...base,
    maxPositiveDelta: metricValue(maxDelta, uniqueSpans(deltaSpans)),
    catchMaySwallow: metricValue(catchHits.length > 0, catchHits),
    untestedChangedStatementMax: metricValue(untestedMax, uniqueSpans(untestedSpans)),
    duplicatedAddedAtoms: metricValue(clone.duplicatedAddedAtoms, clone.origins),
    unreachableStatements: metricValue(unreachable.length, unreachable),
  };
}

/**
 * plan 6.1 status: any `limit_*` issue -> incomplete; nothing analysable -> unsupported; a changed unsupported file
 * (or another listing issue) -> incomplete; no atoms -> noop; else ok.
 */
function decideStatus(issues: readonly Issue[], hasSupported: boolean, atoms: number): ChangeStatus {
  if (issues.some((i) => i.code.startsWith('limit_'))) return 'incomplete';
  if (!hasSupported) return 'unsupported';
  if (issues.some((i) => LISTING_CODES.has(i.code))) return 'incomplete';
  if (atoms === 0) return 'noop';
  return 'ok';
}

/**
 * Analyses one change. Throws ChangeRejectedError (src/core/safety.ts) for malformed input and plan 6.1 rejections
 * (paths, binary, invalid UTF-8). Over-limit inputs return `incomplete`: per-file over-limit files are skipped; a
 * whole-change cap (files, total bytes, changed atoms) skips analysis (hunks, metrics and functions are empty).
 */
export function analyze(input: ChangeV1, options: AnalyzeOptions = {}): AnalysisV1 {
  assertAcceptable(input);
  const issues: Issue[] = [...(options.externalIssues ?? [])];
  const limits = checkLimits(input);
  issues.push(...limits.issues);

  const states: FileState[] = input.files.map((f) => {
    const baseLF = normaliseText(f.base);
    const headLF = normaliseText(f.head);
    return {
      path: f.path,
      role: fileRoleOf(f.path),
      kind: sourceKindOf(f.path),
      baseLF,
      headLF,
      basePresent: sidePresent(f.base),
      headPresent: sidePresent(f.head),
      changed: baseLF !== headLF,
      overLimit: limits.overLimitPaths.has(f.path),
      baseParsed: null,
      headParsed: null,
      failed: false,
      baseMap: null,
      headMap: null,
      entries: [],
      hunks: [],
      catchSpans: [],
      unreachableSpans: [],
      tokenCache: {},
      importCache: {},
    };
  });
  for (const s of states) {
    if (s.kind === null && s.changed) {
      issues.push(makeIssue('unsupported_extension', 'changed file with an unsupported extension', s.path));
    }
  }
  const hasSupported = states.some((s) => s.kind !== null && (s.basePresent || s.headPresent));
  const analysable = states.filter((s) => s.kind !== null && !s.overLimit);

  let hunks: Hunk[] = [];
  let metrics: HunkMetrics[] = [];
  let functions: FunctionRecord[] = [];
  let totals = atomTotals([]);
  let hunkCount = 0;

  if (!limits.stop && hasSupported) {
    for (const s of analysable) {
      if (s.changed) s.hunks = computeFileHunks(input.id, s.path, s.role, s.baseLF, s.headLF);
    }
    const allHunks = analysable.flatMap((s) => s.hunks);
    totals = atomTotals(allHunks);
    hunkCount = allHunks.length;
    const atomIssue = checkAtomLimit(totals.atoms);
    if (atomIssue !== null) {
      issues.push(atomIssue);
    } else {
      const overLimitProductionHead = states.some(
        (s) => s.overLimit && s.kind !== null && s.role === 'production' && s.headPresent,
      );
      ({ hunks, metrics, functions } = analyseFiles(analysable, allHunks, issues, overLimitProductionHead));
    }
  }

  const files: AnalysedFile[] = states.map((s, i) => {
    const f = input.files[i] as ChangeV1['files'][number];
    return {
      path: s.path,
      role: s.role,
      kind: s.kind,
      baseSha256: sideHash(f.base),
      headSha256: sideHash(f.head),
      baseParseFailed: s.baseParsed === null ? null : s.baseParsed.failed,
      headParseFailed: s.headParsed === null ? null : s.headParsed.failed,
    };
  });
  const fileHashes: Record<string, { base: string | null; head: string | null }> = {};
  for (const f of files) fileHashes[f.path] = { base: f.baseSha256, head: f.headSha256 };

  return {
    schema: 's45.analysis/1',
    changeId: input.id,
    status: decideStatus(issues, hasSupported, totals.atoms),
    issues,
    files,
    hunks,
    metrics,
    functions,
    totals: {
      files: input.files.length,
      changedFiles: states.filter((s) => s.changed).length,
      hunks: hunkCount,
      atoms: totals.atoms,
      baseAtoms: totals.baseAtoms,
      headAtoms: totals.headAtoms,
      manualHunks: metrics.filter((m) => m.manual).length,
    },
    inputHashes: { change: changeInputHash(input), files: fileHashes },
  };
}

/** Parsing, function maps, test references, catches, unreachable statements, clones and per-hunk metrics. */
function analyseFiles(
  analysable: FileState[],
  allHunks: Hunk[],
  issues: Issue[],
  overLimitProductionHead: boolean,
): { hunks: Hunk[]; metrics: HunkMetrics[]; functions: FunctionRecord[] } {
  const lineSets = fileLineSets(allHunks);

  for (const s of analysable) {
    const kind = s.kind as SourceKind;
    if (s.basePresent) s.baseParsed = parseSide(s.path, 'base', kind, s.baseLF);
    if (s.headPresent) s.headParsed = parseSide(s.path, 'head', kind, s.headLF);
    for (const parsed of [s.baseParsed, s.headParsed]) {
      if (parsed !== null && parsed.failed) {
        issues.push(makeIssue('parse_failure', `${parsed.diagnosticCount} parse diagnostic(s)`, s.path, parsed.side));
      }
    }
    s.failed = (s.baseParsed?.failed ?? false) || (s.headParsed?.failed ?? false);
    if (s.baseParsed !== null && !s.baseParsed.failed) s.baseMap = collectSideFunctions(s.baseParsed.sourceFile, s.path, 'base');
    if (s.headParsed !== null && !s.headParsed.failed) s.headMap = collectSideFunctions(s.headParsed.sourceFile, s.path, 'head');
    if (!s.failed) {
      s.entries = buildFunctionEntries(s.role, s.baseMap, s.headMap, lineSets.get(s.path) ?? emptySideLines());
      if (s.headParsed !== null) {
        if (s.role === 'production') s.catchSpans = findSwallowingCatches(s.headParsed.sourceFile, s.path);
        s.unreachableSpans = findUnreachableStatements(s.headParsed.sourceFile, s.path);
      }
      if (s.role === 'production') {
        const ambiguousKeys = new Set(
          s.entries.filter((e) => e.record.class === 'ambiguous').map((e) => e.record.key as string),
        );
        for (const key of ambiguousKeys) {
          issues.push(makeIssue('ambiguous_function', `duplicate function key ${key}`, s.path));
        }
      }
    }
  }

  // docs/METRICS.md section 8 inputs. An over-limit or unparseable production head hides function names, and an
  // unparseable changed test head hides references: the test-reference value is then 'unknown' everywhere.
  const productionHeads: SideFunction[] = [];
  const changedTestHeads: { path: string; sourceFile: ts.SourceFile }[] = [];
  let blocked = overLimitProductionHead;
  for (const s of analysable) {
    if (s.role === 'production' && s.headPresent) {
      if (s.headMap === null) blocked = true;
      else productionHeads.push(...s.headMap.functions);
    }
    if (s.role === 'test' && s.changed && s.headPresent) {
      if (s.headParsed === null || s.headParsed.failed) blocked = true;
      else changedTestHeads.push({ path: s.path, sourceFile: s.headParsed.sourceFile });
    }
  }
  const testRefs = buildTestReferenceContext(productionHeads, changedTestHeads, blocked);
  for (const s of analysable) {
    for (const entry of s.entries) entry.record.noChangedTestReference = testReferenceValue(entry, testRefs);
  }

  // D13: clones over every parseable head-side file (all roles).
  const cloneFiles = analysable
    .filter((s) => s.headParsed !== null && !s.headParsed.failed)
    .map((s) => ({ path: s.path, tokens: leafTokens((s.headParsed as ParsedSide).sourceFile) }));
  const clonePairs = findClonePairs(cloneFiles);

  const metrics: HunkMetrics[] = [];
  for (const s of analysable) {
    for (const hunk of s.hunks) metrics.push(hunkMetrics(hunk, s, clonePairs));
  }
  return { hunks: allHunks, metrics, functions: analysable.flatMap((s) => s.entries.map((e) => e.record)) };
}
