/**
 * Span correlation tests (Node layer).
 *
 * Imports the Node entry first to register the AsyncLocalStorage-backed
 * ContextManager before any span functions are called. Without this import
 * the active manager is the no-op, whose with() only calls fn() — nesting
 * assertions would pass vacuously.
 *
 * Uses the .node.test.ts suffix (matching context.node.test.ts) because this
 * suite registers the Node ContextManager and mutates process-global module
 * state; vitest's per-file isolation keeps it from leaking into other suites.
 */

// Side effect: registers the Node ContextManager via setContextManager().
import '../src/node/index.js';

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getActiveContext } from '../src/core/index.js';
import { startSpan, withSpan } from '../src/core/index.js';
import type { Span } from '../src/core/index.js';

// ── Source-level tests ────────────────────────────────────────────────────────

describe('startSpan — id shape', () => {
  it('produces a valid 32-char lowercase hex traceId', () => {
    const span = startSpan();
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces a valid 16-char lowercase hex spanId', () => {
    const span = startSpan();
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('traceId is not all-zero', () => {
    const span = startSpan();
    expect(span.traceId).not.toBe('0'.repeat(32));
  });

  it('spanId is not all-zero', () => {
    const span = startSpan();
    expect(span.spanId).not.toBe('0'.repeat(16));
  });

  it('traceFlags is 1 (sampled)', () => {
    const span = startSpan();
    expect(span.traceFlags).toBe(1);
  });
});

describe('startSpan — root trace (no active context)', () => {
  it('has no parentSpanId at root', () => {
    expect(getActiveContext()).toBeUndefined();
    const span = startSpan();
    expect(span.parentSpanId).toBeUndefined();
  });

  it('two root spans produce different traceIds', () => {
    const a = startSpan();
    const b = startSpan();
    expect(a.traceId).not.toBe(b.traceId);
  });
});

describe('withSpan — context inheritance', () => {
  it('ambient context inside withSpan matches the span traceId and spanId', () => {
    const span = startSpan();
    withSpan(span, () => {
      const ctx = getActiveContext();
      expect(ctx?.traceId).toBe(span.traceId);
      expect(ctx?.spanId).toBe(span.spanId);
    });
  });

  it('ambient context is undefined after withSpan returns', () => {
    withSpan('root', () => {
      // inside scope
    });
    expect(getActiveContext()).toBeUndefined();
  });
});

describe('withSpan — nesting', () => {
  it('inner span inherits outer traceId', () => {
    withSpan('outer', () => {
      const outer = getActiveContext()!;
      withSpan('inner', () => {
        const inner = getActiveContext()!;
        expect(inner.traceId).toBe(outer.traceId);
      });
    });
  });

  it('inner span parentSpanId equals outer spanId', () => {
    withSpan('outer', () => {
      const outerCtx = getActiveContext()!;
      const inner = startSpan('inner');
      expect(inner.parentSpanId).toBe(outerCtx.spanId);
    });
  });

  it('inner spanId differs from outer spanId', () => {
    withSpan('outer', () => {
      const outer = getActiveContext()!;
      withSpan('inner', () => {
        const inner = getActiveContext()!;
        expect(inner.spanId).not.toBe(outer.spanId);
      });
    });
  });

  it('restores outer context after inner withSpan exits', () => {
    withSpan('outer', () => {
      const outerCtx = getActiveContext()!;
      withSpan('inner', () => {
        // inner scope
      });
      expect(getActiveContext()).toEqual(outerCtx);
    });
  });

  it('restores undefined context after outer withSpan exits', () => {
    withSpan('outer', () => {
      withSpan('inner', () => {
        // inner scope
      });
    });
    expect(getActiveContext()).toBeUndefined();
  });
});

describe('withSpan — restore on throw', () => {
  it('restores context to undefined even when fn throws', () => {
    expect(getActiveContext()).toBeUndefined();

    expect(() =>
      withSpan('error-span', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    expect(getActiveContext()).toBeUndefined();
  });

  it('restores outer context even when inner fn throws', () => {
    withSpan('outer', () => {
      const outerCtx = getActiveContext()!;

      expect(() =>
        withSpan('inner', () => {
          throw new Error('inner-boom');
        }),
      ).toThrow('inner-boom');

      expect(getActiveContext()).toEqual(outerCtx);
    });
  });
});

describe('withSpan — explicit Span object', () => {
  it('uses the provided Span as-is without creating a new one', () => {
    const existing: Span = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      traceFlags: 1,
    };

    withSpan(existing, () => {
      const ctx = getActiveContext()!;
      expect(ctx.traceId).toBe(existing.traceId);
      expect(ctx.spanId).toBe(existing.spanId);
    });
  });
});

// ── dist/-level test: span API survives bundling and is publicly reachable ────
// Imported from dist/node.mjs independently — the bundled module's context
// registry is a separate instance from src/, so there is no cross-contamination.

const root = resolve(process.cwd());

describe('dist/node.mjs span API survives bundling', () => {
  it('exports startSpan and withSpan as functions', async () => {
    const dist = await import(resolve(root, 'dist/node.mjs'));
    expect(typeof dist.startSpan).toBe('function');
    expect(typeof dist.withSpan).toBe('function');
  });

  it('withSpan over dist bundle scopes a context whose ids match the span', async () => {
    const dist = await import(resolve(root, 'dist/node.mjs'));

    const span = dist.startSpan('dist-test');
    let seenTraceId: string | undefined;
    let seenSpanId: string | undefined;

    dist.withSpan(span, () => {
      const ctx = dist.getActiveContext();
      seenTraceId = ctx?.traceId;
      seenSpanId = ctx?.spanId;
    });

    expect(seenTraceId).toBe(span.traceId);
    expect(seenSpanId).toBe(span.spanId);
  });
});
