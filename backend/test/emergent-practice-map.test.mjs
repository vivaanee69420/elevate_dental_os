import { describe, it, expect } from 'vitest';

describe('emergentPracticeMapRepository shape', () => {
  it('exports the expected methods', async () => {
    const { emergentPracticeMapRepository: repo } =
      await import('../src/repositories/emergent-practice-map.repository.js');
    for (const m of ['list', 'discover', 'setMapping', 'practiceOptions']) {
      expect(typeof repo[m]).toBe('function');
    }
  });
});
