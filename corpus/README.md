# corpus/ — empty until Gate 1

This folder holds the study corpus **only after Gate 1 passes** (plan 7.3, 7.6; `docs/DATA.md`).

- **Builders never write here.** The corpus (roots, clean feature changes, defect heads, near-misses, labels, witnesses,
  site inventories) is authored only by the independent corpus author C1, from the corpus-author packet, outside this
  repository.
- After Gate 1, the Normal-mode gate operator copies the **dev** split into `corpus/dev/` and adds
  `corpus/heldout.commitment.json` (sha256 of every sealed held-out file, the seeds and the site-inventory hash). The
  held-out split stays sealed in the outer shell (`sealed\heldout\`) until the held-out run.
- Gate 1 status: **PENDING — needs Roy to appoint C1 and authorise Normal-mode witness execution** (ROY-DECISIONS-REQUEST
  R1).

Engineering fixtures written by builders live in `fixtures/demo/` and `tests/fixtures/` and are never study data.
