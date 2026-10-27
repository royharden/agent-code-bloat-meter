// plan D32 / 9 M3: the analyser reproduces the hand-computed values in fixtures/demo/*.expected.md (written in M1
// before any metric code). Any mismatch is resolved against docs/METRICS.md / docs/POLICY.md, never by editing the
// expectation to fit the code (DV-M1-B01..B04). Orders and budget prefixes are M4 (src/orderings); the tier helper
// below is a test-only restatement of docs/POLICY.md section 1, used to check that the emitted inputs give the
// expected tiers. Never run in Dirty Mode.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/core/hash';
import type { AnalysisV1, ChangeV1, FunctionRecord, HunkMetrics, Tier } from '../src/core/types';
import { analyze } from '../src/diffmetrics/index';

function load(name: string): ChangeV1 {
  return JSON.parse(readFileSync(new URL(`../fixtures/demo/${name}.json`, import.meta.url), 'utf8')) as ChangeV1;
}

function tierOf(m: HunkMetrics, T: number, N: number): Tier {
  if (m.manual) return 'manual';
  const delta = m.maxPositiveDelta.value;
  const untested = m.untestedChangedStatementMax.value;
  if (
    (typeof delta === 'number' && delta >= T) ||
    m.catchMaySwallow.value === true ||
    (typeof untested === 'number' && untested >= N)
  ) {
    return 2;
  }
  if (m.t0aTriviaOnly || m.t0bTokenEqual || m.t0cImportReorder || m.t0dTestFile) return 0;
  return 1;
}

interface HunkExpectation {
  label: string;
  path: string;
  coords: [number, number, number, number];
  atoms: number;
  idPrefix: string;
  tiePrefix: string;
  keys: string[];
  maxPositiveDelta: number;
  catchMaySwallow: boolean;
  untested: number;
  t0: [boolean, boolean, boolean, boolean];
  tier: Tier;
  /** Tier under T6-N8 / T6-N12 where it differs from T4-N8. */
  tierT6?: Tier;
}

interface FunctionExpectation {
  key: string;
  class: FunctionRecord['class'];
  baseSpan?: [number, number] | null;
  headSpan?: [number, number] | null;
  topLines?: { base: number[]; head: number[] };
  changed: boolean;
  cyclomatic: [number | null, number | null, number | 'unknown'];
  statements: number | 'unknown';
  testRef: boolean | 'unknown';
}

