// plan 7.4 / D1 / D30 / 9 M2: the S41 adapter slot. No S41 edition has been inspected and no compatibility with S41
// data is claimed, so every method throws CorpusUnavailable. S41 never replaces the own corpus; S41 held-out data
// could only ever be scored as a separate "external replication" table, through a real adapter with a round-trip
// test, under a later plan revision.
import type { ChangeV1, CorpusManifestV1, CorpusPort, LabelV1, Split } from './contract';
import { CorpusUnavailable } from './port';

const REASON =
  'S41 corpus adapter is not implemented: no inspected S41 edition, no round-trip test (plan D1, D30). ' +
  'Use OwnCorpusSource.';

export class S41CorpusSource implements CorpusPort {
  manifest(): Promise<CorpusManifestV1> {
    throw new CorpusUnavailable('s41-adapter', REASON);
  }

  inputs(_split: Split): AsyncIterable<ChangeV1> {
    throw new CorpusUnavailable('s41-adapter', REASON);
  }

  labels(_split: Split): AsyncIterable<LabelV1> {
    throw new CorpusUnavailable('s41-adapter', REASON);
  }
}
