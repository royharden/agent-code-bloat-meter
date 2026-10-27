# POLICY: tier rules, candidate space and dev selection

Plan of record PLAN.md revision 4.1, sections 8.2, 8.3, D10, D11, D12, D19, D22, D35 · machine-readable form:
`policy.json` (candidate space, `selected: null`) · status: **draft, unfrozen**. Thresholds are chosen on dev only, after
Gate 1, and written into `preregistration.json` and `docs/FREEZE.md` by `scripts/freeze.ts`.

**Not part of the corpus-author packet.**

The policy orders the hunks **within one change**. It never scores a change, never pools hunks across changes, and is
applied identically in the product and in the study. Metric inputs are defined in `docs/METRICS.md`; hunks, atoms, tie
key and reading order in `docs/ATOMS.md`.

## 1. Tier assignment (plan 8.2)

Evaluate in this precedence; the first class that applies wins.

1. **`manual`** — the hunk is `manual` (`docs/METRICS.md` section 11: a touched file failed to parse, or an atom hits an
   ambiguous production function). `manual` wins over tier 0 and is shown as "analysis incomplete".
2. **Tier 2** — any of:
   - **R2-cyclomatic:** a matched or new production function intersecting the hunk has cyclomatic delta ≥ **T**
     (`maxPositiveDelta ≥ T`);
   - **R2-catch:** `catch_may_swallow` holds for the hunk;
   - **R2-untested-size:** a changed production function intersecting the hunk has ≥ **N** head-side statements **and**
     `no_changed_test_reference = true` (`'unknown'` never fires).
3. **Tier 0** — no tier-2 rule fires (tier 2 wins over tier 0) and at least one of:
   - **T0a** every changed line on both sides carries no non-trivia token (blank or comment-only), judged from one
     full-file `ts.createScanner(..., skipTrivia = false)` pass per side, so multi-line comments are handled;
   - **T0b** the hunk's base-side and head-side non-trivia token sequences (token kind + token text) are equal: a
     whitespace, comment or line-break formatting change only;
   - **T0c** every changed line lies inside a top-level `ImportDeclaration`, and the multiset of whitespace-normalised
     import declaration texts of that file is equal on both sides (pure reordering of imports);
   - **T0d** the hunk is in a test file.
4. **Tier 1** — otherwise.

Known limitation (disclosed in `docs/LIMITATIONS.md`): the raw scanner pass of T0a can misread `/*` inside a regular
expression or template literal as the start of a comment.

## 2. Reading order

Hunks are read in the order **tier 2 and `manual` together, then tier 1, then tier 0**; within each group by **tie key**
ascending (`sha256("s45-tie-v1|" + changeId + "|" + hunkId)`, lowercase hex, plan D19). The budget is then applied to the
atom sequence exactly as in `docs/ATOMS.md` section 8. The number of `manual` hunks is reported per ordering; `manual`
never causes an abort (D35).

## 3. Candidate space (D10)

Exactly **six** candidates: **T ∈ {2, 4, 6} × N ∈ {8, 12}**, ids `T2-N8`, `T2-N12`, `T4-N8`, `T4-N12`, `T6-N8`, `T6-N12`.
No clone rule (clones stay a diagnostic and the `clone-first` baseline), no fitted weights, no further thresholds.

## 4. Dev lock (plan 8.3; runs only after Gate 1, on dev only)

1. **Primary size comparator (D12).** Evaluate `size-desc` and `size-asc` on dev at the 20% budget. The one with the
   higher dev micro exposure recall@20 becomes the primary comparator; a tie selects `size-asc`. Both stay in every
   results table.
2. **Policy selection.** Evaluate the six candidates on dev at 20%. Keep only candidates that pass the degenerate guard
   (section 5). Select the maximum dev micro exposure recall@20; ties go to the **lower clean tier-2 share**, then the
   **larger T**, then the **larger N**. If no candidate passes the guard, publish "no valid policy in the declared space"
   and stop before any held-out byte is released.
3. **Freeze.** `scripts/freeze.ts` writes the selected T and N, the comparator, the six candidates with their dev values,
   and every protocol hash (metric docs, policy, slicer rules, baselines, seeds, bootstrap rule, missingness policy,
   implementation commit) into `preregistration.json` and `docs/FREEZE.md`. `scripts/eval.ts --split heldout` refuses on
   any hash mismatch.

`scripts/tune.ts` refuses the held-out split. Nothing is tuned after the freeze; there is no post-result extension.

## 5. Degenerate-policy guard (D11)

A candidate is valid only if, on dev, with `manual` atoms counted as tier 2:
- tier-2 atoms ≤ **40%** of **all** dev atoms, and
- tier-2 atoms ≤ **25%** of all **clean** dev atoms, where clean = clean feature twins **and** near-misses pooled.

The twin-only and near-miss-only shares are reported separately but do not enter the guard. Shares are atom-weighted:
`sum of atoms in tier-2 or manual hunks / sum of atoms`, over all changes of the stated set.

## 6. What the policy does not claim

Tier 0 is a low-priority allocation class, not a correctness certificate. Tier 2 is a reading priority, not a defect
prediction. "May be intentional" stays attached to `catch_may_swallow`.

**Endpoint counting (S45-INT, M1 review note 4):** for every tier-2 endpoint (tier-2 atom shares, "clean changes with any tier-2 hunk", "near-misses with a tier-2 hunk") a `manual` hunk counts as tier 2; the `manual` count is also reported separately.
