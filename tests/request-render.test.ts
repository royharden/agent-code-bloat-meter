import { describe, expect, it } from 'vitest';
import { renderRequest } from '../src/review/port';

describe('review request boundary', () => {
  it('reconstructs only the declared fields even when runtime input carries study metadata', () => {
    const request = { changeHash: 'a'.repeat(64), files: [{ path: 'a.ts', base: null, head: 'const x = 1;', tier: 2 }],
      selectedAtoms: [{ path: 'a.ts', side: 'head' as const, line: 1, family: 'SECRET_FAMILY' }],
      model: 'mock', maxOutputTokens: 100, label: 'SECRET_LABEL', family: 'SECRET_FAMILY',
      trapId: 'SECRET_TRAP', tier: 2, variant: 'SECRET_VARIANT', witnessName: 'SECRET_WITNESS' };
    const rendered = JSON.parse(renderRequest(request));
    expect(Object.keys(rendered)).toEqual(['changeHash', 'files', 'selectedAtoms', 'model', 'maxOutputTokens']);
    expect(rendered.files).toEqual([{ path: 'a.ts', base: null, head: 'const x = 1;' }]);
    expect(rendered.selectedAtoms).toEqual([{ path: 'a.ts', side: 'head', line: 1 }]);
    expect(JSON.stringify(rendered)).not.toContain('SECRET_');
  });
});
