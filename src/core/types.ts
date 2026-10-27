// plan 6: analysis-side types. The corpus contract (src/corpus/contract.ts) is canonical for ChangeV1, Atom, Split.
// This module is type-only and imports no label types (plan 9 G4).
import type { Atom } from '../corpus/contract';

export type { ChangeV1, Atom, Split } from '../corpus/contract';

/** Diff side. Deleted lines are on `base`, added lines on `head`. */
export type Side = 'base' | 'head';

/** plan 6.1: role is derived from the path by a fixed filename rule, never taken from input. */
export type FileRole = 'production' | 'test' | 'config';

/** Rule version stamped on every metric value. */
export type RuleVersion = 'm1';

/** plan 6.3: a 1-based inclusive line range on one side of one file. */
export interface Span {
  path: string;
  side: Side;
  startLine: number;
  endLine: number;
}

/** plan 6.3: every metric is `value | 'unknown'` with rule version and supporting spans. */
export interface MetricValue<T> {
  value: T | 'unknown';
  ruleVersion: RuleVersion;
  spans: Span[];
}

/**
 * plan 6.2: a maximal consecutive changed block (zero context) from `diffLines` on LF-normalised text.
 * id = sha256(`changeId|path|baseStart|baseCount|headStart|headCount`) hex.
 * Unified-diff convention: pure insertion has baseCount = 0 and baseStart = the base line after which it is
 * inserted (0 at file start); a pure deletion has headCount = 0 and headStart = the head line after which it sits.
 * `atoms`: deletion (base) atoms first, then addition (head) atoms, each in line order.
 */
export interface Hunk {
  id: string;
  path: string;
  role: FileRole;
  baseStart: number;
  baseCount: number;
  headStart: number;
  headCount: number;
  atoms: Atom[];
}

/** plan 6.3 function map classes. */
export type FunctionClass = 'matched' | 'new' | 'deleted' | 'anonymous' | 'ambiguous';

/** plan 6.3: a changed matched function is "modified", a changed new function is "added". */
export type FunctionChangeKind = 'modified' | 'added';

/**
 * plan 6.3: one entry of the function map.
 * key = `path#chain/name` (null for anonymous functions, which fold into their nearest named enclosing function).
 * `<top>` is the synthetic per-file function (name '<top>', chain '').
 * Spans run from node.getStart() to node.getEnd() (leading comments excluded); null on the side where the
 * function does not exist. `<top>` uses `topLines` instead of a contiguous span.
 */
export interface FunctionRecord {
  key: string | null;
  path: string;
  role: FileRole;
  name: string | null;
  chain: string;
  isTop: boolean;
  class: FunctionClass;
  baseSpan: Span | null;
  headSpan: Span | null;
  /** `<top>` only: lines of module-level statements counted into `<top>`, per side. */
  topLines?: { base: number[]; head: number[] };
  changed: boolean;
  changeKind: FunctionChangeKind | null;
  /** Cyclomatic complexity per side (null where the side does not exist). */
  cyclomaticBase: MetricValue<number> | null;
  cyclomaticHead: MetricValue<number> | null;
  /** Matched: head − base; new: head − 1; deleted: 'unknown' (not used for growth). */
  cyclomaticDelta: MetricValue<number>;
  /** Head-side statement count (plan 6.3 counted kinds); 'unknown' when there is no head side. */
  statementCount: MetricValue<number>;
  /**
   * plan 6.3 / D6: true if no Identifier with the bare name occurs in the head AST of any test file added or
   * modified in the change; false if one does; 'unknown' for `<top>`, anonymous, ambiguous or non-unique names,
   * and for functions that are not changed production functions.
   */
  noChangedTestReference: MetricValue<boolean>;
}

/** plan 6.3: why a hunk is `manual`. Nothing else makes a hunk manual. */
export type ManualReason = 'parse_failure' | 'ambiguous_function';

/**
 * plan 6.3 / 8.2: per-hunk metric values and the tier inputs the policy needs. Tiering itself lives in
 * src/policy (M4); thresholds T and N are applied there.
 */
