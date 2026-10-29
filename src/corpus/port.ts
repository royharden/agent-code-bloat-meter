// plan 7.4 / 7.5 / 9 M2: corpus port, error classes and the held-out commitment shape.
// This module names no label type. The full CorpusPort (which includes the scorer-only `labels` method) is
// re-exported as a type for the scorer side; analysis code depends on CorpusInputsPort instead (plan 9 G4).
import type { ChangeV1, CorpusManifestV1, Split } from './contract';

export type { CorpusPort, CorpusManifestV1, ChangeV1, Split } from './contract';

/**
 * plan 7.4: thrown when a corpus source cannot supply data at all: the S41 adapter (always), the own corpus before
 * Gate 1 admits it, or the held-out split before it has been released into a scratch directory.
 */
export class CorpusUnavailable extends Error {
  readonly source: 's45-own' | 's41-adapter';

  constructor(source: 's45-own' | 's41-adapter', message: string) {
    super(message);
    this.name = 'CorpusUnavailable';
    this.source = source;
  }
}

/**
 * plan 7.5 / D26: thrown when corpus bytes do not match the manifest or the held-out commitment, when a path escapes
 * its split directory, or when a reader is pointed at the sealed custody folder. Never caught and ignored: any
 * integrity failure stops the run before analysis or scoring.
 */
export class CorpusIntegrityError extends Error {
  readonly path: string | null;

  constructor(message: string, path: string | null = null) {
    super(message);
    this.name = 'CorpusIntegrityError';
    this.path = path;
  }
}

/**
 * Analysis-side view of a corpus: the manifest and the change inputs, never labels (plan 9 G4). Every CorpusPort is
 * structurally a CorpusInputsPort, so analysis code can accept either without naming the label side.
 */
export interface CorpusInputsPort {
  manifest(): Promise<CorpusManifestV1>;
  inputs(split: Split): AsyncIterable<ChangeV1>;
}

/**
 * plan 7.5: `corpus/heldout.commitment.json`, delivered by C1 and copied into the repo by the gate operator after a
 * Gate 1 pass. It commits to every byte of the sealed held-out split before the freeze.
 * - `manifestSha256`: sha256 of the edition manifest file `manifest.json` (exact bytes).
 * - `files`: every file of the held-out split, keyed exactly as in the manifest (`heldout/...`), value sha256 hex.
 *   It must equal the manifest's `files` restricted to keys starting with `heldout/`.
 * - `siteInventoryHash`, seeds and `edition`: equal to the manifest's values.
 * The repo-level "commitment hash" recorded in preregistration.json is the sha256 of this file's exact bytes.
 */
export interface HeldoutCommitmentV1 {
  schema: 's45.heldout-commitment/1';
  edition: string;
  authorSession: string;
  manifestSha256: string;
  splitSeed: 45;
  placementSeed: 450045;
  siteInventoryHash: string;
  files: Record<string, string>;
}
