# Agent instructions (inner repo: Diff Review Tiers)

This folder is the product repository (npm package `agent-diff-review-tiers`). The plan of record, status,
handoffs, agent registry, chat exports and private planning live in the **outer shell** folder one level up,
never in this repo. Read the outer `AGENTS.md` and `PLAN.md` before working here.

## Current mode

**Dirty Mode is ACTIVE for this project only** (operator instruction, 2026-10-27): construction with static checks
only. While it is active:
- Never run package installs, `npx`, tests, builds, `tsc`, `vite`, dev servers, browsers, Docker, git hooks, or any
  network or paid call.
- Allowed checks: reading, grep, read-only git, `sha256sum`, `node -e` JSON parsing, and `node --check <file.ts>`
  (erasable TypeScript only; `.tsx` is inspected by reading).
- Every skipped runtime check is recorded in `docs/DEFERRED-VALIDATION.md` with its exact later command.
- Nothing built here is accepted beyond "accepted for Dirty Mode construction, runtime unverified".
Normal rules resume when the operator closes Dirty Mode.

## Synthetic data only

- Every input in this repo is original, MIT-licensed and synthetic. No public dataset, imported pull request,
  client, partner or course text, and no real credentials.
- `fixtures/demo/` holds builder-authored **engineering** fixtures. They are never study data and never enter
  tuning, freezing or evaluation.
- `corpus/` holds only READMEs until the independent corpus author's dev split is admitted after Gate 1, plus
  `corpus/heldout.commitment.json` from that author. Held-out material never enters this repo before the freeze.

## Builder independence (plan sections 2 and 9 G6)

Every agent that writes product code, docs, tests or fixtures here is **builder lineage**. Builder lineage must never:
- author corpus roots, clean feature changes, defect heads, near-miss changes, hidden witnesses, base-sanity tests,
  eligible-site inventories, placement records, gold labels, the independent worksheet, or held-out data;
- write `corpus-gen/` generator or witness-harness code (that belongs only to the independent corpus author, C1,
  working outside this repo);
- read or write the contents of the outer `sealed\heldout\` or `sealed\custody\` folders (README only), or write
  into `corpus-author-work\`;
- tune policy thresholds on held-out data, edit `preregistration.json` after the freeze, or report a number that
  did not come from `results/results.json`.

The corpus author receives only the author packet, never this checkout. The packet excludes `src/diffmetrics`,
`src/policy`, `policy.json`, `preregistration.json`, `docs/METRICS.md`, `docs/POLICY.md`,
`docs/PREREGISTRATION.md` and `docs/ENGINEERING-WORKSHEET.md`.

## Code rules

- Strict, erasable TypeScript only: no `enum`, `namespace` or constructor parameter properties; `import type` for
  type-only imports; extensionless relative imports (resolved by `tsx`/Vite under `moduleResolution: bundler`).
- Analysed code is parsed, never executed: no `eval`, `new Function`, `require(` or dynamic `import(` in
  `src/core` or `src/diffmetrics`.
- No exported identifier contains `score` or `bloat`. There is no composite score.
- Only `src/corpus/`, `src/orderings/evaluate.ts`, `scripts/eval.ts`, `scripts/tune.ts` and `tests/` may import
  `labels` or `LabelV1`. The viewer imports nothing from `src/corpus`, `src/heldout` or Node modules.
- No network code in `src/` except the viewer's same-origin `fetch('data/<file>.json')`.
- "Exposed" and "defect exposure recall" describe allocation; "found" is reserved for an evaluated reviewer.

## Secrets

Never commit or print secrets. `.env` and `.env.*` are ignored; only `.env.example` (variable names, no values)
is tracked. Live reviewer dispatch is off (`S45_LIVE=0`, `S45_BUDGET_USD=0`) and no live adapter exists.

## Commits

Coders do not commit. The project integrator commits locally after an independent review passes.
