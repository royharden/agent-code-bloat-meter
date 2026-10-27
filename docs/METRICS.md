# METRICS v1 (`ruleVersion: 'm1'`)

Plan of record PLAN.md revision 4.1, section 6.3 with D2, D13, D14, D22, D27, D35 · status: **draft, unfrozen** (hashed into
`docs/FREEZE.md`; any change after the freeze is a new rule version and spends the held-out set).

**Not part of the corpus-author packet.** The independent corpus author must never read this file (plan section 2, 7.6).

Every metric value has the shape `{ value: T | 'unknown', ruleVersion: 'm1', spans: [{ path, side, startLine, endLine }] }`
(`MetricValue<T>` in `src/core/types.ts`). There is no composite score and no bloat score; each value is reported on its
own with the source spans that support it.

Hunks, atoms, normalisation, the line diff and the parse rule are defined once in `docs/ATOMS.md` and are not repeated
here. All line numbers are 1-based lines of the normalised text of the stated side.

## 1. Scope and roles

- Only `.ts` and `.tsx` files are analysed (lower-cased extension). A **changed** file with another extension makes the
  change `incomplete` and is listed; unchanged files with other extensions are ignored. Nothing returns zero findings for
  an unsupported file (D2).
- **Role** is derived from the path, never taken from input: `test` if the file name matches `*.test.ts`, `*.test.tsx`,
  `*.spec.ts`, `*.spec.tsx`, or any path segment is `__tests__`; else `config` if the file name matches `*.config.ts` or
  `*.config.tsx`; else `production`.
- Parsing: `docs/ATOMS.md` section 9. A side that fails to parse yields `'unknown'` for every metric that needs its
  syntax tree, and every hunk touching that file is `manual` (section 11).

## 2. Spans

A node's span is `[line(node.getStart()), line(node.getEnd())]`, where `getStart()` excludes leading trivia (comments and
whitespace) and `line(pos)` is the 1-based line containing character offset `pos` (for `getEnd()`, the line containing the
last character of the node). A span **intersects** an atom when the atom's side equals the span's side and the atom's line
lies within the span, inclusive.

## 3. Function map

**Functions.** Function declarations, method declarations, constructors, `get` and `set` accessors, function
expressions, and arrow functions, each **with a body** (a block, or an expression body for arrows). Overload signatures,
method signatures, and abstract or `declare`d members without a body are ignored.

**Name.**
- the declared name of a function declaration, method or accessor (computed property names other than a string or
  numeric literal make the function anonymous);
- `constructor` for a constructor;
- accessors are keyed `get:<name>` and `set:<name>`; their **bare name** (used in section 8) is `<name>`;
- a function expression or arrow function takes the name of the variable declarator, property assignment, property
  declaration or shorthand property it directly initialises; a named function expression uses its own name if it has
  none of those;
- otherwise the function is **anonymous**.

**Lexical parent chain.** The names of the enclosing class declarations or class expressions (a class expression takes
the name of the variable it initialises if it has no own name), enclosing **named** functions (named as above), object
literals that initialise a named variable or property (by that name), and module/namespace declarations, outermost
first, joined by `/`. Anonymous enclosing functions are skipped in the chain.

**Key.** `path#chain/name`, or `path#name` when the chain is empty. If the same key occurs twice on one side of one file,
**both** occurrences are `ambiguous` on that side.

**Classes** (per key, comparing the base and head maps of the same path):
- `matched` — the key exists exactly once on both sides;
- `new` — only on the head side; `deleted` — only on the base side;
- `anonymous` — no name; `ambiguous` — duplicate key on a side.

**Changed.** A function is changed if its head span intersects a head atom or its base span intersects a base atom. A
changed matched function is **modified**; a changed new function is **added**.

**Anonymous functions** are not unknowns. They contribute **no base 1** of their own; their decision points (section 4)
and statements (section 6) **fold** into the nearest enclosing named function. This is the one exception to "nested
function bodies count only in their own function": `.map(x => x > 0 ? a : b)` inside `f` adds +1 to `f`, not +2.
Anonymous functions with no named ancestor fold into `<top>`.

**`<top>`.** One synthetic function per file, named `<top>` with an empty chain, matched by path (`new` when the file is
added, `deleted` when the file is deleted). Its span is not contiguous: it is the set of lines covered by the spans of the
file's **module-level statements that are not themselves** a named function declaration, a class declaration, or a
variable statement whose declarators all initialise a function expression or arrow function. Examples: imports, exports,
interface and type declarations, top-level calls (including `describe(...)` in tests), `export default` expressions,
top-level `if`, and variable statements initialised with non-function values. A hunk intersects `<top>` only through atoms
on those lines. `<top>` has base 1 like any function. It has its file's role. It counts for the cyclomatic tier input
(section 5) only if its file is production; it **never** has a test-reference value (section 8 gives `'unknown'`).

## 4. Cyclomatic complexity

Per function and side: **1**, plus 1 for each `if`, `for`, `for-in`, `for-of`, `while`, `do`, conditional expression
(`?:`), `case` clause that is not `default`, `catch` clause, and each binary `&&`, `||`, `??`, and each logical assignment
`&&=`, `||=`, `??=`. Decision points inside a nested **named** function or a class count only in that function; decision
points inside an anonymous function fold as in section 3. TSX markup, optional chaining `?.`, default parameter values,
destructuring defaults and `else` add nothing.

**Delta.** matched: head − base; new: head − 1; deleted: `'unknown'` (not used for growth). anonymous and ambiguous
functions have no delta of their own.

## 5. Hunk input: `maxPositiveDelta`

