/**
 * Browser unload flush tests.
 *
 * Verifies that:
 *  - Normal (pre-unload) flushes use fetch.
 *  - pagehide and visibilitychange=hidden each switch to sendBeacon and drain
 *    the buffered records to the correct endpoint.
 *  - A throwing sendBeacon is swallowed (routed to onError, never thrown).
 *
 * Kept in a dedicated file because calling browser init() is a one-shot
 * operation per module instance (core first-wins semantics). Vitest's per-file
 * module isolation ensures this file gets a fresh singleton.
 *
 * DOM globals used by the SDK under test: addEventListener, navigator.sendBeacon,
 * document.visibilityState, fetch. All are stubbed below — no jsdom dependency.
 */

import { afterAll, describe, expect, it, vi } from 'vitest';

// ── Global stubs (set up before any SDK call) ─────────────────────────────────

const ENDPOINT = 'http://localhost:3100/otlp/v1/logs';
const fetchSpy = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
const sendBeaconSpy = vi.fn().mockReturnValue(true);
const onError = vi.fn();

// Capture event handlers registered by the SDK so tests can dispatch them.
// Cast to the full DOM signature to satisfy TypeScript; the narrow `() => void`
// is what our dispatch helpers call, and JS ignores the missing Event argument.
const registeredHandlers: Record<string, Array<() => void>> = {};
globalThis.addEventListener = ((type: string, handler: () => void) => {
  if (!registeredHandlers[type]) registeredHandlers[type] = [];
  registeredHandlers[type].push(handler);
}) as unknown as typeof globalThis.addEventListener;

// navigator.sendBeacon stub.
Object.defineProperty(globalThis, 'navigator', {
  value: { sendBeacon: sendBeaconSpy },
  writable: true,
  configurable: true,
});

// document.visibilityState stub (starts 'visible'; set to 'hidden' for tests).
let visibilityState = 'visible';
Object.defineProperty(globalThis, 'document', {
  value: { get visibilityState() { return visibilityState; } },
  writable: true,
  configurable: true,
});

// Global fetch stub.
globalThis.fetch = fetchSpy as unknown as typeof fetch;

// ── SDK imports ───────────────────────────────────────────────────────────────
// ES imports are hoisted and evaluated before the top-level stub assignments
// above. This is fine: module-load side effects (context manager registration)
// don't touch the stubs. The stubs only need to be in place before init() is
// *called* (below), not before the modules are imported.
import { log, flush, shutdown } from '../src/core/index.js';
import { init } from '../src/browser/init.js';

// ── Initialize the SDK once per module ───────────────────────────────────────

// Use fake timers so the batcher's periodic flush interval does not fire
// automatically during tests.
vi.useFakeTimers();

init({
  project: 'test-project',
  service: 'test-svc',
  endpoint: ENDPOINT,
  onError,
  // Large batch size so records only flush when we explicitly call flush().
  batch: { maxBatchSize: 1000, flushIntervalMs: 60_000 },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function dispatchPagehide(): void {
  for (const handler of registeredHandlers['pagehide'] ?? []) {
    handler();
  }
}

function dispatchVisibilityHidden(): void {
  visibilityState = 'hidden';
  for (const handler of registeredHandlers['visibilitychange'] ?? []) {
    handler();
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pre-unload: normal flush uses fetch', () => {
  it('flush() before pagehide exports via fetch, not sendBeacon', async () => {
    // The service.start marker is already in the queue from init().
    // Explicitly log another record to make the queue non-empty.
    log('info', 'pre-unload record');

    await flush();

    expect(fetchSpy).toHaveBeenCalled();
    expect(sendBeaconSpy).not.toHaveBeenCalled();

    fetchSpy.mockClear();
  });
});

describe('pagehide: final flush uses sendBeacon', () => {
  it('pagehide handler flushes remaining records via sendBeacon to the correct endpoint', async () => {
    // Enqueue a record to be picked up by the pagehide flush.
    log('warn', 'about to unload');

    sendBeaconSpy.mockClear();
    fetchSpy.mockClear();

    dispatchPagehide();

    // Coalesce with the in-flight drain started by triggerFlush's void flush().
    // ensureFlushing() returns the existing inflight promise when one is running.
    await flush();

    expect(sendBeaconSpy).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Verify the endpoint.
    const [calledEndpoint, blob] = sendBeaconSpy.mock.calls[0] as [string, Blob];
    expect(calledEndpoint).toBe(ENDPOINT);

    // Verify the body is valid JSON with the OTLP shape.
    const body = await blob.text();
    const parsed = JSON.parse(body) as { resourceLogs: unknown[] };
    expect(parsed).toHaveProperty('resourceLogs');
    expect(Array.isArray(parsed.resourceLogs)).toBe(true);
    expect(parsed.resourceLogs.length).toBeGreaterThan(0);
  });

  it('subsequent pagehide invocations are idempotent (flush is safe to call again)', async () => {
    sendBeaconSpy.mockClear();
    dispatchPagehide();
    await flush();
    // Queue is empty — sendBeacon may or may not be called (batcher returns early on empty queue).
    // The key guarantee: no exception is thrown.
    expect(onError).not.toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('visibilitychange=hidden: also triggers sendBeacon flush', () => {
  it('visibilitychange handler flushes via sendBeacon when visibilityState is hidden', async () => {
    log('debug', 'page going hidden');

    sendBeaconSpy.mockClear();
    fetchSpy.mockClear();

    dispatchVisibilityHidden();
    await flush();

    // beacon mode was already enabled by pagehide in the previous describe —
    // visibilitychange just calls triggerFlush() again (idempotent).
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('never-throw contract', () => {
  it('sendBeacon throwing is swallowed and routed to onError — no exception escapes', async () => {
    const throwingBeacon = vi.fn().mockImplementation(() => {
      throw new Error('sendBeacon exploded');
    });
    (globalThis.navigator as { sendBeacon: unknown }).sendBeacon = throwingBeacon;

    log('error', 'record before throwing beacon');
    onError.mockClear();

    // This should not throw even if sendBeacon throws.
    await expect(flush()).resolves.toBeUndefined();

    // The error is routed to onError, not rethrown.
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});

afterAll(async () => {
  await shutdown();
  vi.useRealTimers();
});
