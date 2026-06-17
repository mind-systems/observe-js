/**
 * Browser fetch propagation tests.
 *
 * Imports the browser entry first to register the browser ContextManager.
 * Kept in a dedicated file because the context registration mutates
 * process-global state; vitest's per-file isolation prevents interference.
 *
 * DOM globals used: fetch, Headers. Both are native in Node 18+ so no stubs
 * are needed for Headers. globalThis.fetch is replaced with a spy for the
 * duration of each test.
 */

// Side effect: registers the browser ContextManager.
import '../src/browser/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withSpan, getActiveContext } from '../src/core/index.js';
import { tracedFetch, withTraceparent } from '../src/browser/fetch.js';

// ── fetch spy setup ───────────────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── withTraceparent ───────────────────────────────────────────────────────────

describe('withTraceparent()', () => {
  it('outside any span: returns Headers with no traceparent header', () => {
    expect(getActiveContext()).toBeUndefined();
    const headers = withTraceparent();
    expect(headers.get('traceparent')).toBeNull();
  });

  it('inside withSpan: adds a correctly formatted traceparent header', () => {
    withSpan('test', () => {
      const ctx = getActiveContext()!;
      const headers = withTraceparent();
      const tp = headers.get('traceparent');
      expect(tp).not.toBeNull();
      // W3C format: 00-<32hex>-<16hex>-<2hex>
      expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
      expect(tp).toContain(ctx.traceId);
      expect(tp).toContain(ctx.spanId);
    });
  });

  it('merges existing headers and adds traceparent on top', () => {
    withSpan('merge-test', () => {
      const headers = withTraceparent({ 'x-custom': 'value' });
      expect(headers.get('x-custom')).toBe('value');
      expect(headers.get('traceparent')).not.toBeNull();
    });
  });

  it('preserves existing Headers instance entries', () => {
    withSpan('existing-headers', () => {
      const existing = new Headers({ authorization: 'Bearer token' });
      const headers = withTraceparent(existing);
      expect(headers.get('authorization')).toBe('Bearer token');
      expect(headers.get('traceparent')).not.toBeNull();
    });
  });
});

// ── tracedFetch ───────────────────────────────────────────────────────────────

describe('tracedFetch()', () => {
  it('outside any span: calls fetch without a traceparent header', async () => {
    expect(getActiveContext()).toBeUndefined();
    await tracedFetch('https://example.com/api');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get('traceparent')).toBeNull();
  });

  it('inside withSpan: calls fetch with a traceparent header matching the active span', async () => {
    await withSpan('traced-call', async () => {
      const ctx = getActiveContext()!;
      await tracedFetch('https://example.com/api');

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Headers;
      const tp = headers.get('traceparent');
      expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
      expect(tp).toContain(ctx.traceId);
      expect(tp).toContain(ctx.spanId);
    });
  });

  it('preserves init.headers passed by the caller', async () => {
    await withSpan('preserve-headers', async () => {
      await tracedFetch('https://example.com/api', {
        headers: { 'x-request-id': '42' },
      });

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Headers;
      expect(headers.get('x-request-id')).toBe('42');
      expect(headers.get('traceparent')).not.toBeNull();
    });
  });

  it('passes through the URL and other init fields unchanged', async () => {
    await tracedFetch('https://example.com/submit', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/submit');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });
});
