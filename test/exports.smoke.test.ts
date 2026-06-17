/**
 * Exports resolution smoke test.
 *
 * Asserts that:
 * 1. All dist artifacts referenced by package.json exports exist on disk.
 * 2. The built node and browser entries are dynamically importable and export
 *    the expected placeholder symbol.
 *
 * The `test` script runs `npm run build` first, so dist/ is guaranteed to
 * exist by the time this test runs — this test must not attempt to build itself.
 *
 * Note: importing dist/browser.mjs under the Node vitest environment covers
 * stub resolution only. Once the browser layer references DOM/browser globals
 * (task 10), a browser-compatible test environment will be needed for that
 * entry — see .ai-factory/notes/10-browser-layer.md.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = resolve(process.cwd());

// Every dist path referenced in the package.json exports map.
const expectedPaths = [
  'dist/browser.mjs',
  'dist/browser.cjs',
  'dist/browser.d.ts',
  'dist/node.mjs',
  'dist/node.cjs',
  'dist/node.d.ts',
  'dist/winston.mjs',
  'dist/winston.cjs',
  'dist/winston.d.ts',
];

describe('dist artifacts', () => {
  it.each(expectedPaths)('%s exists', (rel) => {
    expect(existsSync(resolve(root, rel))).toBe(true);
  });
});

describe('entry stub imports', () => {
  it('dist/node.mjs exports __sdk', async () => {
    const mod = await import(resolve(root, 'dist/node.mjs'));
    expect(mod.__sdk).toBe('observe-js');
  });

  it('dist/browser.mjs exports __sdk', async () => {
    // Stub resolution only — the browser layer has no DOM globals yet.
    const mod = await import(resolve(root, 'dist/browser.mjs'));
    expect(mod.__sdk).toBe('observe-js');
  });
});

// Full public API surface — asserted against the built dist artifacts so that
// any accidental omission from the node or browser entry is caught at build time.
const PUBLIC_API_FUNCTIONS = [
  'init',
  'log',
  'flush',
  'shutdown',
  'startSpan',
  'withSpan',
  'inject',
  'extract',
] as const;

const DIST_ENTRIES = ['dist/node.mjs', 'dist/browser.mjs'] as const;

describe('full public API on built artifacts', () => {
  it.each(DIST_ENTRIES)('%s exports all public API functions', async (entry) => {
    const mod = await import(resolve(root, entry));
    for (const name of PUBLIC_API_FUNCTIONS) {
      expect(typeof mod[name], `${entry}: ${name}`).toBe('function');
    }
  });
});
