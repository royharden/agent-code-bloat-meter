# FAMILIES: defect families and mechanical operators

Version `families-v1` · plan of record PLAN.md revision 4.1, D16, D29, 7.2 steps 3–5 (operators from the Claude planner's
C§6.2.5, `logic_value` from the Codex planner) · status: **draft, unfrozen** (hashed into `docs/FREEZE.md`; the corpus
manifest's `familyListHash` is the sha256 of this file's frozen bytes).

Part of the corpus-author packet. It defines **what** may be planted and **where**; it contains no analysis or
prioritisation rule. Line and atom terms (hunk, atom, head/base atom, R-del, `requiredAtoms`) are defined in
`docs/ATOMS.md`.

## Source note

The eight family names are a **proposed vocabulary aligned with the S41 draft** (`pr-review-judgment`), learned from a
draft, not from an inspected S41 edition. No compatibility with S41 data is claimed; any S41 use goes through a separate
adapter with a round-trip test (plan D1, D30). The Claude planner named the eighth family `inverted_logic`; the plan uses
the Codex name `logic_value` so that the family also holds the behaviour-specified wrong constant (D29).

## 1. Rules common to every operator

**C1. Site region (plan 7.2 step 3).** A site is located on the clean feature change's **added lines** (its head atoms).
Base-deletion operators (section 3) may instead target a **base** statement that lies inside a function the clean head
modifies and that the clean head kept unchanged. "A function the clean head modifies" is decided by syntax only: a
function declaration, method, constructor, accessor, function expression or arrow function with a body, whose head-side
text (in the clean head) contains at least one line added by the clean change.

**C2. Eligibility is syntax and contract only.** An operator applies where its syntax pattern (below) matches in the clean
head's syntax tree (parsed by the `docs/ATOMS.md` section 9 rule) and, where the operator says so, the root's feature
contract names the construct (for example "the spec says the limit is inclusive" or "`canEdit` is the permission check").
Eligibility never uses any measured property of the code.

**C3. One mechanical edit.** Each defect head is the clean head with exactly one operator applied at exactly one site.
The edit is the exact text change stated; nothing else changes (no reformatting, no renaming, no comment changes).

**C4. Whole-line statements for deletions.** A deletion operator removes a statement only if the statement occupies whole
lines: its first line contains nothing before it except indentation, its last line contains nothing after it except
whitespace, and no other statement shares those lines. All of its lines are removed, including the newline of the last
one. Other deletion sites are ineligible.

**C5. The defect head must parse** under the `docs/ATOMS.md` section 9 rule. A site whose edit does not parse is
ineligible.

**C6. Required atoms exist.** Every `requiredAtoms` entry must be an atom of the defect change (`docs/ATOMS.md` section
10). A site that would empty its hunk is rejected with reason `empties_hunk`; a site whose required atom does not exist is
rejected with reason `infeasible`.

**C7. Witnessed or rejected.** A defect is admitted only if its named witness passes on the clean head and fails on the
defect head with an assertion failure at the named test (plan D17). A mutant no witness distinguishes is listed as
`equivalent`; a site without a witness is `unwitnessed`. Rejections are recorded in the placement record, never deleted.

**C8. Site ids and anchors.** Each inventory entry records a site id, the family, the operator id, the path, the side
(`head` for clean-head sites, `base` for base-deletion sites), the 1-based line(s) and the UTF-8 byte offsets
`[start, end)` of the edited or removed text in that side's normalised text. Recommended site id:
`<cleanChangeId>#<operatorId>@<path>:<start>-<end>`. The inventory is hashed and frozen before any draw.

**C9. Anchor kinds** (`docs/ATOMS.md` section 10):

| anchor kind | used by | required atoms |
|---|---|---|
| `edited` | every operator that changes text in place or swaps lines | head atoms of the edited defect-head lines |
| `r-del-gap` | deletion operators on feature-added code | the head atoms immediately before and after the gap in the same hunk (one at a hunk edge) |
| `base-deletion` | deletion operators on base code kept by the clean head (null_optional, authz_weakened, state_cache_lifecycle only) | `baseAtoms(defect change) \ baseAtoms(clean change)` |

**C10. `signatureBearing`** is predeclared and fixed per operator: **true only for
`error_swallowed_mismapped.empty-catch`**, false for every other operator.

**C11. Base-deletion coverage.** Each split must contain at least one admitted `base-deletion` defect. Placement
reserves one slot per split among base-deletion sites of `null_optional`, `authz_weakened` or `state_cache_lifecycle`
(plan 7.2 step 4).

## 2. Operator table (summary)

