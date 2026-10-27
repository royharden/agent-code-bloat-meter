# External baselines (constructed, never captured)

All tool versions are candidate pins until the Normal-mode licence recheck and a passing dev probe. No external
baseline has run. `not captured` is missing data; it is never zero findings or measured recall. External tool JSON
is never a substitute for the in-repo token-clone metric. Captured ordering does not mean measured study result.

| Ordering | Candidate | Current status | Mapping |
| --- | --- | --- | --- |
| jscpd | 4.3.0 | not captured; Normal-mode probe pending | distinct head-side added atoms inside either duplicate segment, descending |
| sarif:fallow | 3.36.0, SARIF 2.1.0 | not captured; Normal-mode probe pending | introduced stable-fingerprint findings intersecting head changed atoms, count descending |
| lizard | 1.17.31 | not captured: licence unresolved | no executable adapter |

Every ordering receives the identical hunk set and uses the frozen SHA-256 tie key. Both base and head outputs
must be syntactically valid, even where the ordering uses only head duplication. jscpd counts each added atom once,
regardless of overlapping duplicate regions. fallow subtracts base fingerprints as a multiset; it does not subtract
line locations, which would misclassify pre-existing findings shifted by insertions. Missing stable fingerprints,
ambiguous SARIF locations, unknown tool output shapes or unmapped paths produce `invalid capture`.
The stable-fingerprint capability is unverified: if the probe finds fallow cannot supply it, leave this baseline
not captured until an explicit dev-only mapping revision is approved and frozen. Do not weaken the mapping after results.

## Receipt and source binding

`BaselineReceipt` in `src/orderings/sarif.ts` binds exact tool/version, full command template, zero exit codes for
both sides, timestamp, the analysis input hash, both source-tree hashes, both raw-output hashes, a dev-locked path
mapping hash, and a passing probe receipt hash. Source-tree hash = SHA-256 of JSON of present files sorted by path,
each `{path,sha256}` using the original UTF-8 bytes. Mapping hash = SHA-256 of JSON of the raw-path-to-analysis-path
object sorted by raw path. A mapped path must be an analysed file; raw locations must be positive inclusive ranges.
The adapter checks the source hashes against analysis-side file hashes, not merely against caller-provided assertions.
Receipts are provenance records, not signatures or proof of tool correctness. Independent Normal-mode review must
inspect the actual probe artifact and source materialization before admission. All mapping choices lock on dev.

## Normal-mode capture procedure (deferred)

1. Recheck licences and tool metadata through the authorized Gate 0 network procedure. Install the exact pins only
   after authorization; run `fallow --version` and the jscpd JSON probe on synthetic engineering inputs.
2. Record the real fallow argument template in an operator config. `args` is an array with standalone `{root}` and
   `{output}` entries; no shell is used and no unsupported CLI syntax is guessed here. Record the same `args` in a
   probe JSON with `tool: "fallow"`, `version: "3.36.0"`, `passed: true`, `mappingLockedOn: "dev"`, `mappingHash`.
   This JSON is an operator's evidence-backed assertion and must point to the verified probe in review records.
3. The config also supplies `inputPath`, `outputDir`, `executable`, `mappingPath`, and `probeReceiptPath`.
   With Dirty Mode closed, set `S45_NORMAL_MODE=1` and run
   `npm exec -- tsx scripts/capture-fallow.ts <operator-config.json>`.
   The script creates isolated repositories under the OS temp directory (never inside the repo), materializes only
   checked ChangeV1 source, invokes the pinned executable on both sides, validates the receipt and mapping, and writes
   `base.sarif`, `head.sarif`, `receipt.json` without overwriting. Temporary repositories are retained for inspection.
4. Capture actual jscpd base/head JSON after its dev probe and construct the same receipt with `tool: "jscpd"`.
   Call `jscpdOrdering` / `sarifOrdering` with capture bytes and receipt. Without a capture each returns `not captured`.
   Evaluator integration must admit a capture only with independent provenance review; no external result is enabled
   by the source-only construction run.

Deferred checks: `npm run typecheck`; `npm test -- tests/request-render.test.ts tests/mock-not-results.test.ts
tests/ledger-cap.test.ts tests/matcher.test.ts`; `npm run demo -- --write`; `npm run build`.
Capture/probe commands depend on real operator configs and licences; do not run them in Dirty Mode.
