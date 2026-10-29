import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentCommit, protocolHashes, requireGate, requireCommittedImplementation } from '../src/heldout/custody';
import type { FrozenRegistration } from '../src/heldout/custody';
import { sha256Hex } from '../src/core/hash';
import { tuneDev } from './tune';
/** Re-runs only dev to bind selection to the frozen checkout, never trusts a caller-supplied winner. */
export async function freeze(root: string, gate: string): Promise<void> {
  requireGate(root, gate);
  requireCommittedImplementation(root);
  const path = resolve(root, 'preregistration.json');
  const reg = JSON.parse(readFileSync(path, 'utf8')) as FrozenRegistration;
  if (reg.status !== 'draft-unfrozen') throw new Error('Refusing to overwrite a freeze');
  const tuning = await tuneDev(root, gate);
  if (!tuning.selected) throw new Error('no valid policy in the declared space');
  reg.policy.selectedCandidateId = tuning.selected.id; reg.policy.T = tuning.selected.T; reg.policy.N = tuning.selected.N;
  reg.comparator.primarySizeComparator = tuning.comparator;
  reg.corpus.manifestHash = tuning.manifestHash;
  reg.corpus.commitmentHash = sha256Hex(readFileSync(resolve(root, 'corpus/heldout.commitment.json')));
  reg.hashes = { protocolFiles: protocolHashes(root), policy: sha256Hex(readFileSync(resolve(root, 'policy.json'))), implementationCommit: currentCommit(root), corpusCommitment: reg.corpus.commitmentHash };
  reg.status = 'frozen'; reg.frozenAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(reg, null, 2) + '\n');
  writeFileSync(resolve(root, 'docs/FREEZE.md'), `# Frozen protocol\n\nFrozen at ${reg.frozenAt}. Implementation ${reg.hashes.implementationCommit}.\n\nPolicy ${tuning.selected.id}; comparator ${tuning.comparator}.\n\nPreregistration SHA256: ${sha256Hex(readFileSync(path))}\n\nCandidates and dev lock:\n\n\`\`\`json\n${JSON.stringify(tuning, null, 2)}\n\`\`\`\n\nProtocol file hashes:\n\n\`\`\`json\n${JSON.stringify(reg.hashes.protocolFiles, null, 2)}\n\`\`\`\n`);
}
if (/(^|[\\/])freeze\.ts$/.test(process.argv[1] ?? '')) {
  const i = process.argv.indexOf('--gate'), gate = process.argv[i + 1];
  if (i < 0 || !gate) throw new Error('Required --gate <Normal-mode Gate 1 receipt>');
  freeze(fileURLToPath(new URL('../', import.meta.url)), gate).catch(error => { console.error(error); process.exitCode = 1; });
}