| family | operator id | edit | anchor kind | signatureBearing |
|---|---|---|---|---|
| boundary | `boundary.flip-inclusive` | `<`↔`<=` or `>`↔`>=` on one comparison | edited | false |
| boundary | `boundary.index-plus-one`, `boundary.index-minus-one` | index or slice bound `e` → `e + 1` / `e - 1` | edited | false |
| null_optional | `null_optional.delete-guard` | delete one null/undefined guard statement | r-del-gap, or base-deletion | false |
| null_optional | `null_optional.optional-chain-to-dot` | one `?.` → `.` (or `?.(`/`?.[` → `(`/`[`) | edited | false |
| await_ordering | `await_ordering.remove-await` | delete one `await ` | edited | false |
| await_ordering | `await_ordering.swap-awaited` | swap two adjacent awaited statements | edited (both lines) | false |
| authz_weakened | `authz_weakened.delete-guard` | delete one authorization guard statement | r-del-gap, or base-deletion | false |
| validation_escaping | `validation_escaping.unwrap-call` | `v(x, …)` → `x` | edited | false |
| error_swallowed_mismapped | `error_swallowed_mismapped.empty-catch` | catch block → `{}` | edited | **true** |
| error_swallowed_mismapped | `error_swallowed_mismapped.remap-error-class` | `new X(` → `new Error(` in a catch | edited | false |
| state_cache_lifecycle | `state_cache_lifecycle.delete-release` | delete one release / invalidation / unsubscribe statement | r-del-gap, or base-deletion | false |
| state_cache_lifecycle | `state_cache_lifecycle.change-key-part` | drop one component of a cache key | edited | false |
| logic_value | `logic_value.negate-condition` | `c` → `!(c)`, or `!(c)`/`!c` → `c` | edited | false |
| logic_value | `logic_value.swap-and-or` | one `&&` ↔ `||` | edited | false |
| logic_value | `logic_value.replace-constant` | behaviour-specified literal → different value | edited | false |

## 3. Families

### 3.1 `boundary`
Off-by-one and inclusive/exclusive bound errors.
- **`boundary.flip-inclusive`.** Pattern: a binary expression whose operator token is `<`, `<=`, `>` or `>=`, on a
  feature-added line. Edit: replace that one token: `<` → `<=`, `<=` → `<`, `>` → `>=`, `>=` → `>`. Contract: the
  feature spec states a bound (limit, length, range, deadline) that the comparison implements.
- **`boundary.index-plus-one` / `boundary.index-minus-one`.** Pattern: the argument expression `e` of an element access
  `x[e]`, or the first or second argument of a `.slice(...)`, `.substring(...)` or `.substr(...)` call, on a feature-added
  line, where `e` is not a string literal. Edit: replace `e` by `e + 1` (or `e - 1`) when `e` is an identifier, a property
  access or a numeric literal, otherwise by `(e) + 1` (or `(e) - 1`). Each expression yields two sites (plus, minus).
- Required atoms: the edited line's head atom (`edited`).

### 3.2 `null_optional`
A missing or bypassed null/undefined check.
- **`null_optional.delete-guard`.** Pattern: an `if` statement with no `else`, whose condition is a null/undefined test
  of one operand (`x == null`, `x === null`, `x === undefined`, `x == undefined`, `typeof x === 'undefined'`, `!x`, or
  `||` / `&&` of such tests on the same operand) and whose then-branch is a `return` or `throw` statement or a block
  containing only one `return` or `throw` statement. Edit: delete the whole statement (C4).
  - On feature-added lines: `r-del-gap`.
  - On a base statement kept by the clean head inside a modified function (C1): `base-deletion`.
- **`null_optional.optional-chain-to-dot`.** Pattern: one optional-chaining token `?.` on a feature-added line. Edit:
  `a?.b` → `a.b`, `f?.(…)` → `f(…)`, `a?.[i]` → `a[i]` (remove `?.`, keeping a `.` only for property access). Required
  atoms: the edited line (`edited`).

### 3.3 `await_ordering`
A missing `await` or two awaited steps in the wrong order.
- **`await_ordering.remove-await`.** Pattern: an `await` expression whose operand is a call, on a feature-added line.
  Edit: delete the `await` keyword and the single space after it. Required atoms: the edited line (`edited`).
- **`await_ordering.swap-awaited`.** Pattern: two adjacent statements in the same block, each a single-line expression
  statement or variable statement containing an `await` expression, both on feature-added lines, where the second does
  not reference any name declared by the first (so the swapped head still parses and binds). Edit: exchange the two lines.
  Required atoms: both lines' head atoms (`edited`).

### 3.4 `authz_weakened`
An authorization check removed from one branch.
- **`authz_weakened.delete-guard`.** Pattern: an `if` statement with no `else` whose then-branch is a `throw` or a
  `return` of a denial value (or a block with only that statement), and whose condition calls or reads a permission check
  the root's contract names as such (for example `canEdit(user, doc)`, `isAdmin(user)`, `user.role !== 'owner'`). Edit:
  delete the whole statement (C4).
  - On feature-added lines: `r-del-gap`.
  - On a base statement kept by the clean head inside a modified function (C1): `base-deletion`.

