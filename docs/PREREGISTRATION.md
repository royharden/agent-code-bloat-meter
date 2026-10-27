# PREREGISTRATION (prose)

**DRAFT, UNFROZEN.** Plan of record PLAN.md revision 4.1, sections 8.1, 8.3–8.5, 8.7, 8.10, 8.11 with D9, D12, D20, D21.
Machine-readable skeleton: `preregistration.json` (tuned values, comparator and hashes are `null` until the freeze).
Nothing here has been measured. This text becomes binding only when `scripts/freeze.ts` records its hash in
`preregistration.json` and `docs/FREEZE.md` after the dev lock (`docs/POLICY.md` section 4).

**Not part of the corpus-author packet.**

## 1. Question

On a sealed, independently authored synthetic corpus of agent-written TypeScript changes, does ordering each change's
hunks by the frozen structural tier policy **expose** more planted defects within a 20% changed-line budget than the
stronger of the two size orderings, and how much clean and clean-but-defensive code does the policy send to tier 2?
Arm A has no reviewer: it measures allocation, not discovery. One frozen policy, one held-out run. A null result is
likely and is published.

## 2. Endpoints (plan 8.1)

- **Primary:** micro **exposure recall@20** on held-out = exposed held-out defects / admitted held-out defects, where a
  defect is exposed when every one of its required atoms lies in the first `K = floor(20 × L / 100)` atoms of its
  change's reading sequence (`docs/ATOMS.md` section 8).
- **Secondary:** recall@10 and recall@30; macro recall over roots; recall per family; by `signatureBearing`; by
  `anchorKind` (`edited`, `r-del-gap`, `base-deletion`); tier-2 share of all atoms; tier-2 share of clean atoms, clean
  twins and near-misses reported separately; clean changes with any tier-2 hunk; near-misses with a tier-2 hunk, listed by
  trap id; defects per 100 selected atoms; whole-hunk sensitivity (strict non-overflow prefix: only fully read hunks count,
  reading stops before the first hunk that would overflow the budget).

## 3. Primary hypothesis and reading rule

One primary hypothesis: **recall@20(tier-policy) − recall@20(primary size comparator) > 0**, read only from the 95%
paired bootstrap interval. Interval entirely above 0: supported. Positive point estimate with an interval crossing 0:
"inconclusive". Zero or negative: not supported. Everything else is secondary and descriptive. A comparison whose 95%
half-width exceeds 15 percentage points is labelled "imprecise" (D9). No power is promised; the cohort is never extended
after a result.

## 4. Dev lock (plan 8.3)

Before any held-out byte is released: (1) evaluate `size-desc` and `size-asc` on dev at 20% and lock the primary
comparator (tie → `size-asc`); (2) evaluate the six candidates `T ∈ {2,4,6} × N ∈ {8,12}` and select by `docs/POLICY.md`
section 4 subject to the D11 guard, or publish "no valid policy in the declared space" and stop; (3) freeze every protocol
hash into `preregistration.json` and `docs/FREEZE.md`; the held-out evaluator refuses on any mismatch.

## 5. Orderings and baselines (plan 8.4)

All orderings use the identical hunk set of each change and break ties by tie key.

| ordering | rule | status before a run |
|---|---|---|
| `tier-policy` | frozen policy (`docs/POLICY.md`) | not run |
| `size-desc` / `size-asc` | atoms per hunk, descending / ascending | not run |
| `file-type` | `.tsx` production, then `.ts` production, then tests, then config | not run |
| `complexity-only` | `maxPositiveDelta` descending | not run |
| `clone-first` | duplicated added atoms descending | not run |
| `random` | mean over 100 Fisher–Yates permutations, seeds 4500–4599 (D21) | not run |
| `jscpd` | duplicated added atoms from jscpd 4.x JSON, only after a Normal-mode probe | not captured |
| `sarif:fallow` | hunks with introduced findings first, count descending, mapping locked on dev | not captured |
| `lizard` | — | not captured: licence unresolved |
| `label-oracle` | hunks containing required atoms first; an upper bound that uses labels, not a method | not run |
| `full-review` | 100% ceiling, sanity only | not run |

`label-oracle` and `full-review` are computed only after label release and are not part of the hashed predictions file.

## 6. Statistics (plan 8.5, D20, D21)

- **PRNG:** mulberry32 over a uint32 seed; `index(n) = floor(u × n)` with `u = next uint32 / 2^32`; Fisher–Yates runs
  `i` from `n − 1` down to 1 swapping `i` with `index(i + 1)` (`docs/ATOMS.md` section 11).
