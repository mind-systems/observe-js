import { describe, it, expect } from 'vitest';
import { LEVELS, severityFor } from '../src/core/index.js';
import levelsData from '../contract/levels.json';

describe('LEVELS — sourced from contract/levels.json', () => {
  const contractLevels = levelsData.levels as Record<
    string,
    { severityNumber: number; severityText: string }
  >;

  it('key set matches contract exactly (no missing, no extra)', () => {
    const contractKeys = Object.keys(contractLevels).sort();
    const levelsKeys = Object.keys(LEVELS).sort();
    expect(levelsKeys).toEqual(contractKeys);
  });

  it.each(
    Object.entries(contractLevels).map(([k, v]) => [k, v.severityNumber, v.severityText] as const)
  )('%s → severityNumber %i, severityText %s', (levelKey, severityNumber, severityText) => {
      const level = levelKey as keyof typeof LEVELS;

      // LEVELS table
      expect(LEVELS[level].severityNumber).toBe(severityNumber);
      expect(LEVELS[level].severityText).toBe(severityText);

      // severityFor accessor returns the same values
      const result = severityFor(level);
      expect(result.severityNumber).toBe(severityNumber);
      expect(result.severityText).toBe(severityText);
    }
  );
});
