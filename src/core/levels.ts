// Canonical level → OTLP severity mapping sourced from the inlined contract files.
// Do not redeclare severity numbers here — they come from contract/levels.json.

import levelsData from '../../contract/levels.json';

// Union of the canonical level keys defined by the contract.
export type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// Typed table derived from levelsData.levels — top-level $comment/version keys ignored.
// Frozen (shallow + inner) so callers cannot corrupt the canonical table.
const _levelsRaw = levelsData.levels as Record<Level, { severityNumber: number; severityText: string }>;
for (const entry of Object.values(_levelsRaw)) Object.freeze(entry);

export const LEVELS: Readonly<Record<Level, Readonly<{ severityNumber: number; severityText: string }>>> =
  Object.freeze(_levelsRaw);

// Module-load guard: assert the contract keys and the Level union are in sync.
// A contract bump that adds or removes a level will fail here rather than silently misbehave.
const CONTRACT_KEYS = Object.keys(levelsData.levels).sort();
const UNION_KEYS: Level[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

if (CONTRACT_KEYS.join(',') !== [...UNION_KEYS].sort().join(',')) {
  throw new Error(
    `observe-js: Level union is out of sync with contract/levels.json.\n` +
      `  contract keys : ${CONTRACT_KEYS.join(', ')}\n` +
      `  union keys    : ${[...UNION_KEYS].sort().join(', ')}`
  );
}

/** Returns the severityNumber and severityText for the given level. */
export function severityFor(level: Level): { severityNumber: number; severityText: string } {
  return LEVELS[level];
}
