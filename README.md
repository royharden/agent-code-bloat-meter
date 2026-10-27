# Diff Review Tiers

**Dirty Mode source construction. Runtime unverified. Nothing has been measured.**

Does ordering agent-written TypeScript diff hunks by a frozen structural risk policy expose more planted defects within a primary budget of 20% of changed lines than the stronger size ordering? What clean and defensive code does it send to tier 2?

The endpoint is **defect exposure recall**: every required changed-line atom lies in the allocated reading prefix. It measures attention allocation. No claim about reviewer discovery, agent versus human performance or causality follows. There is no composite quality metric.

## Built

- Parse-only `.ts`/`.tsx` analysis from ChangeV1 JSON or a read-only git adapter: hunks, atoms, cyclomatic growth, changed catches, test references, token clones, unreachable statements and size. Unknown/ambiguous analysis stays visible as manual review.
- Policy, ordering and evaluation source: both size baselines, seeded random, structural baselines, budget slicer, root bootstrap, dev selection and freeze/held-out custody controls. These implementations are accepted for static construction; runtime validation is deferred. A source implementation is not a completed study.
- An independent-author packet and corpus consumer. Corpus roots, labels and witnesses must come from a fresh non-builder session appointed by Roy; engineering fixtures in fixtures/demo/ are excluded from study evaluation.
- Keyless reviewer contract/mock, localization matcher, disabled live ledger, external capture adapters and static viewer. Construction review is complete; its records live outside this product repo. No runtime success is asserted.
- Protocol docs, JSON schemas, release runbook and an honest results template. Candidate policy thresholds and preregistration remain unfrozen.

## Never run

Dependency installation, type checking, linting, tests, builds, the analyzer, demo, viewer, policy tuning, freeze, corpus admission, external captures and held-out evaluation have never run. No lockfile or measured results exist. Static source reviews and syntax parsing are the only construction checks. See [deferred validation](docs/DEFERRED-VALIDATION.md) and [limitations](docs/LIMITATIONS.md).

The primary budget is 20%; sensitivity budgets are 10% and 30%. These are protocol constants, not results. A null or inconclusive result must be reported. Jev was considered and not used; AIDev is outside the MVP.

## Later local use

After Roy closes Dirty Mode, verify dependency versions, then install with `npm install` and commit the resulting lockfile. Follow [RUNBOOK-P6](docs/RUNBOOK-P6.md) for validation and admission before tuning/freezing/evaluation.

```sh
npm run typecheck
npm test
npm run build
npm run analyze -- fixtures/demo/rate-limiter-feature.json
npm run demo
npm run dev
npm run check-readme-numbers
```

These commands are instructions for the later authorized phase, not execution receipts. Node >= 20 is declared; exact tool compatibility remains unverified. The browser consumes only static public JSON. No database, auth, edge functions, secrets or live adapter are required; see [Bolt handoff](BOLT-HANDOFF.md). Missing external baselines remain not captured, never zero. Arm B is not run; mock output is never a study result.

The local ledger defaults to cap USD 0 with live dispatch disabled. Roy's USD 40 ceiling does not supply a model, credentials or live-run approval. No remote, push, import, publication or deployment is authorized by this repository.

## License

MIT. Demo inputs are original synthetic engineering examples. The independent study corpus is not present. Dependency license checks remain pending; see [VENDORED](VENDORED.md).
