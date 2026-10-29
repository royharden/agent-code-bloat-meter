// plan 7.4 / 9 M2: OwnCorpusSource, the default corpus source. SCORER SIDE: this module reads labels.
// Only src/corpus, src/orderings/evaluate.ts, scripts/eval.ts, scripts/tune.ts and tests/ may import it (plan 9 G4).
// Analysis code imports OwnCorpusInputs / readInputs from ./inputs instead.
//
// Held-out labels are read only from the released scratch copy, and only after the P6 session has hashed and
// recorded the predictions (plan 7.5, D26; enforced by src/heldout in M4, not here). After label release the
// caller must run checkRequiredAtomsExist (validate.ts, D34) and abort before scoring on any miss.
import type { CorpusPort, LabelV1, Split } from './contract';
import { OwnCorpusInputs, parseJsonBytes } from './inputs';
import type { OwnCorpusOptions } from './inputs';
import { CorpusIntegrityError } from './port';

export type { OwnCorpusOptions } from './inputs';

/** Minimal shape check of one label file; validateLabels (validate.ts) performs the full plan 7.4 checks. */
function checkLabelHeader(value: unknown, expectedId: string, split: Split): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['label is not a JSON object'];
  const v = value as Record<string, unknown>;
  const problems: string[] = [];
  if (v.schema !== 's45.label/1') problems.push(`schema must be 's45.label/1'`);
  if (v.changeId !== expectedId) {
    problems.push(`changeId ${JSON.stringify(v.changeId)} does not match manifest id ${expectedId}`);
  }
  if (v.split !== split) problems.push(`split ${JSON.stringify(v.split)} read from the ${split} split`);
  if (v.kind !== 'clean' && v.kind !== 'defect' && v.kind !== 'near_miss') problems.push('kind is invalid');
  return problems;
}

export class OwnCorpusSource extends OwnCorpusInputs implements CorpusPort {
  /**
   * Scorer only. Every label file of the split is verified against `manifest.files`, the change's `labelHash`
   * and (held-out) the commitment before the first label is yielded. Order: change id ascending.
   */
  async *labels(split: Split): AsyncIterable<LabelV1> {
    const verified = await this.reader.readChangeFiles(split, 'labels', (c) => c.labelHash);
    const parsed: LabelV1[] = [];
    for (const { id, key, bytes } of verified) {
      const value = parseJsonBytes(bytes, key);
      const problems = checkLabelHeader(value, id, split);
      if (problems.length > 0) throw new CorpusIntegrityError(`${key}: ${problems.join('; ')}`, key);
      parsed.push(value as LabelV1);
    }
    yield* parsed;
  }
}

/** Convenience for the scorer: collect one split's verified labels. */
export async function readLabels(options: OwnCorpusOptions, split: Split): Promise<LabelV1[]> {
  const source = new OwnCorpusSource(options);
  const out: LabelV1[] = [];
  for await (const label of source.labels(split)) out.push(label);
  return out;
}
