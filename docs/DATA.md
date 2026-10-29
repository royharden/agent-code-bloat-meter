# DATA: corpus sources, generation recipe, Gate 1, independence and custody

Plan of record PLAN.md revision 4.1, sections 7.1–7.5 with D1, D8, D11b, D12b, D16–D18, D26, D30, D34–D36 · status:
**draft, unfrozen** (hashed into `docs/FREEZE.md`; the corpus manifest's `recipeHash` is the sha256 of this file's frozen
bytes unless C1 declares a later recipe edition).

> **Gate 1: PENDING — needs Roy to appoint the independent corpus author/custodian C1 and to authorise Normal-mode
> witness execution (ROY-DECISIONS-REQUEST R1, open).** Gate 1 cannot pass in Dirty Mode. Until it passes there is no
> dev tuning, no freeze, no held-out release and no result. If it fails, S45 is skipped in execution with the failed
> predicate named; it is never downgraded or replaced by builder-authored labels.

Part of the corpus-author packet. Companion documents: `docs/FAMILIES.md` (operators), `docs/TRAPS.md` (near-misses),
`docs/ATOMS.md` (hunks, atoms, reading order, parse rule, PRNG), `src/corpus/contract.ts` (types) and the JSON schemas
`schemas/{change,label,corpus-manifest,receipt,placement}.schema.json`.

## 1. Sources and licences (plan 7.1)

All corpus content is **original, synthetic and MIT-licensed**, written for this study: root modules, ordinary tests,
feature specs, clean feature changes, near-misses, operators, hidden witnesses and labels. No public dataset, no imported
pull request or patch, no client, Gauntlet or partner text, no personal or production material. AIDev is not used.
Builder-authored files under `fixtures/demo/` and `tests/fixtures/` are engineering fixtures, never study data.

## 2. Who does what (independence)

