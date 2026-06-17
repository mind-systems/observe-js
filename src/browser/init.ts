// Browser lifecycle glue — beacon-capable exporter, browser init wrapper, and
// unload flush registration.
// Imports from core only (and sibling context.js for registration ordering);
// never imports from node/.

import type { Exporter } from '../core/index.js';
import type { InitOptions } from '../core/index.js';
import { buildResource, createExporter, encodeLogs, flush, init as coreInit } from '../core/index.js';
import type { LogRecord, Resource } from '../core/index.js';

// Named import (not bare) so the module survives the package-level `sideEffects:false`
// annotation and esbuild keeps the registration side effect alive.
// `browser/index.ts` also re-exports `browserContextManager` for tree-shaking safety.
import { browserContextManager as _ctx } from './context.js';
void _ctx;

// ── Beacon-capable exporter ───────────────────────────────────────────────────

interface BeaconExporterResult {
  exporter: Exporter;
  /** Switch the exporter to beacon mode for the final unload flush. One-way. */
  enableBeacon(): void;
}

/**
 * Create an exporter that normally uses fetch but can be switched to
 * navigator.sendBeacon for the final page-unload flush.
 *
 * Normal (pre-unload) exports go through the standard fetch path, so HTTP
 * response codes and retries work as usual. Only the final flush (triggered by
 * pagehide / visibilitychange=hidden) uses sendBeacon so the UA can deliver
 * the payload after the page is torn down.
 */
export function createBeaconExporter(config: {
  endpoint: string;
  resource: Resource;
  onError?: (err: unknown) => void;
}): BeaconExporterResult {
  const { endpoint, resource, onError } = config;
  const fetchExporter = createExporter({ endpoint, resource, onError });

  let beaconMode = false;

  const exporter: Exporter = {
    async export(records: LogRecord[]): Promise<void> {
      if (
        beaconMode &&
        typeof navigator !== 'undefined' &&
        typeof navigator.sendBeacon === 'function'
      ) {
        try {
          const body = JSON.stringify(encodeLogs(resource, records));
          const blob = new Blob([body], { type: 'application/json' });
          // sendBeacon MUST be called synchronously here — no await before this line.
          // During page unload the UA only guarantees delivery for beacon calls
          // made synchronously inside the event handler; an await before sendBeacon
          // schedules it as a microtask that may never run after teardown.
          const queued = navigator.sendBeacon(endpoint, blob);
          if (!queued) {
            onError?.(new Error('observe-js: sendBeacon rejected payload (payload may exceed size limit)'));
          }
        } catch (err) {
          // Never throw — route failures to onError, matching the Exporter contract.
          onError?.(err);
        }
        return;
      }

      // Normal path: delegate to the fetch-based exporter.
      return fetchExporter.export(records);
    },
  };

  return {
    exporter,
    enableBeacon(): void {
      beaconMode = true;
    },
  };
}

// ── Browser init wrapper ──────────────────────────────────────────────────────

// Module-level guard mirrors core's first-wins policy and prevents duplicate
// unload handlers and orphaned exporter closures on a second init() call.
let _installed = false;

/**
 * Initialize the SDK for a browser environment.
 *
 * Wraps the core `init` with:
 * - Resource construction + beacon exporter creation.
 * - Unload flush registration (pagehide + visibilitychange=hidden) that
 *   switches to sendBeacon and drains buffered records before page teardown.
 *
 * The `service.start` restart marker is emitted by core init — do not emit it
 * here.
 *
 * First-wins: a second call is a no-op; the duplicate is reported via onError
 * and no additional event listeners or exporters are created.
 */
export function init(opts: InitOptions): void {
  if (_installed) {
    opts.onError?.(new Error('observe-js: init() called more than once; ignoring.'));
    return;
  }
  _installed = true;

  const resource = buildResource(opts.project, opts.service);
  const { exporter, enableBeacon } = createBeaconExporter({
    endpoint: opts.endpoint,
    resource,
    onError: opts.onError,
  });

  // Pass the beacon exporter to core so it owns the batcher.
  coreInit({ ...opts, exporter });

  // ── Unload flush ────────────────────────────────────────────────────────────
  // Register both pagehide and visibilitychange=hidden so the flush fires on
  // mobile (where pagehide is unreliable) as well as on desktop. Both handlers
  // are idempotent: enableBeacon() is a one-way flag and flush() is safe to
  // call multiple times.

  if (typeof addEventListener !== 'function') return;

  let flushTriggered = false;

  function triggerFlush(): void {
    if (!flushTriggered) {
      flushTriggered = true;
      enableBeacon();
    }
    // Always call flush — even after the flag, in case new records arrived
    // between the first trigger and the current one.
    void flush();
  }

  addEventListener('pagehide', triggerFlush);

  addEventListener('visibilitychange', () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      triggerFlush();
    }
  });
}
