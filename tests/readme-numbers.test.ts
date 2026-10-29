import { describe, it, expect } from 'vitest';
import { checkReadmeNumbers } from '../scripts/check-readme-numbers';

describe('README numeric provenance (engineering guard, not study evidence)', () => {
  it('allows protocol budgets and refuses an invented result', () => {
    expect(checkReadmeNumbers('Budget 20%, sensitivity 10%/30%, interval 95%.')).toEqual([]);
    expect(checkReadmeNumbers('Recall 87%.').length).toBeGreaterThan(0);
    expect(checkReadmeNumbers('Observed superiority.').length).toBeGreaterThan(0);
  });
  it('accepts a numerical result only with the measured schema', () => {
    expect(checkReadmeNumbers('Recall 87%.', { schema: 's45.results/1', state: 'measured', rows: [{ recall20: .87 }] })).toEqual([]);
    expect(checkReadmeNumbers('Recall 87%.', { state: 'mock', rows: [{ recall20: .87 }] }).length).toBeGreaterThan(0);
  });
});
