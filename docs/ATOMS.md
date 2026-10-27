# ATOMS: the shared change, hunk and atom definition (rules only)

Version `atoms-v1` · plan of record PLAN.md revision 4.1, sections 6.2, 7.2 step 5, D16, D19, D34, D35, 8.5 (PRNG) ·
status: **draft, unfrozen** (hashed into `docs/FREEZE.md` at the freeze).

This document is the single definition of hunks, atoms and reading order that the product **and** the independent
corpus author (C1) both implement (plan D34). It is part of the corpus-author packet. It contains rules only: no
worked answers, and nothing about how hunks are analysed or prioritised. C1's harness must implement these rules with the
same package versions and options; any difference makes a `requiredAtoms` entry unreachable and fails Gate 1
predicate 6.

## 1. Pinned tools

| tool | use | version |
|---|---|---|
| `diff` (npm, pure JavaScript, "jsdiff") | line diff, `diffLines` | candidate **7.0.0**; the exact version is recorded here at the first Normal-mode install and must equal the product lockfile pin |
| `typescript` (npm) | parse check (section 9) | candidate **5.9.3**; same recording rule |

Until the first install these are candidates, not verified pins (see `docs/DEFERRED-VALIDATION.md`). A harness that
cannot use these exact versions must not produce labels.

## 2. Input

A change is a `ChangeV1` (`src/corpus/contract.ts`):
`{ schema: 's45.change/1', id, files: [{ path, base: string | null, head: string | null }] }`.
`base = null` means the file is added by the change; `head = null` means it is deleted. A file present on both sides
with identical normalised text (section 3) produces no hunks.

## 3. Normalisation (for comparison only)

For each side of each file:

1. If the side is `null` or the empty string, it contributes **no lines**: its normalised text is the empty string
   and step 4 is not applied.
2. Otherwise replace every CRLF (`\r\n`) with LF (`\n`).
3. Then replace every remaining CR (`\r`) with LF.
4. If the text does not end with LF, append one LF.

Line `i` (1-based) of a side is the `i`-th LF-terminated line of its normalised text. Normalisation is used only for
diffing, line numbering and parsing; the sha256 of the **original** bytes of each side is kept unchanged.

## 4. Line diff

