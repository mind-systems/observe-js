/**
 * OTLP wire conformance tests (Node).
 *
 * Proves that observe-js serializes exactly what observe-contract@v0.1.2 pins:
 * field-for-field equality against golden-record.json, fixtures/service-start.json,
 * and levels.json — with no live backend. Uses the .node.test.ts suffix because
 * the Node ContextManager is registered as a side effect of importing the Node
 * entry (matching context.node.test.ts and winston.node.test.ts conventions).
 */

// Side effect: registers the Node ContextManager via setContextManager().
import '../src/node/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { init, log, flush, LEVELS, severityFor } from '../src/core/index.js';
import { extract, objectCarrier, runWithContext } from '../src/node/index.js';

import goldenRecordFixture from '../contract/golden-record.json';
import serviceStartFixture from '../contract/fixtures/service-start.json';
import levelsData from '../contract/levels.json';

// ─── Captured POST bodies ──────────────────────────────────────────────────────

const capturedBodies: string[] = [];

/** Parse the Nth captured POST body to an object. */
const parsed = (i: number) => JSON.parse(capturedBodies[i] as string);

// ─── Deterministic setup / teardown ───────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1718632800000);

  // Stub the whole crypto global — vi.spyOn would throw on Node 18.15.0 (vitest VM)
  // because globalThis.crypto is undefined there. vi.stubGlobal *defines* the global
  // when absent, routing resource.ts down the randomUUID branch and producing the
  // fixed service.instance.id that matches the contract fixtures.
  vi.stubGlobal('crypto', { randomUUID: () => '0b9d7a3e-5f2c-4c1a-9e7d-3a6b8c1f2e4d' });

  // Capture every POST body. The exporter reads only response.status; 200 is accepted.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, opts: RequestInit) => {
      capturedBodies.push(opts.body as string);
      return new Response(null, { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  capturedBodies.length = 0;
});

// ─── OTLP wire conformance ────────────────────────────────────────────────────

describe('OTLP wire conformance', () => {
  /**
   * Single ordered test — both captures happen here so the marker-before-record
   * sequencing is explicit and the test is self-contained. If split into separate
   * it() blocks, init's marker and the log record would drain into one two-record
   * POST and fail toEqual against the single-record fixtures.
   */
  it('serializes service.start and a log record byte-for-byte', async () => {
    // ── service.start marker ─────────────────────────────────────────────────
    init({ project: 'example-project', service: 'example-service', endpoint: 'http://localhost:3100/otlp/v1/logs' });
    await flush();

    expect(parsed(0)).toEqual(serviceStartFixture);

    // ── canonical log record ─────────────────────────────────────────────────
    // Do NOT re-init — this is a singleton; a second init() is a no-op.
    // Reconstruct the W3C traceparent from the contract's canonical example.
    const ctx = extract(objectCarrier({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' }));
    expect(ctx).toBeDefined();

    runWithContext(ctx!, () => log('info', 'order placed', { 'order.id': 'A-1024' }));
    await flush();

    expect(parsed(1)).toEqual(goldenRecordFixture);
  });
});

// ─── Level table conformance ──────────────────────────────────────────────────

describe('level table conformance', () => {
  const contractLevels = levelsData.levels as Record<string, { severityNumber: number; severityText: string }>;

  it('contract version is pinned to v0.1.2', () => {
    // Soft pin on the JSON version field: a submodule at a different tag that still
    // carries version "0.1.2" would not be caught, but the baked-in fixture values
    // (timestamps, ids) would diverge and fail the wire-conformance test above.
    expect(levelsData.version).toBe('0.1.2');
  });

  it('key set matches contract exactly (no missing, no extra)', () => {
    expect(Object.keys(LEVELS).sort()).toEqual(Object.keys(contractLevels).sort());
  });

  it.each(
    Object.entries(contractLevels).map(([k, v]) => [k, v.severityNumber, v.severityText] as const),
  )('%s → severityNumber %i, severityText %s', (levelKey, severityNumber, severityText) => {
    const level = levelKey as keyof typeof LEVELS;

    // LEVELS table
    expect(LEVELS[level].severityNumber).toBe(severityNumber);
    expect(LEVELS[level].severityText).toBe(severityText);

    // severityFor accessor returns the same values
    const result = severityFor(level);
    expect(result.severityNumber).toBe(severityNumber);
    expect(result.severityText).toBe(severityText);
  });
});
