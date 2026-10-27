import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from '../core/hash';
import type { Policy } from '../policy/policy';
import { validatePolicy } from '../policy/policy';
export interface FrozenRegistration {
  schema: 's45.prereg/1'; status: string; frozenAt: string | null;
  policy: { selectedCandidateId: string | null; T: number | null; N: number | null };
  comparator: { primarySizeComparator: 'size-asc' | 'size-desc' | null };
  corpus: { commitmentHash: string | null; manifestHash: string | null };
  hashes: { protocolFiles: Record<string, string> | null; policy: string | null; implementationCommit: string | null; corpusCommitment: string | null };
}
/** Only declared product trees; never traverses corpus, sealed, transcripts, hidden folders or environment files. */
export function implementationFiles(root: string): string[] {
  const paths: string[] = [];
  const visit = (path: string) => { for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) throw new Error(`Unexpected source entry: ${path}/${entry.name}`);
    const next = `${path}/${entry.name}`;
    if (entry.isDirectory()) visit(next); else if (/\.(?:ts|tsx|json|md)$/.test(entry.name)) paths.push(next);
  } };
  for (const path of ['src', 'scripts', 'cli', 'docs', 'schemas', 'tests']) visit(path);
  return [...paths.filter(p => p !== 'docs/FREEZE.md'), 'package.json', 'tsconfig.json', 'policy.json', 'package-lock.json'].sort();
}
export function currentCommit(root: string): string {
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', shell: false }).trim();
}
export function requireCommittedImplementation(root: string): void {
  const paths = implementationFiles(root);
  // Every frozen implementation byte must already belong to the named commit, including the lockfile.
  execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', ...paths], { stdio: 'pipe', shell: false });
  execFileSync('git', ['-C', root, 'diff', '--exit-code', 'HEAD', '--', ...paths], { stdio: 'pipe', shell: false });
}
export function protocolHashes(root: string): Record<string, string> {
  return Object.fromEntries(implementationFiles(root).map(path => [path, sha256Hex(readFileSync(join(root, path)))]));
}
export function frozenPolicy(reg: FrozenRegistration): Policy {
  const { selectedCandidateId: id, T, N } = reg.policy;
  if (!id || T === null || N === null) throw new Error('No tuned policy');
  const policy = { id, T, N }; validatePolicy(policy); return policy;
}
export function verifyFreeze(root: string, reg: FrozenRegistration): void {
  if (reg.schema !== 's45.prereg/1' || reg.status !== 'frozen' || !reg.frozenAt || !reg.hashes.protocolFiles || !reg.comparator.primarySizeComparator) throw new Error('Frozen preregistration required');
  frozenPolicy(reg);
  const frozenDoc = readFileSync(join(root, 'docs/FREEZE.md'), 'utf8');
  const frozenPreregHash = /Preregistration SHA256: ([0-9a-f]{64})/.exec(frozenDoc)?.[1];
  if (!frozenPreregHash || frozenPreregHash !== sha256Hex(readFileSync(join(root, 'preregistration.json')))) throw new Error('Preregistration changed after freeze');
  if (JSON.stringify(protocolHashes(root)) !== JSON.stringify(reg.hashes.protocolFiles)) throw new Error('Held-out spent: source/protocol hash mismatch');
  if (!reg.hashes.implementationCommit || !/^[0-9a-f]{40}$/.test(reg.hashes.implementationCommit)) throw new Error('Invalid implementation commit');
  // Generated preregistration/FREEZE and later results may be committed after the implementation.
  // Source identity is the complete byte-hash map above; ancestry prevents silently switching histories.
  try { execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', reg.hashes.implementationCommit, 'HEAD'], { stdio: 'pipe', shell: false }); }
  catch { throw new Error('Implementation commit is outside current history'); }
  if (sha256Hex(readFileSync(join(root, 'policy.json'))) !== reg.hashes.policy) throw new Error('Policy hash mismatch');
  const commitment = sha256Hex(readFileSync(join(root, 'corpus/heldout.commitment.json')));
  if (commitment !== reg.hashes.corpusCommitment || commitment !== reg.corpus.commitmentHash) throw new Error('Commitment hash mismatch');
  if (sha256Hex(readFileSync(join(root, 'corpus/manifest.json'))) !== reg.corpus.manifestHash) throw new Error('Manifest hash mismatch');
}
/** Explicit gate receipt supplied by the Normal-mode gate operator, never inferred from flags or a draft. */
export function requireGate(root: string, receiptPath: string): void {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as { schema?: string; status?: string; manifestHash?: string; commitmentHash?: string; operatorSession?: string; authorSession?: string; builderSessions?: string[]; independenceRegistryVerified?: boolean; checks?: { predicate: string; ok: boolean }[] };
  const manifest = JSON.parse(readFileSync(join(root, 'corpus/manifest.json'), 'utf8')) as { authorSession: string };
  if (receipt.schema !== 's45.gate1/1' || receipt.status !== 'passed' || !receipt.operatorSession || !receipt.checks?.length || receipt.checks.some(c => !c.ok)) throw new Error('Gate 1 pass receipt required');
  const required = ['7.3.1', '7.3.2', '7.3.3', '7.3.4', '7.3.5', '7.3.6'];
  if (receipt.checks.length !== required.length || required.some(id => receipt.checks!.filter(c => c.predicate === id && c.ok).length !== 1)) throw new Error('Gate receipt requires each predicate 7.3.1..7.3.6 exactly once');
  if (receipt.authorSession !== manifest.authorSession || !receipt.builderSessions?.length || !receipt.independenceRegistryVerified || receipt.builderSessions.includes(manifest.authorSession) || receipt.builderSessions.includes(receipt.operatorSession)) throw new Error('Gate requires independently verified author and operator sessions outside builder lineage');
  if (receipt.manifestHash !== sha256Hex(readFileSync(join(root, 'corpus/manifest.json'))) || receipt.commitmentHash !== sha256Hex(readFileSync(join(root, 'corpus/heldout.commitment.json')))) throw new Error('Gate 1 receipt is for different corpus bytes');
}