- **Bootstrap:** percentile, **10,000** resamples, seed **45** used directly; each draw resamples the R held-out roots
  with replacement (each root by `index(R)`), keeping multiplicity; both orderings are computed on the same draw. Micro
  recall per draw = pooled exposed / pooled defects over the drawn roots. Interval = type-7 (linear interpolation)
  quantiles 0.025 and 0.975 of the defined draws; half-width = (hi − lo) / 2. A draw with no defects is undefined; if more
  than 10% of draws are undefined the interval is "undefined".
- **Paired difference** at each budget on the same draws; **Wilson** 95% intervals for single proportions.
- **Random baseline:** for seed `s ∈ 4500..4599` and a change, the per-change uint32 seed is the first 4 bytes
  (big-endian) of `sha256("s45-rand|" + s + "|" + changeId)`; Fisher–Yates over the change's hunks pre-sorted by tie key;
  the reported value is the mean over the 100 seeds.

## 7. Held-out procedure (plan D26, 7.5)

An exclusive attempt record is created before any held-out byte is read. Held-out **inputs** only are released; every
ordering's atom sequence is computed and written to a predictions file whose hash is recorded in the attempt record
**before** any label is released. Then labels are released, `checkRequiredAtomsExist` runs (abort on any miss), and the
results are scored once. A resume is allowed only as an identical-hash continuation; any change of code, data or
protocol after inputs are released spends the held-out set.

## 8. Results table (plan 8.7)

Header: corpus commitment hash, policy hash, preregistration hash, implementation hash, attempt id. Columns:

`ordering | status | roots / defects | recall@10 | recall@20 [95% CI] | recall@30 | Δ@20 vs primary size [95% CI] | tier-2 share all / clean | near-misses flagged | manual hunks | partial-hunk count | provider requests | spent USD`

Status vocabulary: `not run`, `not captured`, `invalid capture`, `measured`, `mock: not measurement`. Absent cells are
blank, never 0%. Below the table: per-family rows, the whole-hunk table, and the arm-B table or "arm B not run". Until a
real attempt exists, `results/` holds only a "not yet measured" template. README numbers come only from `results.json`.

## 9. Stops (plan 8.10)

- Gate 1 fails → S45 is skipped in execution.
- Slicer null check or a worksheet fails → fix on dev only.
- No valid policy in the declared space → publish that and stop.
- Hash mismatch, label leak, split contamination, a required atom that is not a product atom (D34), or a baseline falsely
  marked measured → abort before scoring.
- `manual` hunks are reported, never a reason to abort (D35).
- Arm-B cap reached → stop and publish partial results with all attempts.
- Any code, data or protocol change after held-out inputs are released → the held-out set is spent.

## 10. Named failure list (plan 8.11; published even when every count is zero)

`boundary-flip-no-signal`, `await-removed-no-signal`, `inverted-logic-no-signal`, `tiny-wrong-constant`,
`defect-in-complex-function-no-growth`, `guard-deletion-lowers-complexity`, `N1-entry-guard`, `N2-best-effort-catch`,
`N3-default-throw`, `N4-duplicated-validators`, `N5-complex-correct`, `N6-large-refactor-size-desc`,
`N7-unchanged-test-covers`, `N8-parse-then-validate`, `test-reference-without-assertion`, `tsx-render-branch`,
`test-only-behavior-change`, `partial-hunk-at-budget`, `deletion-required-atoms`, `parse-or-function-map-unknown`,
`clone-normalization-collision`.

Every actual miss and every tier-2 false alarm is listed by id in `docs/LIMITATIONS.md`.

## 11. Cost

Arm A: $0 incremental paid API; local limits 15 minutes and 2 GiB per evaluation run (D25). Arm B: no live adapter; the
ledger cap is $0 and `S45_LIVE=0` (Roy decision R2 open).

## 12. Builder trap predictions (moved from TRAPS.md section 3; builder-only) (for the results write-up only)

These are the builders' advance predictions of which kind of structural signal each trap may trigger. They are **not
instructions**: the corpus author must write each near-miss as natural, correct code from its spec and must not shape it
to trigger or to avoid any signal. Predictions are published with the results whether or not they hold.

| id | predicted structural signal | predicted risk of a false alarm |
|---|---|---|
| N1 | small branch growth | low |
| N2 | the changed-catch signal ("catch may swallow, may be intentional") | high, by design |
| N3 | branch growth | medium |
| N4 | the duplicated-code diagnostic | low to medium |
| N5 | branch growth | high, by design |
| N6 | size: the size-descending ordering reads it first | medium |
| N7 | the "no changed test reference" signal | high, by design |
| N8 | branch growth | medium |
