# fixtures/demo — builder engineering fixtures (NOT study data)

These three changes were written by the builders to exercise the analyser, the policy and the slicer, and to give the
M3/M4 reviewers hand-computed known answers (plan D32). They are **never** part of the study corpus, never used for
tuning and never reported as results. The independent corpus lives in `corpus/` only after Gate 1.

| file | change id | what it exercises |
|---|---|---|
| `rate-limiter-feature.json` | `demo-rate-limiter-feature` | 9 hunks over 3 changed files: import insertion, comment-only edit (T0a), interface and class fields, a modified method with 9 statements but a changed test reference, a new function with cyclomatic delta 4, a new file whose catch only logs (`catch_may_swallow`), a test-file edit (T0d), two unchanged files in the payload |
| `format-reorder.json` | `demo-format-reorder` | import rotation split into two hunks (T0c), line-break-only reformat (T0b), one-token edit in a 12-statement function with no changed test (untested-size rule) |
| `badge-tsx.json` | `demo-badge-tsx` | TSX component whose render branches give delta 4, a pure deletion inside it, deletion of an exported arrow function at the end of the file |

Each `<name>.json` is a `ChangeV1` (`schemas/change.schema.json`); each `<name>.expected.md` holds the hand-computed hunk
coordinates, atoms, function map, cyclomatic base/head/delta, statement counts, catch flags, test-reference values, tiers
at T = 4, N = 8 (with the other five candidates noted) and the tier-policy, size-asc and size-desc orders with their 10/20/30%
prefixes.

Construction notes:
- Base and head texts were written so that no changed block contains a line equal to the unchanged line just before or
  after it, which keeps the minimal line diff unique. The coordinates were cross-checked with `git diff --no-index -U0`
  (myers, minimal, patience, histogram) and GNU `diff -U0`; the product's own `diffLines` result is checked by the M3
  test `tests/demo-expected.test.ts` (not run in Dirty Mode).
- All texts use LF line endings and end with a newline.
- `npm run demo` (M5) analyses `rate-limiter-feature.json`.