### 3.5 `validation_escaping`
Input reaches a sink without its validation or escaping step.
- **`validation_escaping.unwrap-call`.** Pattern: a call `v(x, …)` on a feature-added line whose callee `v` (identifier
  or property name) the root's contract names as a validation, sanitising or escaping function that returns its
  validated/escaped first argument (for example `escapeHtml`, `sanitizePath`, `parsePositiveInt`). Edit: replace the
  whole call expression with its first argument's text `x`. Required atoms: the edited line (`edited`).

### 3.6 `error_swallowed_mismapped`
An error silently dropped, or mapped to the wrong error.
- **`error_swallowed_mismapped.empty-catch`.** Pattern: a `catch` clause whose whole text lies on feature-added lines,
  whose block contains at least one statement, whose opening `{` is the last non-whitespace character of its line, and
  whose closing `}` stands alone on its line (only whitespace around it; in particular no `finally` on that line). Edit:
  on the line holding the opening `{`, append `}` directly after it (giving `catch (e) {}` or `catch {}`); delete every
  following line of the clause through the closing-brace line. Required atoms: the head atom of the edited `catch` line
  (`edited`). `signatureBearing: true`.
- **`error_swallowed_mismapped.remap-error-class`.** Pattern: inside a `catch` block on feature-added lines, an
  expression `new X(…)` that is thrown or returned, where `X` is an identifier other than `Error`. Edit: replace `X`
  with `Error`. Required atoms: the edited line (`edited`).

### 3.7 `state_cache_lifecycle`
A resource not released, a cache not invalidated, a listener not removed, or a cache keyed too coarsely.
- **`state_cache_lifecycle.delete-release`.** Pattern: an expression statement that is a call (optionally awaited) whose
  callee name (identifier, or the name of a property-access callee) is in the release list `release`, `close`,
  `dispose`, `destroy`, `end`, `abort`, `unlock`, `unsubscribe`, `removeEventListener`, `removeListener`, `off`,
  `clearTimeout`, `clearInterval`, `invalidate`, `delete`, `clear`, or that the root's contract names as the release or
  invalidation step. Edit: delete the whole statement (C4).
  - On feature-added lines: `r-del-gap`.
  - On a base statement kept by the clean head inside a modified function (C1): `base-deletion`.
- **`state_cache_lifecycle.change-key-part`.** Pattern: a cache key with at least two variable components, on a
  feature-added line: either the first argument of a `get`, `set`, `has` or `delete` call on an object the contract names
  as a cache or map, or the initialiser of a variable whose name contains `key` or `Key`; the key is a template literal
  with at least two `${…}` substitutions or a `+` concatenation with at least two non-literal operands. Edit: for a
  template literal, remove one `${…}` substitution together with the single literal character immediately before it (or,
  for the first substitution, after it) if that character is a separator (`:`, `|`, `/`, `-`, `_`, `.`); for a `+`
  concatenation, remove one non-literal operand together with one adjacent `+`. Each removable component is one site.
  Required atoms: the edited line (`edited`).

### 3.8 `logic_value`
Inverted logic, or a constant that differs from the behaviour the spec states.
- **`logic_value.negate-condition`.** Pattern: the condition expression `c` of an `if`, `while`, `do … while` or
  conditional expression, on a feature-added line. Edit: if `c` is a prefix-`!` expression `!e`, replace `c` by `e`
  (delete the `!` only); otherwise replace `c` by `!(c)`. Required atoms: the edited line (`edited`).
- **`logic_value.swap-and-or`.** Pattern: one binary `&&` or `||` token on a feature-added line. Edit: `&&` → `||` or
  `||` → `&&`. Required atoms: the edited line (`edited`).
- **`logic_value.replace-constant`.** Pattern: a numeric literal written as a decimal integer, or a non-empty string
  literal, on a feature-added line, whose value the feature spec states explicitly as behaviour (a limit, a timeout, a
  status code, a header or event name, a separator). Edit: decimal integer `n` → `n + 1` written as a decimal integer;
  string `'s'` (any quote style) → the same quotes around `s` with `x` appended. Required atoms: the edited line
  (`edited`).

## 4. Placement summary (detail in `docs/DATA.md` section 3)

Each root's clean change has two defect slots; deterministic quota matching (seed 450045, PRNG in `docs/ATOMS.md`
section 11) assigns the two slots to two **distinct** families with eligible sites in that clean change so that every
family has exactly five defect heads per split, in distinct roots; the site within a root/family is chosen uniformly
among its eligible sites in recorded inventory order. Infeasible quotas fail admission. No reseeding after any analysis
of the corpus.