function checkChange(
  name: string,
  expected: { L: number; hunks: HunkExpectation[]; functions: FunctionExpectation[] },
): void {
  describe(name, () => {
    const input = load(name);
    const a: AnalysisV1 = analyze(input);

    it('status ok, every side parses, no manual hunk, no unreachable statement', () => {
      expect(a.status).toBe('ok');
      for (const f of a.files) {
        expect(f.baseParseFailed === true || f.headParseFailed === true).toBe(false);
      }
      expect(a.totals.manualHunks).toBe(0);
      for (const m of a.metrics) expect(m.unreachableStatements.value).toBe(0);
    });

    it(`L = ${expected.L} and exactly the expected hunks`, () => {
      expect(a.totals.atoms).toBe(expected.L);
      expect(a.hunks.length).toBe(expected.hunks.length);
    });

    for (const h of expected.hunks) {
      it(`${h.label}: coordinates, ids, tier inputs and tier`, () => {
        const [bs, bc, hs, hc] = h.coords;
        const hunk = a.hunks.find(
          (x) => x.path === h.path && x.baseStart === bs && x.baseCount === bc && x.headStart === hs && x.headCount === hc,
        );
        expect(hunk, `${h.label} (${h.coords.join(', ')})`).toBeDefined();
        if (hunk === undefined) return;
        expect(hunk.atoms.length).toBe(h.atoms);
        expect(hunk.id.startsWith(h.idPrefix)).toBe(true);
        expect(sha256Hex(`s45-tie-v1|${input.id}|${hunk.id}`).startsWith(h.tiePrefix)).toBe(true);
        const m = a.metrics.find((x) => x.hunkId === hunk.id) as HunkMetrics;
        expect(m.intersectingFunctionKeys).toEqual(h.keys);
        expect(m.maxPositiveDelta.value).toBe(h.maxPositiveDelta);
        expect(m.catchMaySwallow.value).toBe(h.catchMaySwallow);
        expect(m.untestedChangedStatementMax.value).toBe(h.untested);
        expect([m.t0aTriviaOnly, m.t0bTokenEqual, m.t0cImportReorder, m.t0dTestFile]).toEqual(h.t0);
        expect(m.manual).toBe(false);
        for (const N of [8, 12]) {
          expect(tierOf(m, 2, N)).toBe(h.tier);
          expect(tierOf(m, 4, N)).toBe(h.tier);
          expect(tierOf(m, 6, N)).toBe(h.tierT6 ?? h.tier);
        }
      });
    }

    for (const f of expected.functions) {
      it(`function ${f.key}`, () => {
        const r = a.functions.find((x) => x.key === f.key);
        expect(r, f.key).toBeDefined();
        if (r === undefined) return;
        expect(r.class).toBe(f.class);
        if (f.baseSpan !== undefined) {
          expect(r.baseSpan === null ? null : [r.baseSpan.startLine, r.baseSpan.endLine]).toEqual(f.baseSpan);
        }
        if (f.headSpan !== undefined) {
          expect(r.headSpan === null ? null : [r.headSpan.startLine, r.headSpan.endLine]).toEqual(f.headSpan);
        }
        if (f.topLines !== undefined) expect(r.topLines).toEqual(f.topLines);
        expect(r.changed).toBe(f.changed);
        expect([r.cyclomaticBase?.value ?? null, r.cyclomaticHead?.value ?? null, r.cyclomaticDelta.value]).toEqual(
          f.cyclomatic,
        );
        expect(r.statementCount.value).toBe(f.statements);
        expect(r.noChangedTestReference.value).toBe(f.testRef);
      });
    }
  });
}

const RL = 'src/rate-limiter.ts';
const NOTIFY = 'src/notify.ts';
const TEST = 'src/rate-limiter.test.ts';
const F = [false, false, false, false] as [boolean, boolean, boolean, boolean];