For a hunk, the maximum **positive** delta over **matched or new production** functions (including a production `<top>`)
whose head span intersects a head atom of the hunk or whose base span intersects a base atom of the hunk; `0` if there is
none or no delta is positive. Spans list the contributing functions. Negative deltas never make it negative.

## 6. Statement count

The number of statement nodes in the function's **head-side** body, counted recursively through blocks and through the
bodies of `if`/`else`, loops, `try`, `catch`, `finally`, `switch`, `case`/`default` clauses and labelled statements.

- **Counted kinds:** variable statement, expression statement, `return`, `throw`, `if`, `for`, `for-in`, `for-of`,
  `while`, `do`, `switch`, `try`, `break`, `continue`, labelled statement, `debugger`. (An `else if` is an `if` and counts.)
- **Not counted:** `Block` (`{}`), `EmptyStatement` (`;`), and nested **named** function or class declarations together
  with everything inside them; import, export, interface, type-alias and enum declarations.
- Anonymous function bodies **are** counted (folded as in section 3). An expression-bodied arrow counts **1**, including
  when folded into its parent (`xs.map(x => x.id)` inside `f` adds 1 to `f`).
- `<top>`: the counted statements among its module-level statements (section 3) plus folded anonymous bodies.
- No head side (deleted function): `'unknown'`.

## 7. Changed catch: `catch_may_swallow`

Production files only. A head-side `catch` clause is flagged `catch_may_swallow` ("may be intentional") when its span
intersects a head atom of the change and its block is either empty, or contains only expression statements each of which
is a call whose callee is
- a property access on `console` (`console.log`, `console.warn`, …), or
- an identifier in `LOGGER_NAMES = ['log', 'logger', 'logError', 'warn', 'report', 'reportError', 'track', 'telemetry']`,
  or a property access whose object is such an identifier (`logger.error(...)`, `telemetry.send(...)`),

and the block contains no `throw`, no `return` and no assignment (no assignment operator anywhere in the block,
including `=`, compound assignments and `++`/`--`). The flag applies to **every hunk with a head atom inside the catch
clause span**. Spans: the catch clause.

## 8. `no_changed_test_reference` (D6)

Defined for a changed (modified or added) **production** function whose bare name is **unique** among all head-side
production functions of the change (all files, including unchanged ones):
- `true` if no `Identifier` node whose text equals that bare name occurs in the head-side syntax tree of any **test** file
  that the change adds or modifies;
- `false` if one does (spans: the referencing identifiers).

`'unknown'` for `<top>`, anonymous and ambiguous functions, and non-unique names; not evaluated (`'unknown'`) for deleted
or unchanged functions. Unchanged test files are not scanned, and hidden witness files are never part of any input, so a
function covered only by an unchanged test is flagged by design (trap N7). `'unknown'` never fires a rule and never makes a
hunk `manual`. A reference is only a name occurrence; it says nothing about assertions or coverage.

## 9. Token clones (D13; diagnostic and `clone-first` ordering only)

- **Tokens.** For each head-side `.ts`/`.tsx` file (all roles), the token sequence is the leaf tokens of the parsed syntax
  tree in source order (tokens as produced by the TypeScript scanner during `createSourceFile`), with trivia dropped and
  the end-of-file token excluded. JSX text consisting only of whitespace is dropped.
- **Normalisation.** Identifiers (including private identifiers) → `ID`; string literals and no-substitution template
  literals → `STR`; template head/middle/tail pieces → `TPL`; numeric and bigint literals → `NUM`; regular-expression
  literals → `REGEX`; non-whitespace JSX text → `JSXTEXT`; keywords and punctuation keep their token kind.
- **Clone.** Two or more non-overlapping occurrences (within one file or across head files) of the same normalised token
  sequence of length **≥ 40** whose occurrences each span **≥ 3** source lines, maximal (it cannot be extended left or
  right with all occurrences still equal).
- **Reported per hunk:** `duplicatedAddedAtoms` = the number of the hunk's head atoms that lie on a line covered by at
  least one clone occurrence; overlapping hits are collapsed, so each atom counts once. Spans: the other occurrences
  (origins). Base atoms never count.
- jscpd 4.x is a separate external baseline adapter (plan D13, D28), not this metric.

## 10. Unreachable statements (D14; diagnostic only, never a tier rule)

A statement is unreachable when it directly follows, in the same statement list (a block, a `case`/`default` clause, a
module block or the source file), an unconditional `return` or `throw` statement. Function declarations, class
declarations, interface/type declarations and empty statements are exempt (hoisting or no runtime effect). Reported per
hunk: the number of unreachable statements whose span intersects a head atom of the hunk. No interprocedural or
control-flow reachability claim.

## 11. `manual` (unknown analysis, D22, D35)

A hunk is `manual` if and only if
1. a file it touches failed to parse (`docs/ATOMS.md` section 9) on either side, or
2. one of its atoms intersects an `ambiguous` function **in a production file**.

Nothing else makes a hunk `manual` (in particular not anonymous functions and not `'unknown'` test references). Test and
config hunks are never `manual` through ambiguity. The product shows `manual` hunks as "analysis incomplete".

## 12. Size

Per hunk: atoms (`atomCount`, `baseAtomCount`, `headAtomCount`). Per change: total atoms `L`, files, changed files, hunks.
Size is an effort denominator and a baseline ordering, never a quality label.

## 13. Not in v1 (D27)

No cognitive complexity, no type-aware detectors (no type checker, no nullability claims), no McNemar, no Popt, no JS/JSX,
no directory-pair input, no coverage import, no byte-identical move detection (D33).

## 14. Cross-check (Normal mode, later)

`scripts/eslint-crosscheck.ts` compares this cyclomatic count with ESLint core `complexity` on every dev function. Every
disagreement is listed here, by rule, after that run. None is asserted in advance.
