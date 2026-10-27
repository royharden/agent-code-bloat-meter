// plan 7.4: canonical corpus contract (PLAN.md section 7.4, verbatim). Do not edit without a plan revision.
// CorpusUnavailable is defined in M2 (src/corpus/port.ts), not here, so this file stays equal to section 7.4.
export interface ChangeV1 { schema: 's45.change/1'; id: string;
  files: { path: string; base: string | null; head: string | null }[] }
export type Split = 'dev' | 'heldout';
export type Family = 'boundary' | 'null_optional' | 'await_ordering' | 'authz_weakened'
  | 'validation_escaping' | 'error_swallowed_mismapped' | 'state_cache_lifecycle' | 'logic_value';
export interface Atom { path: string; side: 'base' | 'head'; line: number }
export interface LabelV1 { schema: 's45.label/1'; changeId: string; rootId: string; split: 'dev' | 'heldout';
  kind: 'clean' | 'defect' | 'near_miss'; trapIds?: string[];
  defect?: { family: Family; operator: string; siteId: string; requiredAtoms: Atom[];
    anchorKind: 'edited' | 'r-del-gap' | 'base-deletion'; signatureBearing: boolean; cleanTwinId: string;
    witnessTest: string; cleanHeadPassHash: string; headAssertionFailureHash: string };
  cleanWitnesses?: { path: string; headPassHash: string }[];      // required for kind clean | near_miss
  baseSanityReceipts: { path: string; basePassHash: string }[] }
export interface WitnessReceiptV1 { schema: 's45.receipt/1'; changeId: string; side: 'base' | 'head';
  command: string[]; exitCode: number; outcome: 'pass' | 'assertion_fail' | 'other_fail' | 'timeout';
  failedTest?: string; expected?: string; actual?: string; sourceHash: string; testHash: string;
  harnessVersion: string; recordedAt: string; sha256: string /* of the receipt without this field */ }
export interface PlacementRecordV1 { schema: 's45.placement/1'; split: 'dev' | 'heldout'; placementSeed: 450045;
  siteInventoryHash: string; quota: Record<Family, number>;
  assignments: { rootId: string; cleanChangeId: string; slot: 1 | 2; family: Family; candidateSiteIds: string[];
    chosenIndex: number; siteId: string; defectChangeId: string }[];
  rejected: { siteId: string; reason: 'equivalent' | 'unwitnessed' | 'empties_hunk' | 'infeasible'; receipt?: string }[] }
export interface CorpusManifestV1 { schema: 's45.corpus/1'; source: 's45-own' | 's41-adapter'; edition: string;
  authorSession: string; authorHarness: string; authorModel: string; custodianSession: string; licence: 'MIT'; recipeHash: string; familyListHash: string;
  siteInventoryHash: string; splitSeed: 45; placementSeed: 450045;
  roots: { id: string; split: 'dev' | 'heldout'; tsx: boolean }[];
  changes: { id: string; rootId: string; inputHash: string; labelHash: string }[];
  files: Record<string, string> /* path -> sha256 */ }
export interface CorpusPort { manifest(): Promise<CorpusManifestV1>;
  inputs(split: Split): AsyncIterable<ChangeV1>;   // analysis side: never labels
  labels(split: Split): AsyncIterable<LabelV1> }   // scorer only; analysis code cannot import it
