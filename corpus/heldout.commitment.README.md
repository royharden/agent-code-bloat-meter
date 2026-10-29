# corpus/heldout.commitment.json — what C1 delivers and its shape

Plan of record PLAN.md revision 4.1, sections 7.5, 7.6 and D26. **Not present yet**: Gate 1 is PENDING (needs Roy to
appoint the independent corpus author/custodian C1 and authorise Normal-mode witness execution, ROY-DECISIONS-REQUEST R1).
Builders never write this file; the Normal-mode gate operator copies it here from C1's delivery after a Gate 1 pass.

## Purpose

The held-out split stays sealed in the outer shell (`sealed\heldout\`) until the held-out run. After Gate 1, this
commitment and the explicitly approved full-edition manifest metadata enter the repo before freeze (see DATA section 7
and the integrator's M2 reconciliation); no held-out source, label values, witnesses, receipts or inventory contents do.
The commitment binds every sealed held-out file and the exact manifest bytes, making later changes detectable.

## Files the gate operator places in `corpus/` after Gate 1

| repo path | source in C1's delivery | content |
|---|---|---|
| `corpus/manifest.json` | `manifest.json` | full `CorpusManifestV1` metadata: both splits' ids, root links, TSX flags, provenance, seeds, protocol hashes, file paths and hashes; no source/label/witness contents |
| `corpus/dev/**` | `dev/**` | the dev split |
| `corpus/heldout.commitment.json` | `heldout.commitment.json` | this commitment |

C1 or a separately Roy-appointed non-builder custodian seals `heldout/**` in `sealed\heldout\` (contents of `heldout/`,
so key `heldout/inputs/x.json` is `sealed\heldout\inputs\x.json`) and writes custody receipts. The non-builder gate
operator directs/verifies this step; it writes sealed contents only if also explicitly appointed custodian. All listed
repo copies happen only after a recorded Gate 1 pass and label-neutral path check, never as pre-Gate-1 construction.

## Shape (`HeldoutCommitmentV1`, defined in `src/corpus/port.ts`)

```json
{
  "schema": "s45.heldout-commitment/1",
  "edition": "<manifest.edition>",
  "authorSession": "<manifest.authorSession>",
  "manifestSha256": "<sha256 of the exact bytes of manifest.json>",
  "splitSeed": 45,
  "placementSeed": 450045,
  "siteInventoryHash": "<manifest.siteInventoryHash>",
  "files": {
    "heldout/inputs/<changeId>.json": "<sha256 of the file bytes>",
    "heldout/labels/<changeId>.json": "<sha256 of the file bytes>"
  }
}
```

Rules (checked by `verifyCommitment` in `src/corpus/validate.ts`):

1. No other fields. All hashes are lowercase hex sha256 of exact file bytes (no line-ending conversion).
2. `files` lists **every** file of the held-out split, keyed exactly as in `manifest.json` `files` (relative POSIX
   paths starting with `heldout/`), and equals the manifest's `files` restricted to `heldout/` keys: same keys, same
   hashes.
3. `manifestSha256` equals sha256 of `manifest.json`; `edition`, `authorSession`, `siteInventoryHash` and both seeds equal
   the manifest's values.
4. A held-out directory verified against it contains no file that is not listed.

The "corpus commitment hash" recorded in `preregistration.json` at the freeze is the sha256 of this file's exact bytes;
the "manifest hash" is `manifestSha256`.

## Who uses it

- **Gate operator (Normal mode, Gate 1 predicate 3):** `verifyCommitment(commitmentPath, manifestPath, <C1 delivery>/heldout)`.
- **Product readers:** `OwnCorpusInputs` / `OwnCorpusSource` (`src/corpus/inputs.ts`, `src/corpus/own-source.ts`) read
  held-out files only from a released scratch copy (never a path inside `sealed\`), and refuse any file whose bytes
  differ from the manifest or from this commitment, or a manifest whose sha256 differs from `manifestSha256`.
- **P6 held-out session:** verifies the release copy (inputs first with `allowMissing: true`, labels after the
  predictions hash is recorded).

The full delivery layout and checklist for C1 are in the outer shell's `corpus-author-packet\DELIVERABLES.md`.
