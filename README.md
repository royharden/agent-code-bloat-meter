# Diff Review Tiers

**Status: under construction. Nothing has been measured. There are no results.**

Diff Review Tiers is a small, preregistered study tool for one question:

> Given an agent-written TypeScript change split into hunks, does ordering the hunks by a frozen, predeclared
> structural risk-tier policy **expose** more planted defects within a fixed changed-line budget (20% of the
> change's added plus deleted lines) than the stronger of two size orderings, and how much clean and
> clean-but-defensive code does the policy send to the top tier?

"Exposed" means every changed line a defect requires falls inside the budgeted reading prefix. The primary
endpoint is called **defect exposure recall**. It measures how review attention is allocated, not whether a
reviewer would find anything.

## What it is

- A keyless TypeScript analyser for `.ts`/`.tsx` changes: hunks, changed-line atoms, and a few syntactic metrics
  (cyclomatic growth, changed catch blocks that may swallow errors, untested changed functions, token clones,
  unreachable statements, size). Every metric is a value or `unknown`, never a silent zero.
- A tier policy (tier 2, 1, 0, plus `manual` when analysis is incomplete) whose thresholds are chosen once on a
  development split and then frozen.
- An evaluator that compares the tier ordering against size, file-type, complexity, clone, random and external
  baselines on a sealed held-out split of an independently authored synthetic corpus.
- A static viewer for the demo analysis and, later, the results table.

## What it is not

- Not a code-quality or "bloat" score. There is no score of any kind and no composite metric.
- Not an agent-versus-human comparison and not a causal claim.
- Not a reviewer. No language-model call is made; the optional reviewer arm exists only as a keyless mock and a
  spend ledger capped at $0.

## Built vs never run

**Built so far (milestone M1, Dirty Mode construction, static checks only):** the repository skeleton, the
corpus contract (`src/corpus/contract.ts`), analysis types (`src/core/types.ts`), JSON Schemas (`schemas/`),
the candidate policy space (`policy.json`, nothing selected), a draft preregistration skeleton
(`preregistration.json`, status `draft-unfrozen`), the protocol hashing script (`scripts/hash-protocol.ts`), the
protocol documents and demo fixtures.

**Never run:** dependency installation, type checking, linting, tests, the analyser, the viewer, policy tuning,
the freeze, and any evaluation. There is no lockfile yet. The independent corpus does not exist yet, so no
number about the claim exists. A null result is likely and will be published if it happens. Every deferred check
is listed in `docs/DEFERRED-VALIDATION.md`.

Jev was considered and not used.

## Licence

MIT. All data in this repository is original and synthetic.
