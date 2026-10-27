// plan 6.2 / D19 / D34: sha256 helpers for hunk ids and input hashes (docs/ATOMS.md sections 5 and 7).
// Pure: node:crypto only; no filesystem, no network.
import { createHash } from 'node:crypto';
import type { ChangeV1 } from './types';

/** Lowercase hex sha256 of a UTF-8 string or of raw bytes. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * docs/ATOMS.md section 5: hunk id = sha256(`changeId|path|baseStart|baseCount|headStart|headCount`), integers in
 * base 10 without padding or sign.
 */
export function hunkIdOf(
  changeId: string,
  path: string,
  baseStart: number,
  baseCount: number,
  headStart: number,
  headCount: number,
): string {
  return sha256Hex(`${changeId}|${path}|${baseStart}|${baseCount}|${headStart}|${headCount}`);
}

/** Canonical JSON of a ChangeV1: fixed key order (schema, id, files; path, base, head), files in input order. */
export function canonicalChangeJson(change: ChangeV1): string {
  return JSON.stringify({
    schema: change.schema,
    id: change.id,
    files: change.files.map((f) => ({ path: f.path, base: f.base, head: f.head })),
  });
}

/** sha256 of the canonical ChangeV1 JSON. */
export function changeInputHash(change: ChangeV1): string {
  return sha256Hex(canonicalChangeJson(change));
}

/** sha256 of the original (un-normalised) UTF-8 bytes of one side, or null for an absent side. */
export function sideHash(text: string | null): string | null {
  return text === null ? null : sha256Hex(text);
}

/**
 * UTF-8 byte length of a well-formed string without allocating the encoding (plan 6.1 limits are in bytes).
 * A lone surrogate counts 3 bytes (U+FFFD); such strings are rejected by safety.ts before limits apply.
 */
export function utf8ByteLength(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else {
        n += 3;
      }
    } else n += 3;
  }
  return n;
}
