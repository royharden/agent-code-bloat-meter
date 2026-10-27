# results/ — not yet measured

**Nothing has been measured.** No dev tuning, no freeze and no held-out run has happened; there is no result, positive,
negative or null.

`scripts/eval.ts` writes `results/results.md` and `results/results.json` once, from the single preregistered held-out
attempt (`docs/PREREGISTRATION.md`), after Gate 1, the dev lock and the freeze. Until then this folder holds only this
README (and, from M6, a "not yet measured" template). Every number in the project README must come from
`results/results.json`; absent values are shown blank or with a status (`not run`, `not captured`, `invalid capture`,
`mock: not measurement`), never as 0%.
