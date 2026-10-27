# badge-tsx: hand-computed expectations

**Builder engineering fixture, not study data.** Input: `fixtures/demo/badge-tsx.json` (`ChangeV1`, id
`demo-badge-tsx`). Hand-computed from PLAN.md revision 4.1 sections 6 and 8.2 (`docs/METRICS.md` m1,
`docs/POLICY.md`) at **T = 4, N = 8**. Exercises: a TSX component (`ScriptKind.TSX`) whose render branches raise its
cyclomatic delta, a pure deletion inside that component (which inherits the component's tier through its base span), and
the deletion of a whole exported arrow function at the end of the file. Coordinates cross-checked with
`git diff --no-index -U0` (myers, minimal, patience, histogram) and GNU `diff -U0`, all identical; hashes with `sha256sum`.

## File

`src/Badge.tsx`, production, base 21 lines, head 19 lines. Both sides parse as TSX. No test file is in the change.

Change: the `console.log` in `Badge` is removed; the markup gains `icon ?? <i …/>`, `label || 'untitled'`,
`shown > 99 ? '99+' : shown` and `shown < 0 ? <em>invalid</em> : null`; the exported `badgeTitle` arrow and the blank
line before it are deleted.

## Hunks and atoms

| hunk | (baseStart, baseCount, headStart, headCount) | atoms | # | content | hunk id (prefix) | tie key (prefix) |
|---|---|---|---|---|---|---|
| B1 | (11, 1, 10, 0) | `b11` | 1 | `console.log('render badge', label);` deleted | `84e25d5b` | `8bcd2bd9` |
| B2 | (14, 3, 13, 4) | `b14 b15 b16 h13 h14 h15 h16` | 7 | three markup lines replaced by four | `3f3606c9` | `49cb8b54` |
| B3 | (20, 2, 19, 0) | `b20 b21` | 2 | blank line + `export const badgeTitle = …` deleted at end of file | `ee8994ad` | `94925bf2` |

**L = 1 + 7 + 2 = 10. K@10 = 1; K@20 = 2; K@30 = 3.**

## Function map

| key | class | base span | head span | changed | cyclomatic base / head / delta | head statements | `no_changed_test_reference` |
|---|---|---|---|---|---|---|---|
| `src/Badge.tsx#Badge` | matched | 9–19 | 9–19 | yes (b11, b14–b16, h13–h16) | 3 / 7 / **+4** | 2 | **true** |
| `src/Badge.tsx#badgeTitle` | deleted | 21–21 | — | yes (b21) | 1 / — / unknown (deleted: not used for growth) | unknown (no head side) | not evaluated (deleted) |
| `src/Badge.tsx#<top>` | matched | lines 1, 3–7 | lines 1, 3–7 | no | 1 / 1 / 0 | 0 | not evaluated |

- `Badge` base decision points: `??` (line 10), `&&` (16) → 3. Head: `??` (10), `??` (13), `||` (14), `&&` (15), `?:` (15),
  `?:` (16) → 7. JSX elements add nothing. Delta = 7 − 3 = **4**.
- `Badge` head statements: `const shown`, `return (…)` = 2.
- `badgeTitle` is an arrow function named by its variable declarator; the `export const badgeTitle = …` statement is a
  variable statement initialising a function, so it is not part of `<top>`. Base line 20 is blank and lies in no span.
- Test reference: no test file in the change → `true` for `Badge` (unique name).
- Catches: none. Unreachable statements: none. Token clones: not hand-computed (diagnostic only).

## Per-hunk tier inputs and tier (T = 4, N = 8)

| hunk | intersecting functions | maxPositiveDelta | catch_may_swallow | untested statement max | T0a | T0b | T0c | T0d | manual | **tier** | reason |
|---|---|---|---|---|---|---|---|---|---|---|---|
| B1 | `Badge` (base atom 11 in base span 9–19) | **4** | no | 2 | no | no | no | no | no | **2** | Badge delta 4 ≥ T |
| B2 | `Badge` | **4** | no | 2 | no | no | no | no | no | **2** | Badge delta 4 ≥ T |
| B3 | `badgeTitle` (deleted: contributes no delta) | 0 | no | 0 | no | no | no | no | no | **1** | |

B1 changes nothing that raises complexity itself, but a hunk takes the maximum positive delta of every matched/new
production function it intersects, so it is tier 2 with B2. Under `T2-*` and `T4-*` candidates B1 and B2 are tier 2;
under `T6-N8` and `T6-N12` (4 < 6) all three hunks are tier 1. N never matters here (2 statements).

## Orders and budget prefixes (T = 4, N = 8)

Tie-key ascending: B2 `49cb…` < B1 `8bcd…` < B3 `9492…`.

| ordering | hunk order | 10% (K = 1) | 20% (K = 2) | 30% (K = 3) |
|---|---|---|---|---|
| tier-policy | tier 2: **B2, B1** · tier 1: **B3** | `b14`; B2 partial | `b14 b15`; B2 partial | `b14 b15 b16`; B2 partial |
| size-asc | **B1** (1), **B3** (2), **B2** (7) | `b11`; B1 read | `b11 b20`; B3 partial | `b11 b20 b21`; B3 read, no partial |
| size-desc | **B2** (7), **B3** (2), **B1** (1) | `b14`; B2 partial | `b14 b15`; B2 partial | `b14 b15 b16`; B2 partial |
