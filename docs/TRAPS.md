# TRAPS: clean near-misses (N1–N8) and arm-B matching traps

Version `traps-v1` · plan of record PLAN.md revision 4.1, 7.2 step 2, 7.3, 8.1, 8.11; Claude planner C§6.4 and Codex
planner "Eight predeclared near-miss classes" · status: **draft, unfrozen** (hashed into `docs/FREEZE.md`).

Part of the corpus-author packet. A **near-miss** is a clean change (no planted defect) that contains code a reviewer or
a structural heuristic could mistake for risk: necessary defensive code, deliberate duplication, correct complexity or a
safe large refactor. Near-misses measure false alarms. They are behavioural controls, not promised false positives: a
near-miss that nothing flags is also reported.

## 1. Rules for every near-miss

1. One near-miss change per root (plan 7.2 step 2), authored by C1 from the root's base, separate from the clean feature
   change and its defect heads. Label `kind: 'near_miss'`, `trapIds` lists every trap it covers (one near-miss may cover
   several), `cleanWitnesses` and `baseSanityReceipts` present.
2. **Each of N1–N8 appears at least twice per split** (Gate 1 predicate 2).
3. The trap pattern lies on lines the near-miss change **adds or modifies** (otherwise it is not part of the change).
4. The change is **clean**: every hidden witness of the root passes on the near-miss head; base-sanity tests pass on base.
   At least one hidden witness exercises the trap's defensive behaviour and would fail if that behaviour were removed
   (for example N1: an untyped caller passes `null` and the witness asserts the `TypeError`).
5. Ordinary noise is allowed (formatting, comments, test edits) as in clean feature changes; size guidance as for clean
   changes (4–20 hunks, 40–400 changed atoms, plan D11b).
6. No trap may be built by copying a defect operator's output; near-misses are written as correct code from a spec.

## 2. The eight traps

| id | pattern the near-miss must contain | why it is correct | named failure (plan 8.11) |
|---|---|---|---|
| **N1** entry guard | An exported entry point with a typed, non-nullable parameter that adds a runtime guard such as `if (!req) throw new TypeError(...)` (or an equivalent early return) | JavaScript callers can still pass `null`/`undefined`; the type does not protect the runtime | `N1-entry-guard` |
| **N2** best-effort catch | A `try { … } catch (e) { … }` around optional work (telemetry, metrics, cache warm-up) whose catch only logs (e.g. `console.warn(...)` or a logger call) and continues | Failure of optional work must not fail the main operation; the swallow is deliberate and documented in the spec | `N2-best-effort-catch` |
| **N3** default throw | A `switch` over a string-literal union (or enum-like constant set) with a `default:` that throws on an "impossible" value | Runtime safety for values that bypass the type system (deserialised input, JS callers) | `N3-default-throw` |
| **N4** duplicated validators | Two near-identical validator functions (several lines each, token-for-token alike apart from names) for two schemas the spec says will diverge | Deliberate duplication; merging would couple schemas that must evolve separately | `N4-duplicated-validators` |
| **N5** complex but correct | A transition table or state machine extended with several new branches (`if`/`case`/conditional chains) in one function, all specified and witnessed | Necessary branching; complexity reflects the spec, not a mistake | `N5-complex-correct` |
| **N6** large safe refactor | A large behaviour-preserving mechanical change: rename across many lines, extract a helper, reorder members, convert callbacks to async/await without changing behaviour | Many changed lines, no behaviour change; witnesses identical before and after | `N6-large-refactor-size-desc` |
| **N7** unchanged test covers | A changed production function (new branch or rewrite, several statements) whose behaviour is exercised only by a test file that the change does **not** modify | The existing test already covers it; the change needs no new test | `N7-unchanged-test-covers` |
| **N8** parse then validate | `JSON.parse(x) as unknown` (or another untyped boundary such as `await res.json()`) followed by explicit structural validation (`typeof` checks, `Array.isArray`, field checks) before use | The cast to `unknown` is the safe pattern; validation is the defensive code, not a smell | `N8-parse-then-validate` |

## 3. (moved)

Builder predictions were moved to `docs/PREREGISTRATION.md` section 12 (builder-only; not in the corpus-author packet).

## 4. Arm-B matching traps (dev only)

Arm B (a reviewer port with a keyless mock; no live model) is scored with a localization matcher (plan 8.8): a comment
localizes a defect when it has the same path and side and its line range overlaps a required atom widened by 2 lines,
and the comment spans at most 10 atoms; each defect is counted once; duplicate and unmatched comments are published.
Three traps test the matcher. They exist **only in dev** (as matcher test cases under `tests/fixtures/`, and optionally
as dev examples from C1); they never enter the held-out split and never the arm-A results.

| id | setup | expected matcher result |
|---|---|---|
| **B1** right file, wrong function | One defect with required atom at line `r` in function `f`; a comment on the same path and side whose range lies inside a different function `g`, whose line range lies entirely outside `[r − 2, r + 2]` | not a localization hit (the range does not overlap `[r − 2, r + 2]`); counted as unmatched |
| **B2** whole-file comment | One defect; a comment covering the whole file (more than 10 atoms of the change in its range) | rejected as overbroad (spans more than 10 atoms), not a hit, even though it overlaps the required atom |
| **B3** two defects close together | Two required-atom sets within 4 lines of each other in one dev matcher fixture; one comment overlapping both widened ranges, and a second comment overlapping only the first | the first comment localizes both defects; the second is a duplicate for the first defect; each defect is counted once (localization recall 2/2, 1 duplicate) |

A localization hit is not proof that a comment understood the defect ("localization hit", never "found").
