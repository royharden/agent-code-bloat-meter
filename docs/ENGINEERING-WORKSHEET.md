# ENGINEERING WORKSHEET: builder known answers for the slicer

**Builder engineering known-answer test only — not study data and not the independent worksheet.** Plan of record
PLAN.md revision 4.1, sections 6.2, 8.6, D16, D19, D32. Excluded from the corpus-author packet (plan 7.6). The
independent Gate 1 worksheet is authored by C1 (or another non-builder session) from `docs/ATOMS.md` alone.

Rules applied (`docs/ATOMS.md`): atoms within a hunk are base atoms then head atoms, each ascending; the reading sequence
concatenates hunks in ordering order; `K = floor(p × L / 100)`; a defect is exposed iff all its required atoms are in the
first `K`; a hunk is partial if some but not all of its atoms are in the first `K`.

Orderings used here: `size-desc` (atoms per hunk descending) and `size-asc` (ascending), ties by tie key ascending. Atoms
are written `b<n>` (base line n) and `h<n>` (head line n); each worksheet change has one file, so the path is omitted in
the sequences.

Hunk ids and tie keys below were computed with `sha256sum` over the UTF-8 string without a trailing newline
(`printf '%s' "<string>" | sha256sum`), lowercase hex. Tests recompute them at test time; only the **order** of the tie
keys matters, and only in W4.

| change | hunk | path | (baseStart, baseCount, headStart, headCount) | atoms | hunk id (prefix) | tie key (prefix) |
|---|---|---|---|---|---|---|
| ws-1 | A | a.ts | (5, 2, 5, 3) | 5 | `6379257e…` | `c0cad767…` |
| ws-1 | B | a.ts | (12, 0, 14, 2) | 2 | `fd1bbf1d…` | `e32fb287…` |
| ws-2 | C | b.ts | (3, 0, 4, 12) | 12 | `20d788a4…` | `8c277df3…` |
| ws-2 | D | b.ts | (30, 3, 42, 5) | 8 | `48b780b6…` | `53d2a82d…` |
| ws-3-defect | E | c.ts | (9, 0, 10, 5) | 5 | `6da4bcc0…` | `97eeb9b0…` |
| ws-3-defect | F | c.ts | (20, 1, 25, 2) | 3 | `e5992586…` | `c7445f4b…` |
| ws-4 | G | d.ts | (2, 0, 3, 3) | 3 | `2fde6fe4…` | `f33ba343…` |
| ws-4 | H | d.ts | (10, 3, 12, 0) | 3 | `cea9ea8d…` | `82b40e43…` |
| ws-4 | I | d.ts | (20, 2, 20, 2) | 4 | `71c4faa7…` | `d8f18174…` |

Full W4 values (the only ones that decide an order):
- G: hunk id `2fde6fe4166b464c7fb543ef2f6e42c0d4750ca2b5aad619f9f06f0afc53896c`, tie key `f33ba3437932d991b208e51668b4382ad212443aa94fb3e46f2198439f847c2d`
- H: hunk id `cea9ea8d5490efc03a3ebe5bd8077c441bd0f07626e95e12ef06231d8b97102e`, tie key `82b40e43acde7641bb2c1c76705579f05779b670ca97d23886fa5a6fb5585b6e`
- I: hunk id `71c4faa74a7cd54c957ca369b6e314371bc1c807cf10d645105efa48112675b3`, tie key `d8f181746940de1a7dcef424408b2e67dcb767142962739f6e97ef68af0fe023`

## Property coverage

| property (plan 8.6) | where |
|---|---|
| budget 0 (K = 0) | W1 at 10%, W3 at 10% |
| cut hunk (partial at the boundary) | W1 (A at 20%, 30% size-desc; B at 20% size-asc), W2 (every budget), W3, W4 |
| R-del gap | W3 (gap inside the hunk: two required atoms), W3b (gap at the hunk start: one required atom) |
| replacement block (base atoms before head atoms) | W1 A, W2 D, W3 F, W4 I |
| equal tie keys (equal primary key resolved by tie key) | W4 (G and H both 3 atoms) |

Slicer null check, verified in every row below: exactly `K` of the `L` single-atom markers are exposed at each budget,
so the exposure rate is `floor(p × L / 100) / L` for every ordering.

## W1 — budget 0 and a replacement block