checkChange('rate-limiter-feature', {
  L: 38,
  hunks: [
    { label: 'R1', path: RL, coords: [2, 0, 3, 1], atoms: 1, idPrefix: '769a71c2', tiePrefix: 'eaf0d20e', keys: [`${RL}#<top>`], maxPositiveDelta: 0, catchMaySwallow: false, untested: 0, t0: F, tier: 1 },
    { label: 'R2', path: RL, coords: [4, 1, 5, 1], atoms: 2, idPrefix: '1690bf7f', tiePrefix: '6d904842', keys: [], maxPositiveDelta: 0, catchMaySwallow: false, untested: 0, t0: [true, true, false, false], tier: 0 },
    { label: 'R3', path: RL, coords: [7, 0, 9, 1], atoms: 1, idPrefix: 'a708d53a', tiePrefix: '8e530ded', keys: [`${RL}#<top>`], maxPositiveDelta: 0, catchMaySwallow: false, untested: 0, t0: F, tier: 1 },
    { label: 'R4', path: RL, coords: [14, 0, 17, 1], atoms: 1, idPrefix: 'e3976e23', tiePrefix: '03b3ac0d', keys: [], maxPositiveDelta: 0, catchMaySwallow: false, untested: 0, t0: F, tier: 1 },
    { label: 'R5', path: RL, coords: [24, 1, 27, 4], atoms: 5, idPrefix: 'f642877c', tiePrefix: 'a15a80a3', keys: [`${RL}#RateLimiter/allow`], maxPositiveDelta: 1, catchMaySwallow: false, untested: 0, t0: F, tier: 1 },
    { label: 'R6', path: RL, coords: [35, 0, 42, 1], atoms: 1, idPrefix: '3a0d1384', tiePrefix: '87897e66', keys: [`${RL}#RateLimiter/roll`], maxPositiveDelta: 0, catchMaySwallow: false, untested: 5, t0: F, tier: 1 },
    { label: 'R7', path: RL, coords: [40, 0, 48, 11], atoms: 11, idPrefix: '58e9cc4e', tiePrefix: '6323ad30', keys: [`${RL}#retryAfterMs`], maxPositiveDelta: 4, catchMaySwallow: false, untested: 6, t0: F, tier: 2, tierT6: 1 },
    { label: 'R8', path: NOTIFY, coords: [0, 0, 1, 9], atoms: 9, idPrefix: 'f491b75b', tiePrefix: 'a1ecb88e', keys: [`${NOTIFY}#<top>`, `${NOTIFY}#notifyRejected`], maxPositiveDelta: 1, catchMaySwallow: true, untested: 3, t0: F, tier: 2 },
    { label: 'R9', path: TEST, coords: [6, 0, 7, 7], atoms: 7, idPrefix: 'a5d3393d', tiePrefix: 'd3f416d2', keys: [`${TEST}#<top>`], maxPositiveDelta: 0, catchMaySwallow: false, untested: 0, t0: [false, false, false, true], tier: 0 },
  ],
  functions: [
    { key: `${RL}#<top>`, class: 'matched', topLines: { base: [1, 2, 5, 6, 7, 8, 40], head: [1, 2, 3, 6, 7, 8, 9, 10, 47] }, changed: true, cyclomatic: [1, 1, 0], statements: 1, testRef: 'unknown' },
    { key: `${RL}#RateLimiter/constructor`, class: 'matched', baseSpan: [16, 19], headSpan: [19, 22], changed: false, cyclomatic: [1, 1, 0], statements: 2, testRef: 'unknown' },
    { key: `${RL}#RateLimiter/allow`, class: 'matched', baseSpan: [21, 29], headSpan: [24, 35], changed: true, cyclomatic: [3, 4, 1], statements: 9, testRef: false },
    { key: `${RL}#RateLimiter/roll`, class: 'matched', baseSpan: [31, 37], headSpan: [37, 44], changed: true, cyclomatic: [2, 2, 0], statements: 5, testRef: true },
    { key: `${RL}#retryAfterMs`, class: 'new', baseSpan: null, headSpan: [49, 58], changed: true, cyclomatic: [null, 5, 4], statements: 6, testRef: true },
    { key: `${NOTIFY}#<top>`, class: 'new', topLines: { base: [], head: [1] }, changed: true, cyclomatic: [null, 1, 0], statements: 0, testRef: 'unknown' },
    { key: `${NOTIFY}#notifyRejected`, class: 'new', headSpan: [3, 9], changed: true, cyclomatic: [null, 2, 1], statements: 3, testRef: true },
    { key: `${TEST}#<top>`, class: 'matched', topLines: { base: [1, 2, 4, 6, 7, 8, 9, 10, 11, 12], head: [1, 2, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] }, changed: true, cyclomatic: [1, 1, 0], statements: 11, testRef: 'unknown' },
    { key: `${TEST}#fixedClock/now`, class: 'matched', baseSpan: [4, 4], headSpan: [4, 4], changed: false, cyclomatic: [1, 1, 0], statements: 1, testRef: 'unknown' },
    { key: 'src/clock.ts#systemClock/now', class: 'matched', changed: false, cyclomatic: [1, 1, 0], statements: 1, testRef: 'unknown' },
    { key: 'src/telemetry.ts#report', class: 'matched', changed: false, cyclomatic: [1, 1, 0], statements: 1, testRef: 'unknown' },
  ],
});

