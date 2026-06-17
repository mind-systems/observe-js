/**
 * Propagation unit tests — pure source-level, no context manager.
 *
 * All paths here pass ctx explicitly or operate on carriers only; they do not
 * depend on the Node/browser ContextManager being registered.
 */

import { describe, expect, it } from 'vitest';
import { inject, extract, objectCarrier, headersCarrier } from '../src/core/propagation.js';
import type { Context } from '../src/core/context.js';

// Valid context fixture — 32-char traceId, 16-char spanId, not all-zero.
const traceId = 'a'.repeat(32);
const spanId = 'b'.repeat(16);
const ctx: Context = { traceId, spanId, traceFlags: 1 };

// ── Round-trip ────────────────────────────────────────────────────────────────

describe('inject → extract round-trip (objectCarrier)', () => {
  it('extracted context equals the injected context', () => {
    const obj: Record<string, string> = {};
    inject(objectCarrier(obj), ctx);
    const out = extract(objectCarrier(obj));
    expect(out).toBeDefined();
    expect(out!.traceId).toBe(ctx.traceId);
    expect(out!.spanId).toBe(ctx.spanId);
    expect(out!.traceFlags).toBe(ctx.traceFlags);
  });
});

// ── W3C format ────────────────────────────────────────────────────────────────

describe('W3C traceparent format', () => {
  it('written value matches the W3C traceparent pattern', () => {
    const obj: Record<string, string> = {};
    inject(objectCarrier(obj), ctx);
    expect(obj['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it('flags field renders as 2-char lowercase hex (sampled = "01")', () => {
    const obj: Record<string, string> = {};
    inject(objectCarrier(obj), { traceId, spanId, traceFlags: 1 });
    expect(obj['traceparent']).toMatch(/-01$/);
  });

  it('flags field renders with leading zero for values < 0x10', () => {
    const obj: Record<string, string> = {};
    inject(objectCarrier(obj), { traceId, spanId, traceFlags: 0 });
    expect(obj['traceparent']).toMatch(/-00$/);
  });

  it('flags field masks to a byte', () => {
    const obj: Record<string, string> = {};
    inject(objectCarrier(obj), { traceId, spanId, traceFlags: 0x101 });
    expect(obj['traceparent']).toMatch(/-01$/);
  });
});

// ── Malformed → undefined ─────────────────────────────────────────────────────

describe('extract malformed inputs → undefined, never throws', () => {
  function tryExtract(value: string | undefined): Context | undefined {
    const obj: Record<string, string> = {};
    if (value !== undefined) obj['traceparent'] = value;
    return extract(objectCarrier(obj));
  }

  it('absent header → undefined', () => {
    expect(tryExtract(undefined)).toBeUndefined();
  });

  it('empty string → undefined', () => {
    expect(tryExtract('')).toBeUndefined();
  });

  it('wrong version (01-...) → undefined', () => {
    expect(tryExtract(`01-${traceId}-${spanId}-01`)).toBeUndefined();
  });

  it('all-zero traceId → undefined', () => {
    expect(tryExtract(`00-${'0'.repeat(32)}-${spanId}-01`)).toBeUndefined();
  });

  it('all-zero spanId → undefined', () => {
    expect(tryExtract(`00-${traceId}-${'0'.repeat(16)}-01`)).toBeUndefined();
  });

  it('short traceId (31 chars) → undefined', () => {
    expect(tryExtract(`00-${'a'.repeat(31)}-${spanId}-01`)).toBeUndefined();
  });

  it('long traceId (33 chars) → undefined', () => {
    expect(tryExtract(`00-${'a'.repeat(33)}-${spanId}-01`)).toBeUndefined();
  });

  it('short spanId (15 chars) → undefined', () => {
    expect(tryExtract(`00-${traceId}-${'b'.repeat(15)}-01`)).toBeUndefined();
  });

  it('long spanId (17 chars) → undefined', () => {
    expect(tryExtract(`00-${traceId}-${'b'.repeat(17)}-01`)).toBeUndefined();
  });

  it('missing field (3 parts instead of 4) → undefined', () => {
    expect(tryExtract(`00-${traceId}-${spanId}`)).toBeUndefined();
  });

  it('uppercase hex in traceId → undefined', () => {
    expect(tryExtract(`00-${'A'.repeat(32)}-${spanId}-01`)).toBeUndefined();
  });

  it('uppercase hex in spanId → undefined', () => {
    expect(tryExtract(`00-${traceId}-${'B'.repeat(16)}-01`)).toBeUndefined();
  });

  it('1-char flags field → undefined', () => {
    expect(tryExtract(`00-${traceId}-${spanId}-1`)).toBeUndefined();
  });

  it('non-hex chars → undefined', () => {
    expect(tryExtract(`00-${traceId}-${spanId}-zz`)).toBeUndefined();
  });
});

// ── Case-insensitive key lookup ───────────────────────────────────────────────

describe('objectCarrier case-insensitive lookup', () => {
  it('key "Traceparent" is found by extract()', () => {
    const obj: Record<string, string> = {
      Traceparent: `00-${traceId}-${spanId}-01`,
    };
    const out = extract(objectCarrier(obj));
    expect(out).toBeDefined();
    expect(out!.traceId).toBe(traceId);
  });

  it('key "TRACEPARENT" is found by extract()', () => {
    const obj: Record<string, string> = {
      TRACEPARENT: `00-${traceId}-${spanId}-01`,
    };
    const out = extract(objectCarrier(obj));
    expect(out).toBeDefined();
  });
});

// ── tracestate pass-through ───────────────────────────────────────────────────

describe('tracestate pass-through', () => {
  it('carrier with tracestate round-trips it verbatim', () => {
    const ctxWithState: Context = { ...ctx, traceState: 'vendor=value,other=x' };
    const obj: Record<string, string> = {};
    inject(objectCarrier(obj), ctxWithState);
    const out = extract(objectCarrier(obj));
    expect(out).toBeDefined();
    expect(out!.traceState).toBe('vendor=value,other=x');
  });

  it('absence of traceState leaves field undefined on extracted Context', () => {
    const obj: Record<string, string> = {};
    inject(objectCarrier(obj), ctx);
    const out = extract(objectCarrier(obj));
    expect(out).toBeDefined();
    expect(out!.traceState).toBeUndefined();
  });

  it('absence of traceState writes no tracestate key to carrier', () => {
    const obj: Record<string, string> = {};
    inject(objectCarrier(obj), ctx);
    expect(Object.keys(obj).map((k) => k.toLowerCase())).not.toContain('tracestate');
  });
});

// ── headersCarrier round-trip ─────────────────────────────────────────────────

describe('headersCarrier round-trip', () => {
  it('inject then extract over a real Headers instance returns the original context', () => {
    const headers = new Headers();
    inject(headersCarrier(headers), ctx);
    const out = extract(headersCarrier(headers));
    expect(out).toBeDefined();
    expect(out!.traceId).toBe(ctx.traceId);
    expect(out!.spanId).toBe(ctx.spanId);
    expect(out!.traceFlags).toBe(ctx.traceFlags);
  });

  it('headersCarrier is case-insensitive on get', () => {
    const headers = new Headers();
    headers.set('Traceparent', `00-${traceId}-${spanId}-01`);
    const out = extract(headersCarrier(headers));
    expect(out).toBeDefined();
    expect(out!.traceId).toBe(traceId);
  });
});