Change `ws-1`, one file `a.ts`. A replaces base lines 5–6 with head lines 5–7; B inserts head lines 14–15 after base
line 12 (base 12 = head 13 after A's +1 offset).

- Atoms: A = `b5 b6 h5 h6 h7` (deletions first), B = `h14 h15`. **L = 7.**
- **K@10 = floor(70 / 100) = 0; K@20 = floor(140 / 100) = 1; K@30 = floor(210 / 100) = 2.**

| ordering | sequence | 10% (K=0) | 20% (K=1) | 30% (K=2) |
|---|---|---|---|---|
| size-desc | A, B: `b5 b6 h5 h6 h7 h14 h15` | nothing read; no partial | `b5`; A partial | `b5 b6`; A partial |
| size-asc | B, A: `h14 h15 b5 b6 h5 h6 h7` | nothing read; no partial | `h14`; B partial | `h14 h15`; B read, no partial |

Exposed single-atom markers: 0, 1, 2 of 7 at 10/20/30% in both orderings.
Example defect with `requiredAtoms = {a.ts head 6}` (`edited`): position 4 under size-desc, 6 under size-asc →
**not exposed** at any budget.

## W2 — cut hunks

Change `ws-2`, one file `b.ts`. C inserts head lines 4–15 after base line 3 (12 lines, offset +12, so base 29 = head 41);
D replaces base lines 30–32 with head lines 42–46.

- Atoms: C = `h4 … h15` (12), D = `b30 b31 b32 h42 h43 h44 h45 h46` (8). **L = 20.**
- **K@10 = 2; K@20 = 4; K@30 = 6.**

| ordering | 10% (K=2) | 20% (K=4) | 30% (K=6) |
|---|---|---|---|
| size-desc (C, D) | `h4 h5`; C partial | `h4 h5 h6 h7`; C partial | `h4 h5 h6 h7 h8 h9`; C partial |
| size-asc (D, C) | `b30 b31`; D partial | `b30 b31 b32 h42`; D partial | `b30 b31 b32 h42 h43 h44`; D partial |

Exposed single-atom markers: 2, 4, 6 of 20.
- Defect `{b.ts head 9}`: size-desc position 6 → exposed at **30% only** (the K-th atom is inside the prefix);
  size-asc position 14 → never.
- Defect `{b.ts head 43}`: size-asc position 5 → exposed at **30% only**; size-desc position 17 → never.

## W3 — R-del gap

Clean twin `ws-3-clean`, file `c.ts`: one insertion of head lines 10–17 after base line 9, where clean-head lines 12–14
are a guard statement (`if (!user) {`, `  throw new Error('no user');`, `}`), and one replacement of base line 20 by
clean-head lines 28–29. Clean L = 8 + 3 = 11 (shown only for comparison).

Defect `ws-3-defect` = clean head with `null_optional.delete-guard` removing clean-head lines 12–14 (feature-added →
`r-del-gap`). Diff base → defect head:
- E = insertion `(9, 0, 10, 5)`: defect-head lines 10–14 = clean-head lines 10, 11, 15, 16, 17. The gap lies between
  defect-head lines 11 and 12.
- F = replacement `(20, 1, 25, 2)` (offset +5 after E, so base 19 = head 24): `b20 h25 h26`.
- **requiredAtoms = {c.ts head 11, c.ts head 12}** (both neighbours of the gap, same hunk).
- **L = 8; K@10 = 0; K@20 = 1; K@30 = 2.**

| ordering | sequence | 10% (K=0) | 20% (K=1) | 30% (K=2) | defect exposed? |
|---|---|---|---|---|---|
| size-desc (E 5, F 3) | `h10 h11 h12 h13 h14 b20 h25 h26` | nothing | `h10`; E partial | `h10 h11`; E partial | **no** at every budget: at 30% `h11` is read but `h12` is not |
| size-asc (F, E) | `b20 h25 h26 h10 h11 h12 h13 h14` | nothing | `b20`; F partial | `b20 h25`; F partial | **no** (positions 5 and 6) |

Exposed single-atom markers: 0, 1, 2 of 8. A slicer that required only the atom before the gap would wrongly report
exposure at 30% under size-desc; this row catches that.

**W3b — gap at a hunk edge.** Same clean twin shape but the guard is clean-head lines 10–12 (the start of the inserted
block). Defect `ws-3b-defect`: E' = `(9, 0, 10, 5)` holds clean-head lines 13–17 as defect-head 10–14; F' =
`(20, 1, 25, 2)`. The gap is before defect-head line 10, the first head atom of E', so **requiredAtoms = {c.ts head 10}**
only. size-desc (E', F'): position 1 → exposed at 20% and 30%, not at 10% (K = 0). size-asc (F', E'): position 4 → never.

## W4 — equal primary keys resolved by the tie key

Change `ws-4`, file `d.ts`. G inserts head lines 3–5 after base line 2 (offset +3, base 9 = head 12); H deletes base
lines 10–12 (head line 12 is the line after which the deletion sits; offset back to 0, base 13 = head 13); I replaces
base lines 20–21 with head lines 20–21.

- Atoms: G = `h3 h4 h5`, H = `b10 b11 b12`, I = `b20 b21 h20 h21`. **L = 10; K@10 = 1; K@20 = 2; K@30 = 3.**
- G and H tie at 3 atoms. Tie keys: H `82b40e43…` < G `f33ba343…`, so **H precedes G** in both size orderings.

| ordering | sequence | 10% (K=1) | 20% (K=2) | 30% (K=3) |
|---|---|---|---|---|
| size-asc (H, G, I) | `b10 b11 b12 h3 h4 h5 b20 b21 h20 h21` | `b10`; H partial | `b10 b11`; H partial | `b10 b11 b12`; H read, no partial |
| size-desc (I, H, G) | `b20 b21 h20 h21 b10 b11 b12 h3 h4 h5` | `b20`; I partial | `b20 b21`; I partial | `b20 b21 h20`; I partial |

Exposed single-atom markers: 1, 2, 3 of 10.
- Marker `{d.ts base 10}`: size-asc exposed at **10%, 20% and 30%**; size-desc position 5 → never.
- Marker `{d.ts head 3}`: size-asc position 4 → never; size-desc position 8 → never.
- An implementation that broke the G/H tie the other way (or by input order) would read `h3` first under size-asc and
  never expose `{base 10}`: this row catches it.