const FMT = 'src/format.ts';
checkChange('format-reorder', {
  L: 7,
  hunks: [
    { label: 'F1', path: FMT, coords: [1, 1, 0, 0], atoms: 1, idPrefix: 'db412dc4', tiePrefix: '95d565b5', keys: [`${FMT}#<top>`], maxPositiveDelta: 0, catchMaySwallow: false, untested: 0, t0: [false, false, true, false], tier: 0 },
    { label: 'F2', path: FMT, coords: [3, 0, 3, 1], atoms: 1, idPrefix: '09c4da60', tiePrefix: '63c8285b', keys: [`${FMT}#<top>`], maxPositiveDelta: 0, catchMaySwallow: false, untested: 0, t0: [false, false, true, false], tier: 0 },
    { label: 'F3', path: FMT, coords: [6, 1, 6, 2], atoms: 3, idPrefix: '585f5248', tiePrefix: 'f63780a3', keys: [`${FMT}#cell`], maxPositiveDelta: 0, catchMaySwallow: false, untested: 1, t0: [false, true, false, false], tier: 0 },
    { label: 'F4', path: FMT, coords: [13, 1, 14, 1], atoms: 2, idPrefix: '61ac5769', tiePrefix: 'ad44320a', keys: [`${FMT}#formatRow`], maxPositiveDelta: 0, catchMaySwallow: false, untested: 12, t0: F, tier: 2 },
  ],
  functions: [
    { key: `${FMT}#<top>`, class: 'matched', topLines: { base: [1, 2, 3], head: [1, 2, 3] }, changed: true, cyclomatic: [1, 1, 0], statements: 0, testRef: 'unknown' },
    { key: `${FMT}#cell`, class: 'matched', baseSpan: [5, 7], headSpan: [5, 8], changed: true, cyclomatic: [1, 1, 0], statements: 1, testRef: true },
    { key: `${FMT}#formatRow`, class: 'matched', baseSpan: [9, 23], headSpan: [10, 24], changed: true, cyclomatic: [4, 4, 0], statements: 12, testRef: true },
  ],
});

const BADGE = 'src/Badge.tsx';
checkChange('badge-tsx', {
  L: 10,
  hunks: [
    { label: 'B1', path: BADGE, coords: [11, 1, 10, 0], atoms: 1, idPrefix: '84e25d5b', tiePrefix: '8bcd2bd9', keys: [`${BADGE}#Badge`], maxPositiveDelta: 4, catchMaySwallow: false, untested: 2, t0: F, tier: 2, tierT6: 1 },
    { label: 'B2', path: BADGE, coords: [14, 3, 13, 4], atoms: 7, idPrefix: '3f3606c9', tiePrefix: '49cb8b54', keys: [`${BADGE}#Badge`], maxPositiveDelta: 4, catchMaySwallow: false, untested: 2, t0: F, tier: 2, tierT6: 1 },
    // B3 touches only the deleted `badgeTitle`; deleted functions are not listed in intersectingFunctionKeys
    // (src/core/types.ts: matched/new/<top> only) and contribute no delta.
    { label: 'B3', path: BADGE, coords: [20, 2, 19, 0], atoms: 2, idPrefix: 'ee8994ad', tiePrefix: '94925bf2', keys: [], maxPositiveDelta: 0, catchMaySwallow: false, untested: 0, t0: F, tier: 1 },
  ],
  functions: [
    { key: `${BADGE}#Badge`, class: 'matched', baseSpan: [9, 19], headSpan: [9, 19], changed: true, cyclomatic: [3, 7, 4], statements: 2, testRef: true },
    { key: `${BADGE}#badgeTitle`, class: 'deleted', baseSpan: [21, 21], headSpan: null, changed: true, cyclomatic: [1, null, 'unknown'], statements: 'unknown', testRef: 'unknown' },
    { key: `${BADGE}#<top>`, class: 'matched', topLines: { base: [1, 3, 4, 5, 6, 7], head: [1, 3, 4, 5, 6, 7] }, changed: false, cyclomatic: [1, 1, 0], statements: 0, testRef: 'unknown' },
  ],
});