Per file, call `diffLines(baseLF, headLF)` from the pinned `diff` package with **no options argument** (defaults: no
`ignoreWhitespace`, no `newlineIsToken`, no `stripTrailingCr`, no `maxEditLength`, no callback). The result is a list of
parts in order; each part is unchanged, `removed` or `added`. The number of lines in a part is the number of LF
characters in its `value` (every normalised line ends with LF, so this equals the part's line count).

Walk the parts keeping two counters, `b` (base lines consumed) and `h` (head lines consumed), both starting at 0.
An unchanged part of n lines advances both by n; a removed part advances `b`; an added part advances `h`.

## 5. Hunks

A **hunk** is a maximal run of consecutive parts that are each `removed` or `added`, with no unchanged part inside the
run (zero context lines). For a hunk let `baseCount` = total removed lines and `headCount` = total added lines, and let
`b0`, `h0` be the counter values just before the run. Coordinates follow the unified-diff convention:

- `baseStart = b0 + 1` if `baseCount > 0`, else `baseStart = b0` (the base line after which the insertion sits; 0 at
  the start of the file);
- `headStart = h0 + 1` if `headCount > 0`, else `headStart = h0` (the head line after which the deletion sits).

An added file (base `null`/empty) is one hunk `(0, 0, 1, n)`; a deleted file is one hunk `(1, n, 0, 0)`.

**Hunk id** = lowercase hex sha256 of the UTF-8 string
`changeId + "|" + path + "|" + baseStart + "|" + baseCount + "|" + headStart + "|" + headCount`,
integers written in base 10 without padding or sign.

## 6. Atoms

An **atom** is `{ path, side, line }`: one per removed line (`side: 'base'`, base line number) and one per added line
(`side: 'head'`, head line number). Every atom belongs to exactly one hunk. **Within a hunk, all base atoms come first
in ascending line order, then all head atoms in ascending line order.** `L` = the number of atoms of the whole change
(all files). A change with `L = 0` is a no-op and is not admissible.

## 7. Tie key

**Tie key** of a hunk = lowercase hex sha256 of the UTF-8 string `"s45-tie-v1|" + changeId + "|" + hunkId`.
Whenever an ordering of hunks has equal primary keys, hunks are ordered by tie key ascending (plain ordinal comparison
of the 64-character hex strings). No other tie-breaker exists.

## 8. Reading order, integer budget and exposure

Given an ordering of the change's hunks (a permutation of all its hunks), the **reading sequence** is the concatenation
of each hunk's atoms (section 6 order) in hunk order. For a budget percent `p` in {10, 20, 30} the reader takes the first

    K = floor(p × L / 100)

atoms, computed in integer arithmetic. `K = 0` reads nothing. A hunk is **read** if all its atoms are among the first
`K`, **partial** if some but not all are, **unread** otherwise; at most one hunk is partial at a given `K`.

A planted defect is **exposed** at budget `p` if and only if **every** atom in its `requiredAtoms` is among the first `K`
atoms. Context lines are never charged and never count towards exposure.

## 9. Parse rule (D35)

For each non-null, non-empty side of each `.ts` / `.tsx` file, parse the **normalised** text (section 3) with

    ts.createSourceFile(path, textLF, ts.ScriptTarget.Latest, /* setParentNodes */ true,
                        path ends with ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

using the pinned `typescript`. The side **fails to parse** if the returned source file's `parseDiagnostics` array is
non-empty. No `Program`, no type checker, no tsconfig, no module resolution, no evaluation. The extension test is on the
lower-cased path. A side that is `null` or empty is not parsed and is not a failure.

## 10. Required atoms (labels)

A defect change is the diff **base → defect head** (never clean head → defect head). Its label's `requiredAtoms` is a
non-empty set of atoms **of that defect change** under sections 3–6, chosen by the operator's anchor kind
(`docs/FAMILIES.md` says which operator uses which kind):

- **`edited`**: the head atoms of the defect-head lines the operator edited. Edits are applied only to lines the clean
  feature change added, so each edited line is an added line of the defect change. A swap of two lines has two edited
  lines.
- **`r-del-gap`** (rule R-del, D16): the operator removed a statement the clean feature change had **added**. Removed
  added code leaves no atom of its own. The required atoms are the head atoms immediately **before** and **after** the
  gap, in head line order, **within the same hunk** of the defect change; if the gap is at the start or end of the
  hunk's head atoms there is only one such neighbour and only that atom is required. A site whose removal would leave its
  hunk with no head atom (the removed statement is all the added lines of its hunk) is ineligible
  (`rejected.reason = 'empties_hunk'`).
- **`base-deletion`**: the operator removed a statement that exists in the **base** and that the clean head kept. The
  required atoms are the base atoms of the defect change that the clean change does not have:
  `requiredAtoms = baseAtoms(defect change) \ baseAtoms(clean change)` (same base file, so base line numbers compare
  directly). This equals the removed statement's base lines unless the line diff reports the same deletion on a shifted,
  textually identical run of lines; the set difference is used in either case.

Checks (all mechanical, Gate 1 predicate 6): every `requiredAtoms` entry must be an atom of its **own** change (looked up
by the label's `changeId`, never the clean twin's); `requiredAtoms` must be non-empty and must not mix sides except as
the anchor kind allows (`edited` and `r-del-gap` are head-side, `base-deletion` is base-side). If an operator's edit makes
an edited line textually equal to a neighbouring unchanged line, so that the line diff no longer reports it as added,
the required atom does not exist: the site cannot be admitted and is recorded as rejected (reason `infeasible`); the
mapping is never adjusted to a different atom.

## 11. Deterministic PRNG (shared by the split, placement and every seeded procedure)

Generator: **mulberry32** over a uint32 state, written with explicit 32-bit truncation:

```ts
function mulberry32(seed: number): () => number {     // returns uint32 values
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
```

This gives the same bits as the common published mulberry32 (`var t = a += 0x6D2B79F5; ...`) for every draw before
that untruncated form loses double precision (about 4.9 million draws); the published form usually divides the result
by 2^32, here the uint32 is returned and the division happens in `index`. Implementations use the truncating form above.

- **index(n)** for an integer `n ≥ 1`: draw `x = next()` and return `floor(x × n / 2^32)`, a value in `[0, n)`. With
  `n ≤ 2^21` the product is below 2^53 and exact in IEEE-754 doubles.
- **Fisher–Yates shuffle** of an array `a` of length `n`, in place: for `i` from `n − 1` **down to** 1, let
  `j = index(i + 1)` and swap `a[i]` and `a[j]`. One draw per `i`, in that order; no draw for `i = 0`.
- **Uniform choice** among `n` candidates in a recorded order: the candidate at `index(n)`.
- Seeds: split seed **45** (plan 7.2 step 0, `docs/DATA.md` section 3), placement seed **450045** (plan 7.2 step 4). A
  seed is used exactly as the uint32 value given; one generator instance per procedure as specified where the procedure
  is defined.

A golden vector (first outputs of `mulberry32(45)`) is recorded by the first Normal-mode run and is unverified until then.

## 12. What this document does not contain

No analysis rules, no prioritisation rules, no thresholds and no worked examples. Builders' worked answers for these rules
live in a builder-only file that is not part of the corpus-author packet; C1 writes its own independent worksheet (plan
8.6) covering budget 0, a cut hunk, an R-del gap, a replacement block and equal primary keys resolved by the tie key.
