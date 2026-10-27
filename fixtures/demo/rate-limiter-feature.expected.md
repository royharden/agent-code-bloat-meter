# rate-limiter-feature: hand-computed expectations

**Builder engineering fixture, not study data.** Input: `fixtures/demo/rate-limiter-feature.json` (`ChangeV1`, id
`demo-rate-limiter-feature`). Hand-computed from PLAN.md revision 4.1 sections 6 and 8.2 (metric rules `m1`,
`docs/METRICS.md`; policy `docs/POLICY.md`) at **T = 4, N = 8**, before any metric code exists (plan D32). M3 review traces
this file through the code; M4 review re-derives the orders.

Hunk coordinates were constructed to be unambiguous (no changed block contains a line equal to the unchanged line just
before or after it) and were cross-checked with `git diff --no-index -U0` under the myers, minimal, patience and
histogram algorithms and with GNU `diff -U0` (all identical). The product's `diffLines` result is checked in M3 tests
(DEFERRED-VALIDATION). Hunk ids and tie keys were computed with `sha256sum` (`docs/ATOMS.md` sections 5 and 7).

## Files

| path | role | base lines | head lines | status |
|---|---|---|---|---|
| `src/clock.ts` | production | 5 | 5 | unchanged |
| `src/notify.ts` | production | null | 9 | added |
| `src/rate-limiter.test.ts` | test | 12 | 19 | modified |
| `src/rate-limiter.ts` | production | 40 | 58 | modified |
| `src/telemetry.ts` | production | 3 | 3 | unchanged |

All present sides parse (no `parseDiagnostics`); no `manual` hunk.

## Hunks and atoms

Atoms are listed in reading order within the hunk (base atoms first). `rl` = `src/rate-limiter.ts`, `n` =
`src/notify.ts`, `t` = `src/rate-limiter.test.ts`.

| hunk | path | (baseStart, baseCount, headStart, headCount) | atoms | # | content | hunk id (prefix) | tie key (prefix) |
|---|---|---|---|---|---|---|---|
| R1 | rl | (2, 0, 3, 1) | `h3` | 1 | new `import { notifyRejected }` | `769a71c2` | `eaf0d20e` |
| R2 | rl | (4, 1, 5, 1) | `b4 h5` | 2 | header comment reworded | `1690bf7f` | `6d904842` |
| R3 | rl | (7, 0, 9, 1) | `h9` | 1 | interface field `burst?: number;` | `a708d53a` | `8e530ded` |
| R4 | rl | (14, 0, 17, 1) | `h17` | 1 | class field `private rejected = 0;` | `e3976e23` | `03b3ac0d` |
| R5 | rl | (24, 1, 27, 4) | `b24 h27 h28 h29 h30` | 5 | `allow`: cap with burst, count and notify rejections | `f642877c` | `a15a80a3` |
| R6 | rl | (35, 0, 42, 1) | `h42` | 1 | `roll`: `this.rejected = 0;` | `3a0d1384` | `87897e66` |
| R7 | rl | (40, 0, 48, 11) | `h48 … h58` | 11 | blank line + new function `retryAfterMs` | `58e9cc4e` | `6323ad30` |
| R8 | n | (0, 0, 1, 9) | `h1 … h9` | 9 | new file with `notifyRejected` (log-only catch) | `f491b75b` | `a1ecb88e` |
| R9 | t | (6, 0, 7, 7) | `h7 … h13` | 7 | new test "allows a burst above the limit" + blank line | `a5d3393d` | `d3f416d2` |

**L = 1 + 2 + 1 + 1 + 5 + 1 + 11 + 9 + 7 = 38. K@10 = floor(380/100) = 3; K@20 = floor(760/100) = 7;
K@30 = floor(1140/100) = 11.**

## Function map (changed or relevant functions)

Spans are `getStart()..getEnd()` lines. Keys are `path#chain/name`.

