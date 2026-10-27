# format-reorder: hand-computed expectations

**Builder engineering fixture, not study data.** Input: `fixtures/demo/format-reorder.json` (`ChangeV1`, id
`demo-format-reorder`). Hand-computed from PLAN.md revision 4.1 sections 6 and 8.2 (`docs/METRICS.md` m1,
`docs/POLICY.md`) at **T = 4, N = 8**. Exercises: an import reorder that the line diff splits into two hunks (T0c), a
line-break-only reformat (T0b), and a one-token edit inside a large function with no changed test (the untested-size
rule). Coordinates cross-checked with `git diff --no-index -U0` (myers, minimal, patience, histogram) and GNU `diff -U0`,
all identical; hashes with `sha256sum`.

## File

`src/format.ts`, production, base 23 lines, head 24 lines. Both sides parse. No test file is in the change.

Change: the three imports are rotated (`clamp, padStart, Row` → `padStart, Row, clamp`); `cell`'s return statement is
split over two lines with no token change; in `formatRow` the default width `8` becomes `12`.

## Hunks and atoms

| hunk | (baseStart, baseCount, headStart, headCount) | atoms | # | content | hunk id (prefix) | tie key (prefix) |
|---|---|---|---|---|---|---|
| F1 | (1, 1, 0, 0) | `b1` | 1 | `import { clamp } from './math';` removed from the top | `db412dc4` | `95d565b5` |
| F2 | (3, 0, 3, 1) | `h3` | 1 | the same import re-added after `import type { Row }` | `09c4da60` | `63c8285b` |
| F3 | (6, 1, 6, 2) | `b6 h6 h7` | 3 | `return padStart(value, clamp(width, 1, 40));` split over two lines | `585f5248` | `f63780a3` |
| F4 | (13, 1, 14, 1) | `b13 h14` | 2 | `widths[i] ?? 8` → `widths[i] ?? 12` | `61ac5769` | `ad44320a` |

Why two hunks for the reorder: the longest common subsequence of `[clamp, padStart, Row]` and `[padStart, Row, clamp]` is
the unique `[padStart, Row]`, so the minimal diff deletes `clamp` at base line 1 and inserts it after base line 3.

**L = 1 + 1 + 3 + 2 = 7. K@10 = floor(70/100) = 0; K@20 = floor(140/100) = 1; K@30 = floor(210/100) = 2.**

## Function map

| key | class | base span | head span | changed | cyclomatic base / head / delta | head statements | `no_changed_test_reference` |
|---|---|---|---|---|---|---|---|
| `src/format.ts#<top>` | matched | lines 1–3 | lines 1–3 | yes (b1, h3) | 1 / 1 / 0 | 0 (imports only) | unknown (`<top>`) |
| `src/format.ts#cell` | matched | 5–7 | 5–8 | yes | 1 / 1 / 0 | 1 | **true** |
| `src/format.ts#formatRow` | matched | 9–23 | 10–24 | yes | 4 / 4 / 0 | **12** | **true** |

- `formatRow` decision points: `for-of` (base 12 / head 13), `??` (13 / 14), `?:` (18 / 19) → 4 on both sides.
- `formatRow` head statements: `const parts`, `let total`, `for-of`, `const width`, `const text`, `parts.push(...)`,
  `total += text.length`, `const sep`, `const line`, `total += ...`, `console.debug(...)`, `return line` = **12**.
- Test reference: no test file is added or modified, so no identifier is found: `true` for both uniquely named changed
  functions.
- Catches: none. Unreachable statements: none. Token clones: not hand-computed (diagnostic only).

## Per-hunk tier inputs and tier (T = 4, N = 8)

| hunk | intersecting functions | maxPositiveDelta | catch_may_swallow | untested statement max | T0a | T0b | T0c | T0d | manual | **tier** | reason |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F1 | `<top>` (base line 1) | 0 | no | 0 | no | no | **yes** | no | no | **0** | import reorder |
| F2 | `<top>` (head line 3) | 0 | no | 0 | no | no | **yes** | no | no | **0** | import reorder |
| F3 | `cell` | 0 | no | 1 | no | **yes** | no | no | no | **0** | token sequences equal (line break only) |
| F4 | `formatRow` | 0 | no | **12** | no | no | no | no | no | **2** | 12 statements ≥ N and no changed test reference |

T0c holds for F1 and F2 because each one's only changed line lies inside a top-level `ImportDeclaration` and the multiset
of whitespace-normalised import texts is the same on both sides. Under every one of the six candidates F4 is tier 2
(12 ≥ 8 and 12 ≥ 12) and F1–F3 are tier 0.

## Orders and budget prefixes (T = 4, N = 8)

Tie-key ascending: F2 `63c8…` < F1 `95d5…` < F4 `ad44…` < F3 `f637…`.

| ordering | hunk order | 10% (K = 0) | 20% (K = 1) | 30% (K = 2) |
|---|---|---|---|---|
| tier-policy | **F4** · then tier 0 **F2, F1, F3** | nothing | `b13`; F4 partial | `b13 h14`; F4 read, no partial |
| size-asc | **F2, F1** (1 atom each, by tie key), **F4** (2), **F3** (3) | nothing | `h3`; F2 read | `h3 b1`; F2, F1 read |
| size-desc | **F3** (3), **F4** (2), **F2, F1** | nothing | `b6`; F3 partial | `b6 h6`; F3 partial |
