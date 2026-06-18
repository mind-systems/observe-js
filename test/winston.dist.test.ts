/**
 * Cross-bundle singleton regression — built dist/ artifacts.
 *
 * Loads `init`/`flush` from the node entry and `ObserveTransport` from the
 * winston entry by their absolute dist/ paths, reproducing the consumer path
 * where `dist/winston.{cjs,mjs}` internally resolves `observe-js` through the
 * package self-reference to the same module instance the host loaded.
 *
 * The test intentionally imports from dist/, never from source — source runs
 * core as a single in-process module and cannot reproduce the dual-bundle
 * duplicate that caused the original bug. `npm test` runs `npm run build`
 * first, so dist/ is present before this test executes.
 *
 * The original bug: `dist/winston.{cjs,mjs}` inlined its own copy of core,
 * giving `ObserveTransport` a duplicate `_initialized = false` singleton that
 * was never initialised. The `service.start` marker was enqueued on the host's
 * SDK instance (correct), but every subsequent `logger.info(...)` was silently
 * dropped by the transport's private, never-init'd copy.
 *
 * The fix: `external: ['observe-js']` in the winston tsup config makes the
 * bundle emit a bare `require('observe-js')` / `import 'observe-js'`, which
 * Node resolves at runtime via the package self-reference to the same
 * `dist/node.{cjs,mjs}` the host loaded — one shared `_batcher`.
 *
 * Assertion: an ordinary `logger.info(...)` line — not only the `service.start`
 * marker — reaches the OTLP exporter's `fetch` call.
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import winston from 'winston';
import type Transport from 'winston-transport';

const root = resolve(process.cwd());
const ENDPOINT = 'http://localhost:3100/otlp/v1/logs';

// ── Fetch stub ────────────────────────────────────────────────────────────────

/**
 * Replace globalThis.fetch with a spy that collects every request body string.
 * Must be installed before `init()` — the exporter captures no state at
 * construction beyond the endpoint, so the stub is live by the time export runs.
 * Returns the collected bodies array and a restore callback.
 */
function stubFetch(): { bodies: string[]; restore: () => void } {
  const bodies: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    bodies.push(typeof body === 'string' ? body : '');
    return new Response('', { status: 200 });
  };
  return { bodies, restore: () => { globalThis.fetch = original; } };
}

/** Resolves when the transport emits its 'logged' event. */
function onLogged(logger: winston.Logger): Promise<void> {
  return new Promise<void>((res) => {
    (logger.transports[0] as Transport).once('logged', res);
  });
}

// ── CJS pair ──────────────────────────────────────────────────────────────────

describe('cross-bundle singleton — CJS pair (dist/node.cjs ↔ dist/winston.cjs)', () => {
  it('an ordinary logger.info() line reaches the OTLP exporter, not only service.start', async () => {
    // createRequire loads both entries into the same Node require-cache. When
    // dist/winston.cjs does require('observe-js') internally, Node resolves the
    // package self-reference to dist/node.cjs — the same cache entry already
    // loaded here, so the two share one _initialized/_batcher.
    const cjsRequire = createRequire(import.meta.url);

    const node = cjsRequire(resolve(root, 'dist/node.cjs')) as {
      init: (opts: { project: string; service: string; endpoint: string }) => void;
      flush: () => Promise<void>;
    };

    const { ObserveTransport } = cjsRequire(resolve(root, 'dist/winston.cjs')) as {
      ObserveTransport: new () => Transport;
    };

    const { bodies, restore } = stubFetch();
    try {
      node.init({ project: 'test', service: 'cjs-singleton', endpoint: ENDPOINT });

      const logger = winston.createLogger({ transports: [new ObserveTransport()] });

      const logged = onLogged(logger);
      logger.info('a plain line');
      await logged;

      await node.flush();

      expect(bodies.join('\n')).toContain('a plain line');
    } finally {
      restore();
    }
  });
});

// ── ESM pair ──────────────────────────────────────────────────────────────────

describe('cross-bundle singleton — ESM pair (dist/node.mjs ↔ dist/winston.mjs)', () => {
  // Note: dist/node.mjs and dist/node.cjs are distinct module instances (separate
  // Node module systems), so the CJS test's init() does not affect this pair.
  it('an ordinary logger.info() line reaches the OTLP exporter, not only service.start', async () => {
    // Dynamic import() uses the ESM registry keyed by resolved URL. When
    // dist/winston.mjs does import 'observe-js' internally, Node resolves the
    // package self-reference exports map to dist/node.mjs — the same URL already
    // in the registry, so the two share one _initialized/_batcher.
    const node = (await import(resolve(root, 'dist/node.mjs'))) as {
      init: (opts: { project: string; service: string; endpoint: string }) => void;
      flush: () => Promise<void>;
    };

    const { ObserveTransport } = (await import(resolve(root, 'dist/winston.mjs'))) as {
      ObserveTransport: new () => Transport;
    };

    const { bodies, restore } = stubFetch();
    try {
      node.init({ project: 'test', service: 'esm-singleton', endpoint: ENDPOINT });

      const logger = winston.createLogger({ transports: [new ObserveTransport()] });

      const logged = onLogged(logger);
      logger.info('a plain line');
      await logged;

      await node.flush();

      expect(bodies.join('\n')).toContain('a plain line');
    } finally {
      restore();
    }
  });
});