- **C1, the independent corpus author and custodian**, is one session that is not any builder of this product and never
  sees product code. C1 receives only the **corpus-author packet** (outer shell `corpus-author-packet\`), works only in
  its own outer-shell folder `corpus-author-work\` (never the inner repo), and writes its own generator and witness
  harness (`corpus-gen/`, in that folder) and its own `check-data` utility. C1's session id is registered in the project's
  AgentNamer registry and must differ from every builder's.
- **Builders** (the integrator and every session it spawns) never author corpus roots, feature changes, defect heads,
  witnesses, site inventories, labels or the independent worksheet, and never write `corpus-gen/`.
- **Gate operator**: a Roy-appointed non-builder Normal-mode session that runs C1's `check-data`, independently
  rechecks every predicate and records the outcome. Only after a pass, it copies dev into `corpus/dev/`, the approved
  full-edition manifest metadata into `corpus/manifest.json`, and `corpus/heldout.commitment.json`. It directs C1 (or a
  separately Roy-appointed non-builder custodian) to seal held-out contents and write custody receipts. Only the
  appointed custodian writes `sealed\heldout\` and `sealed\custody\`; an operator may also do so only if explicitly
  appointed custodian. Builders never read or write those contents.
- Expected answers are C1's generator labels plus executed witness receipts, produced before any analysis of the corpus.

## 3. Generation recipe (plan 7.2; C1 only)

**Step 0 — split first, before any change is written (D12b).** Fix the 40 root ids and each root's stratum (TSX if the
root module is a `.tsx` component, else TS). Within each stratum, sort the root ids ascending (ordinal string order),
shuffle them with a **fresh** `mulberry32(45)` generator per stratum (`docs/ATOMS.md` section 11; Fisher–Yates), and send
the first `ceil(n / 2)` roots of the stratum to **held-out** and the rest to **dev**. If rounding would make a split differ
from 20 roots (an odd TSX count), C1 adjusts the stratum sizes before step 1 (for example an even TSX count); each split
must get at least 4 TSX roots.

**Step 1 — roots.** 40 root modules (20 per split, ≥ 4 TSX per split), each 40–200 lines, typical of small agent tasks
(rate limiter, CSV row validator, LRU cache, permission service, paginated fetch wrapper with injected fetch, retry
helper, date-range parser, config loader, event queue, money formatter, path sanitiser, state machine, and similar), with
ordinary vitest tests. Per root, a **hidden witness suite** (scorer-only, stored beside and never inside the change trees)
and **base-sanity tests**.

**Step 2 — changes.** Per root: one feature spec (one paragraph) and one **clean feature change** (4–20 hunks, 40–400
changed atoms, D11b) with ordinary noise (renames, formatting, comment edits, test edits, defensive code where the spec
calls for it); and one **clean near-miss change** from `docs/TRAPS.md`, each of N1–N8 at least twice per split.

**Step 3 — eligible-site inventory.** Per clean feature change, list every eligible site from explicit syntax/contract
applicability (`docs/FAMILIES.md` C1–C8), never from any measured property of the code, with byte anchors and site and
operator ids. Site region: lines the feature **added**, plus, for base-deletion operators only, base statements inside
functions the feature modifies that the clean head kept. The inventory hash is frozen **before** any draw.

**Step 4 — placement (seed 450045).** Deterministic quota matching assigns each root's two defect slots to **distinct**
eligible families so that every family has **exactly 5** defect heads per split, in distinct roots, and so that each split
has **at least one base-deletion defect** (a reserved slot among `null_optional` / `authz_weakened` /
`state_cache_lifecycle` base-deletion sites). Ties in the matching are broken by a seeded shuffle; the site within a
root/family is a uniform choice among its eligible sites in recorded inventory order; all draws come from one
`mulberry32(450045)` generator in a documented order. The `PlacementRecordV1` records the quota, every assignment with its
candidates and chosen index, and every rejection. An infeasible quota is an admission failure. No reseeding after any
analysis of the corpus; repair only before Gate 1, with a new recipe edition and the failed records retained.

**Step 5 — operators and required atoms.** Apply the drawn operator (`docs/FAMILIES.md`); derive `requiredAtoms` and
`anchorKind` mechanically (`docs/ATOMS.md` section 10): `edited` = the defect head atoms of the edited feature-added
lines; `r-del-gap` = the head neighbour atoms of the gap; `base-deletion` = the base deletion atoms. `signatureBearing` is
true only for the empty-catch operator.

**Step 6 — integrity.** Whole roots, with their tests, twins, defect heads and near-miss, stay in their step-0 split.
Declared shared boilerplate is grouped; normalised fingerprints prevent renamed copies of a root counting as different
roots. Every `ChangeV1` payload includes the **whole root module tree** (unchanged files with base = head, D36).

**Witness semantics (D17).** A **feature witness** passes on the clean feature head and fails on the defect head with an
**assertion failure at the named test**; it need not pass on base. Separate **base-sanity** tests pass on base. Clean heads
and near-misses pass all their witnesses. Compile, import, dependency or timeout failures do not count as a defect
witness. Each execution emits a `WitnessReceiptV1`.

Every admitted change has at least one `baseSanityReceipts` entry. Label witness/base-sanity paths are relative to
`<split>/witnesses/<rootId>/`. Each receipt selects one delivered test file with command
`["vitest", "run", "<split>/witnesses/<rootId>/<path>"]`, optionally followed by
`["--testNamePattern", "<pattern>"]`. For a defect pair the selection is required: `<pattern>` is `^` + the full
`defect.witnessTest` runner title with every regex metacharacter escaped + `$`. The clean-pass and defect-failure
receipts use the identical command, `testHash` and `harnessVersion`; pass has exit code 0 and no `failedTest`, assertion
failure has a nonzero integer exit code and the named `failedTest`. Other failures/timeouts have nonzero integer exit
codes and never count as witness evidence. Side/source change through the harness's isolated working tree, never by
changing test bytes or selection.

**Delivered-test identity check (Gate 1 predicate 1):** C1's `check-data` and the independent gate operator both bind
every label path and defect command target to its committed witness file and compare its actual exact-byte sha256 to
the manifest file hash and receipt `testHash`. They reject absent files, path substitutions and mismatched bytes, then
independently verify that the command selects the named test and reconstruct the executed source tree to check
`sourceHash`. C1 documents the source-tree hashing algorithm and working-directory setup in `corpus-gen/`/provenance;
the operator reproduces them. Product `checkReceiptReferences` and `checkDeliveredTestIdentity` check receipt relations
and manifest identity without execution; these checks alone do not prove actual witness execution.

**Twin size balance (D18).** On dev, the median over defect heads of (defect change total atoms / clean twin total atoms)
must lie in **[0.67, 1.5]**; actual paired costs are published (twins do not automatically preserve hunk sizes).

## 4. Counts per split

20 roots · 20 clean feature changes · 40 defect heads (5 per family, 2 per root, distinct families per root) ·
20 near-misses · each N1–N8 ≥ 2 · ≥ 4 TSX roots · ≥ 1 base-deletion defect. 80 changes per split, 160 in total, 40
planted defects per split. These are 20 independent roots per split, not 80 independent samples.

## 5. Gate 1 predicates (plan 7.3; Normal mode; all must hold)

1. **Witnesses:** every admitted defect's witness passes on its clean twin and fails on the defect head with an assertion
   failure at the named test; base-sanity passes on base; every clean head and near-miss passes all its witnesses;
   equivalent mutants are listed.
2. **Counts:** per split 20 roots, 20 clean changes, 40 defects (5 per family), 20 near-misses; each trap ≥ 2; ≥ 4 TSX
   roots; ≥ 1 base-deletion defect; every input parses on both present sides under the `docs/ATOMS.md` section 9 rule;
   payloads include the whole root module tree.
3. **Integrity and provenance:** schemas validate; no split overlap; commitment hashes verify; provenance lists C1's
   harness, model and session id; C1's session id differs from every builder's, verified through the AgentNamer registry.
4. **Balance:** dev size balance in [0.67, 1.5]; family-eligibility counts published.
5. **Independent worksheet:** C1's own worksheet for the `docs/ATOMS.md` rules (budget 0, a cut hunk, an R-del gap, a
   replacement block, equal primary keys resolved by the tie key) is delivered.
6. **Atoms exist (D34):** every `requiredAtoms` entry of every admitted defect is an atom of its own change under the
   `docs/ATOMS.md` definition, checked by C1's harness with the pinned `diff` version; the product lockfile pins the same
   version.

**No-go:** S45 is skipped in execution, with the failed predicate named.

## 6. Contract (plan 7.4)

The canonical types are `src/corpus/contract.ts` (copied into the packet): `ChangeV1`, `Split`, `Family`, `Atom`,
`LabelV1`, `WitnessReceiptV1`, `PlacementRecordV1`, `CorpusManifestV1`, `CorpusPort`. Change ids are **opaque and
label-neutral** (they reveal nothing about kind, family or twin). Inputs never contain labels, witnesses or inventories.
`OwnCorpusSource` is the default corpus source; `S41CorpusSource` throws `CorpusUnavailable`. S41 never replaces this
corpus (D30): S41 held-out data may only ever be scored as a separate "external replication" table under the plan's
conditions.

## 7. Custody (plan 7.5, D26)

- Before Gate 1 the whole delivery remains in C1's custody. After Gate 1, held-out sources, tests, labels, witnesses,
  receipts and site inventories live **only** in outer `sealed\heldout\` (custody receipts in `sealed\custody\`)
  until the held-out run releases them. The appointed non-builder custodian performs this sealing.
- **Explicit metadata exception, integrator reconciliation 2026-10-27:** after Gate 1 and before freeze, the operator
  may copy exactly one full-edition `CorpusManifestV1` to `corpus/manifest.json`, alongside the held-out commitment.
  This contract-required metadata exposes root ids/splits/TSX flags, change-to-root links, author/custodian provenance,
  recipe/family/inventory hashes, seeds, and all committed file paths and hashes (including label hashes). It contains
  no held-out source, label values, witness/test bytes, receipts or inventory contents. Paths must remain label-neutral;
  the operator checks this before copying. No additional held-out content is authorized. The commitment binds the
  exact full manifest bytes. Frozen PLAN-FINAL revision 4.1 remains unchanged; this bounded reconciliation must also
  be recorded in the freeze receipt and held-out runbook.
- Builders receive **dev only**, and only after Gate 1.
- The held-out run creates an exclusive attempt record before any held-out byte is read, releases inputs only, hashes all
  predictions before labels are released, and may resume only as an identical-hash continuation; any change of code,
  data or protocol after that point spends the held-out set.
- After the final attempt, the corpus, C1's harness and the witnesses are published for reconstruction. Later replays are
  reproductions, not new unseen evaluations.
