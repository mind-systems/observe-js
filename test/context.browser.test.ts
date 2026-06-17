/**
 * Browser ambient context tests.
 *
 * Imports the browser entry first to register the explicit ContextManager
 * before any context functions are called. Without this import the active
 * manager is still the no-op, whose active() always returns undefined and
 * whose with() only calls fn() — the assertions would pass vacuously.
 *
 * Kept in a dedicated file because setContextManager() mutates process-global
 * module state; vitest isolates modules per file, preventing cross-entry
 * interference with other test files.
 *
 * Context boundary: the browser ContextManager is synchronous. Context is
 * visible in the synchronous call stack and immediately-chained microtasks.
 * It does NOT survive arbitrary await hops — that is the intended contract
 * caveat for v0.1.2 (documented here via an explicit test).
 */

// Side effect: registers the browser ContextManager via setContextManager().
import '../src/browser/index.js';

import { describe, expect, it } from 'vitest';
import { getActiveContext, runWithContext, withSpan, startSpan } from '../src/core/index.js';
import type { Context } from '../src/core/index.js';

const ctx: Context = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 };

describe('Browser explicit context manager', () => {
  it('returns undefined outside any scope', () => {
    expect(getActiveContext()).toBeUndefined();
  });

  it('is visible inside runWithContext', () => {
    runWithContext(ctx, () => {
      expect(getActiveContext()).toEqual(ctx);
    });
  });

  it('is restored after scope returns', () => {
    expect(getActiveContext()).toBeUndefined();
    runWithContext(ctx, () => {
      expect(getActiveContext()).toEqual(ctx);
    });
    expect(getActiveContext()).toBeUndefined();
  });

  it('is restored even when the callback throws', () => {
    expect(getActiveContext()).toBeUndefined();

    expect(() =>
      runWithContext(ctx, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(getActiveContext()).toBeUndefined();
  });

  it('nested withSpan restores the parent context on exit', () => {
    withSpan('outer', () => {
      const outerCtx = getActiveContext()!;
      withSpan('inner', () => {
        // inner scope — has a different spanId
        expect(getActiveContext()?.traceId).toBe(outerCtx.traceId);
      });
      // outer context is restored
      expect(getActiveContext()).toEqual(outerCtx);
    });
    expect(getActiveContext()).toBeUndefined();
  });

  it('getActiveContext() inside withSpan reflects span traceId/spanId (the values log() reads for stamping)', () => {
    // log() reads getActiveContext() at the call site (sdk.ts:161-167) to stamp
    // traceId/spanId on the record. Here we verify the context variable holds
    // the correct values during a synchronous withSpan scope — the same values
    // log() would stamp. Full end-to-end stamping is covered by unload.browser.test.ts
    // which drives init()+log()+flush() through a captured exporter.
    const span = startSpan('stamped');
    withSpan(span, () => {
      const active = getActiveContext();
      expect(active?.traceId).toBe(span.traceId);
      expect(active?.spanId).toBe(span.spanId);
    });
  });

  it('context boundary: context is NOT retained after an await hop (explicit contract caveat)', async () => {
    // The browser ContextManager is an explicit variable with sync save/restore.
    // After the first microtask continuation runs, the variable is already
    // restored to the outer (undefined) value. This test pins that behavior
    // so it is visible as deliberate rather than accidentally broken.
    let seenAfterAwait: Context | undefined = ctx; // sentinel

    await runWithContext(ctx, async () => {
      // Synchronously visible:
      expect(getActiveContext()).toEqual(ctx);
      await Promise.resolve();
      // After an await the variable has been restored by the finally in with():
      seenAfterAwait = getActiveContext();
    });

    // The browser manager restored to undefined when the async fn suspended.
    expect(seenAfterAwait).toBeUndefined();
  });
});