export interface HunkMetrics {
  hunkId: string;
  /** Size: atoms in the hunk (deleted + added), and per side. */
  atomCount: number;
  baseAtomCount: number;
  headAtomCount: number;
  /** Keys of functions (matched/new/`<top>`) whose spans intersect an atom of the hunk on the matching side. */
  intersectingFunctionKeys: string[];
  /** Max positive cyclomatic delta over intersecting matched/new production functions, else 0. */
  maxPositiveDelta: MetricValue<number>;
  /** Changed catch (production only): an intersecting catch clause flagged `catch_may_swallow`. */
  catchMaySwallow: MetricValue<boolean>;
  /**
   * Max statement count over intersecting changed production functions with noChangedTestReference = true,
   * else 0. The tier-2 size rule fires when this is >= N.
   */
  untestedChangedStatementMax: MetricValue<number>;
  /** Token clones (D13): duplicated added atoms in this hunk; spans are the clone origins. Diagnostic only. */
  duplicatedAddedAtoms: MetricValue<number>;
  /** Unreachable statements (D14) introduced in this hunk; diagnostic only, never a tier rule. */
  unreachableStatements: MetricValue<number>;
  /** plan 8.2 tier-0 inputs. */
  t0aTriviaOnly: boolean;
  t0bTokenEqual: boolean;
  t0cImportReorder: boolean;
  t0dTestFile: boolean;
  /** plan 6.3: `manual` iff a touched file failed to parse (D35) or an atom hits an ambiguous production function. */
  manual: boolean;
  manualReasons: ManualReason[];
}

/** plan 8.2: tier 2 > tier 1 > tier 0 in reading order; `manual` is ordered together with tier 2. */
export type Tier = 0 | 1 | 2 | 'manual';

/**
 * plan 6.1: `ok` analysed; `incomplete` over-limit or changed unsupported files listed (cannot enter the study);
 * `noop` no atoms (never a successful zero); `unsupported` nothing analysable (no `.ts`/`.tsx` content).
 */
export type ChangeStatus = 'ok' | 'incomplete' | 'noop' | 'unsupported';

/** plan 6.1 rejection and listing codes. */
export type IssueCode =
  | 'path_absolute'
  | 'path_drive'
  | 'path_unc'
  | 'path_dotdot'
  | 'path_backslash'
  | 'path_empty_segment'
  | 'path_nul'
  | 'path_case_collision'
  | 'path_duplicate'
  | 'content_binary'
  | 'content_invalid_utf8'
  | 'limit_files'
  | 'limit_file_bytes'
  | 'limit_total_bytes'
  | 'limit_changed_atoms'
  | 'unsupported_extension'
  | 'parse_failure'
  | 'ambiguous_function'
  | 'git_symlink'
  | 'git_submodule';

export interface Issue {
  code: IssueCode;
  path?: string;
  side?: Side;
  message: string;
}

/** Per-file analysis facts. Hashes are sha256 hex of the original (un-normalised) bytes. */
export interface AnalysedFile {
  path: string;
  role: FileRole;
  /** `.ts`/`.tsx` (lowercase extension) or null when unsupported. */
  kind: 'ts' | 'tsx' | null;
  baseSha256: string | null;
  headSha256: string | null;
  /** D35: true when createSourceFile reports parseDiagnostics on that side; null where the side is absent. */
  baseParseFailed: boolean | null;
  headParseFailed: boolean | null;
}

export interface AnalysisTotals {
  files: number;
  changedFiles: number;
  hunks: number;
  atoms: number;
  baseAtoms: number;
  headAtoms: number;
  manualHunks: number;
}

/** plan 6: the output of `analyze(input: ChangeV1)` (M3). Contains no label, family, trap or witness data. */
export interface AnalysisV1 {
  schema: 's45.analysis/1';
  changeId: string;
  status: ChangeStatus;
  issues: Issue[];
  files: AnalysedFile[];
  hunks: Hunk[];
  /** One entry per hunk, same order as `hunks`. */
  metrics: HunkMetrics[];
  functions: FunctionRecord[];
  totals: AnalysisTotals;
  /** sha256 hex of the canonical ChangeV1 input, plus per-file original byte hashes. */
  inputHashes: {
    change: string;
    files: Record<string, { base: string | null; head: string | null }>;
  };
}