| key | role | class | base span | head span | changed | cyclomatic base / head / delta | head statements | `no_changed_test_reference` |
|---|---|---|---|---|---|---|---|---|
| `src/rate-limiter.ts#<top>` | production | matched | lines 1, 2, 5–8, 40 | lines 1–3, 6–10, 47 | yes (h3, h9) | 1 / 1 / 0 | 1 (`DEFAULT_OPTIONS`) | unknown (`<top>`) |
| `src/rate-limiter.ts#RateLimiter/constructor` | production | matched | 16–19 | 19–22 | no | 1 / 1 / 0 | 2 | not evaluated (unchanged) |
| `src/rate-limiter.ts#RateLimiter/allow` | production | matched | 21–29 | 24–35 | yes | 3 / 4 / **+1** | **9** | **false** (`allow` occurs in the changed test) |
| `src/rate-limiter.ts#RateLimiter/roll` | production | matched | 31–37 | 37–44 | yes | 2 / 2 / 0 | 5 | **true** |
| `src/rate-limiter.ts#retryAfterMs` | production | new | — | 49–58 | yes | — / 5 / **+4** (5 − 1) | 6 | **true** |
| `src/notify.ts#<top>` | production | new | — | line 1 | yes (h1) | — / 1 / 0 | 0 | unknown (`<top>`) |
| `src/notify.ts#notifyRejected` | production | new | — | 3–9 | yes | — / 2 / **+1** | 3 | **true** |
| `src/rate-limiter.test.ts#<top>` | test | matched | lines 1, 2, 4, 6–12 | lines 1, 2, 4, 6–19 | yes (h7–h13) | 1 / 1 / 0 | base 6, head 11 (not used: test role) | unknown (`<top>`) |
| `src/rate-limiter.test.ts#fixedClock/now` | test | matched | 4–4 | 4–4 | no | 1 / 1 / 0 | 1 | not evaluated |
| `src/clock.ts#systemClock/now`, `src/telemetry.ts#report` | production | matched | | | no | 1 / 1 / 0 | 1 each | not evaluated |

Decision points:
- `allow` base: `??` (line 23), `if` (24) → 3. Head: `??` (26), `??` (27), `if` (28) → 4.
- `roll`: `if` (base 33 / head 39) → 2 on both sides.
- `retryAfterMs`: `if` (50), `if` (53), `||` (53), `?:` (57) → 5; new, so delta = 5 − 1 = 4.
- `notifyRejected`: `catch` (6) → 2; delta = 1.
- `<top>` of every file, `constructor`, the test arrows, `now`, `report`: no decision points. The arrows passed to
  `describe`/`it` are anonymous with no named ancestor, so they fold into the test file's `<top>`.

Statement counts (head; counted kinds only):
- `allow`: `this.roll()`, `const used`, `const cap`, `if`, `this.rejected += 1`, `notifyRejected(...)`, `return false`,
  `this.counts.set(...)`, `return true` = **9**.
- `roll`: `const t`, `if`, `this.windowStart = t`, `this.counts.clear()`, `this.rejected = 0` = **5**.
- `retryAfterMs`: `if`, `return 0`, `if`, `return 0`, `const remaining`, `return` = **6**.
- `notifyRejected`: `try`, `report(...)`, `console.warn(...)` = **3**.
- `constructor`: 2. `src/rate-limiter.ts#<top>`: imports and the interface are not counted kinds; `export const
  DEFAULT_OPTIONS` is a variable statement → 1. `src/notify.ts#<top>`: import only → 0.
- Test `<top>` (not used): base = `const fixedClock` + `describe(...)` + one `it(...)` + `const limiter` + 2 `expect` = 6;
  head = 1 + 1 + 2 `it(...)` + (`const burstLimiter` + 3 `expect`) + (`const limiter` + 2 `expect`) = 11.

Test reference: the only added or modified test file is `src/rate-limiter.test.ts`; its head identifiers are `describe`,
`expect`, `it`, `RateLimiter`, `fixedClock`, `now`, `burstLimiter`, `limiter`, `limit`, `windowMs`, `burst`, `allow`,
`toBe`. Bare names of head-side production functions are unique across the change (`<top>` ×4 excluded, `now`, `report`,
`notifyRejected`, `constructor`, `allow`, `roll`, `retryAfterMs`).

