/**
 * Propagation tests — Node layer (active-context path + dist reachability).
 *
 * Imports the Node entry first to register the AsyncLocalStorage-backed
 * ContextManager before any span/propagation functions are called. Without
 * this import the active manager is the no-op, so inject() with no ctx arg
 * would always be a no-op, making the active-context assertions vacuous.
 *
 * Uses the .node.test.ts suffix because this suite registers the Node
 * ContextManager and mutates process-global module state; vitest's per-file
 * isolation keeps it from leaking into other suites.
 */

// Side effect: registers the Node ContextManager via setContextManager().
import '../src/node/index.js';

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withSpan, getActiveContext } from '../src/core/index.js';
import { inject, extract, objectCarrier, headersCarrier } from '../src/core/propagation.js';

// ── Active-context default path ───────────────────────────────────────────────

describe('inject() active-context default', () => {
  it('inside withSpan, inject with no ctx arg writes the active span ids', () => {
    const obj: Record<string, string> = {};
    const carrier = objectCarrier(obj);

    withSpan('test-span', () => {
      const ctx = getActiveContext()!;
      inject(carrier);
      const out = extract(objectCarrier(obj));
      expect(out).toBeDefined();
      expect(out!.traceId).toBe(ctx.traceId);
      expect(out!.spanId).toBe(ctx.spanId);
      expect(out!.traceFlags).toBe(ctx.traceFlags);
    });
  });

  it('outside any span, inject with no ctx arg is a no-op (carrier stays empty)', () => {
    expect(getActiveContext()).toBeUndefined();
    const obj: Record<string, string> = {};
    inject(objectCarrier(obj));
    expect(Object.keys(obj)).toHaveLength(0);
  });
});

// ── dist reachability ─────────────────────────────────────────────────────────

const root = resolve(process.cwd());

describe('dist/node.mjs propagation API survives bundling', () => {
  it('exports inject, extract, objectCarrier, headersCarrier as functions', async () => {
    const dist = await import(resolve(root, 'dist/node.mjs'));
    expect(typeof dist.inject).toBe('function');
    expect(typeof dist.extract).toBe('function');
    expect(typeof dist.objectCarrier).toBe('function');
    expect(typeof dist.headersCarrier).toBe('function');
  });
});

describe('dist/browser.mjs propagation API survives bundling', () => {
  it('exports inject, extract, objectCarrier, headersCarrier as functions', async () => {
    const dist = await import(resolve(root, 'dist/browser.mjs'));
    expect(typeof dist.inject).toBe('function');
    expect(typeof dist.extract).toBe('function');
    expect(typeof dist.objectCarrier).toBe('function');
    expect(typeof dist.headersCarrier).toBe('function');
  });
});
