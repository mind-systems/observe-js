/**
 * Node ambient context test.
 *
 * Imports the Node entry first to register the AsyncLocalStorage-backed
 * ContextManager before any context functions are called. Without this import
 * the active manager is still the no-op, whose active() always returns undefined
 * and whose with() only calls fn() — the across-await assertion would fail.
 *
 * Kept in a dedicated file because setContextManager() mutates process-global
 * module state; vitest isolates modules per file, preventing cross-entry
 * interference with other test files.
 */

// Side effect: registers the Node ContextManager via setContextManager().
import '../src/node/index.js';

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getActiveContext, runWithContext } from '../src/core/index.js';
import type { Context } from '../src/core/index.js';

const ctx: Context = { traceId: 'abc123', spanId: 'def456', traceFlags: 1 };

// ── Source-level tests ────────────────────────────────────────────────────────

describe('Node AsyncLocalStorage context (src/)', () => {
  it('returns undefined outside any scope', () => {
    expect(getActiveContext()).toBeUndefined();
  });

  it('is visible inside runWithContext', () => {
    runWithContext(ctx, () => {
      expect(getActiveContext()).toEqual(ctx);
    });
  });

  it('is visible across an await boundary inside the scoped function', async () => {
    await runWithContext(ctx, async () => {
      await Promise.resolve();
      expect(getActiveContext()).toEqual(ctx);
    });
  });

  it('restores the previous context after scope returns', () => {
    expect(getActiveContext()).toBeUndefined();

    runWithContext(ctx, () => {
      expect(getActiveContext()).toEqual(ctx);
    });

    expect(getActiveContext()).toBeUndefined();
  });

  it('restores the previous context even when the scoped function throws', () => {
    expect(getActiveContext()).toBeUndefined();

    expect(() =>
      runWithContext(ctx, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(getActiveContext()).toBeUndefined();
  });
});

// ── dist/-level test: registration survives bundling ─────────────────────────
// Imported from dist/node.mjs independently — the bundled module's context
// registry is a separate instance from src/, so there is no cross-contamination.

const root = resolve(process.cwd());

describe('dist/node.mjs context registration survives bundling', () => {
  it('getActiveContext inside runWithContext sees the context via dist bundle', async () => {
    const dist = await import(resolve(root, 'dist/node.mjs'));
    const distCtx: Context = { traceId: 'dist-trace', spanId: 'dist-span', traceFlags: 1 };

    let seen: unknown;
    dist.runWithContext(distCtx, () => {
      seen = dist.getActiveContext();
    });

    expect(seen).toEqual(distCtx);
  });
});