## Catches, clones, unreachable

- **Catch** `src/notify.ts` head lines 6–8 (`catch (err) { console.warn('telemetry unavailable', err); }`): production
  file, intersects head atoms, block holds only a `console.*` call, no throw/return/assignment → **`catch_may_swallow`**
  ("may be intentional"). Applies to R8 (head atoms 6, 7, 8 lie in the clause span).
- **Unreachable statements:** none (every `return` is the last statement of its block).
- **Token clones:** not hand-computed (diagnostic and `clone-first` only; no tier rule uses them).

## Per-hunk tier inputs and tier (T = 4, N = 8)

| hunk | intersecting functions | maxPositiveDelta | catch_may_swallow | untested statement max | T0a | T0b | T0c | T0d | manual | **tier** | reason |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | rl `<top>` | 0 | no | 0 | no | no | no (import multiset changed) | no | no | **1** | |
| R2 | none (comment is leading trivia, outside every span) | 0 | no | 0 | **yes** | yes (both sides have no non-trivia tokens) | no | no | no | **0** | comment only |
| R3 | rl `<top>` | 0 | no | 0 | no | no | no | no | no | **1** | |
| R4 | none (class property) | 0 | no | 0 | no | no | no | no | no | **1** | |
| R5 | `allow` | 1 | no | 0 (`allow` has 9 statements but test reference is false) | no | no | no | no | no | **1** | |
| R6 | `roll` | 0 | no | 5 | no | no | no | no | no | **1** | |
| R7 | `retryAfterMs` | **4** | no | 6 | no | no | no | no | no | **2** | cyclomatic delta 4 ≥ T |
| R8 | notify `<top>`, `notifyRejected` | 1 | **yes** | 3 | no | no | no | no | no | **2** | catch_may_swallow |
| R9 | test `<top>` (test role: no production rule applies) | 0 | no | 0 | no | no | no | **yes** | no | **0** | test file |

Tier-2 set under every candidate: `T2-N8`, `T2-N12`, `T4-N8`, `T4-N12` → {R7, R8}; `T6-N8`, `T6-N12` → {R8} (R7 drops to
tier 1: delta 4 < 6 and 6 statements < 8). All other hunks keep the tiers above under every candidate.

## Orders and budget prefixes (T = 4, N = 8)

Tie-key ascending order of all hunks: R4 `03b3…` < R7 `6323…` < R2 `6d90…` < R6 `8789…` < R3 `8e53…` < R5 `a15a…` <
R8 `a1ec…` < R9 `d3f4…` < R1 `eaf0…`.

| ordering | hunk order |
|---|---|
| tier-policy | tier 2: **R7, R8** · tier 1: **R4, R6, R3, R5, R1** · tier 0: **R2, R9** |
| size-asc | **R4, R6, R3, R1** (1 atom each, by tie key), **R2** (2), **R5** (5), **R9** (7), **R8** (9), **R7** (11) |
| size-desc | **R7** (11), **R8** (9), **R9** (7), **R5** (5), **R2** (2), **R4, R6, R3, R1** (1 each, by tie key) |

| ordering | 10% (K = 3) | 20% (K = 7) | 30% (K = 11) |
|---|---|---|---|
| tier-policy | rl `h48 h49 h50`; R7 partial | rl `h48 … h54`; R7 partial | rl `h48 … h58`; R7 read, no partial |
| size-asc | rl `h17 h42 h9` (R4, R6, R3 read); no partial | + rl `h3` (R1), rl `b4 h5` (R2), rl `b24`; R5 partial | + rl `h27 h28 h29 h30`; R5 read, no partial |
| size-desc | same as tier-policy | same as tier-policy | same as tier-policy |

Without the tie key the size-asc 10% prefix would be undefined (four 1-atom hunks compete for three slots).
