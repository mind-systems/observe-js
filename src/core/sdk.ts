// Public API: init + log
// Wires together resource attributes, exporter, batcher, and ambient context
// behind two minimal entry points used by host logging sinks and adapters.
//
// Lifecycle:
//   - Call `init(opts)` once at bootstrap before any `log()` calls.
//   - A second `init` is a no-op (first wins); a diagnostic is sent to onError.
//   - `log()` before `init()` drops silently with a diagnostic to onError.
//   - The transport owns only forwarding; the host is responsible for init.

import type { Batcher, BatcherConfig } from './batcher.js';
import { createBatcher } from './batcher.js';
import type { Exporter } from './exporter.js';
import { createExporter } from './exporter.js';
import { getActiveContext } from './context.js';
import type { Level } from './levels.js';
import { severityFor } from './levels.js';
import { buildResource } from './resource.js';
import type { AnyValue, KeyValue, LogRecord } from './wire.js';
import { kv, stringValue } from './wire.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface InitOptions {
  /** Identifies the product/project (e.g. "tradeoxy", "mind"). Low-cardinality. */
  project: string;
  /** Identifies the service within the project (e.g. "broker", "api"). */
  service: string;
  /** Full OTLP logs endpoint URL, e.g. `http://localhost:3100/otlp/v1/logs`. */
  endpoint: string;
  /** Optional batcher tunables. The exporter is wired internally. */
  batch?: Partial<Omit<BatcherConfig, 'exporter'>>;
  /**
   * Called on SDK-level errors (double-init, pre-init drops, export failures).
   * Do NOT route this through the host logger — that would create a log loop.
   */
  onError?: (err: unknown) => void;
  /**
   * Pluggable exporter for platform-specific transport (e.g. the browser beacon
   * exporter). When provided, this exporter is used directly and `buildResource`
   * + `createExporter` are skipped — the caller is responsible for constructing
   * the exporter with the correct resource and endpoint.
   * When absent, the default `fetch`-based OTLP exporter is created internally.
   */
  exporter?: Exporter;
}

// ── Module-level singleton ────────────────────────────────────────────────────

let _batcher: Batcher | null = null;
let _onError: ((err: unknown) => void) | undefined;
let _initialized = false;

// ── Internal helpers ──────────────────────────────────────────────────────────

function nowNanoString(): string {
  // Date.now() returns milliseconds; BigInt avoids float precision loss at ns.
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

function anyValueOf(v: unknown): AnyValue {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  return { stringValue: String(v) };
}

function attrsToKv(attrs: Record<string, unknown>, skip: string[]): KeyValue[] {
  const result: KeyValue[] = [];
  for (const key of Object.keys(attrs)) {
    if (skip.includes(key)) continue;
    result.push(kv(key, anyValueOf(attrs[key])));
  }
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialize the SDK. Call once at application startup.
 *
 * Constructs the exporter and batcher, then immediately emits the
 * `service.start` restart marker so "everything since last restart" is
 * queryable by finding records after the latest marker for the service.
 *
 * A second call is a no-op (first wins); the duplicate is reported via onError.
 */
export function init(opts: InitOptions): void {
  if (_initialized) {
    opts.onError?.(new Error('observe-js: init() called more than once; ignoring.'));
    return;
  }

  _onError = opts.onError;

  // Use the provided exporter when supplied (e.g. browser beacon exporter);
  // otherwise build the default fetch-based OTLP exporter with a fresh resource.
  const exporter: Exporter = opts.exporter
    ? opts.exporter
    : createExporter({
        endpoint: opts.endpoint,
        resource: buildResource(opts.project, opts.service),
        onError: opts.onError,
      });
  _batcher = createBatcher({ exporter, ...opts.batch });
  _initialized = true;

  // Emit the service.start marker per the contract fixture (fixtures/service-start.json).
  const now = nowNanoString();
  const marker: LogRecord = {
    timeUnixNano: now,
    observedTimeUnixNano: now,
    severityNumber: 9, // INFO
    severityText: 'INFO',
    eventName: 'service.start',
    body: stringValue('service.start'),
    attributes: [
      kv('level', stringValue('info')),
      kv('event.name', stringValue('service.start')),
    ],
  };
  _batcher.enqueue(marker);
}

/**
 * Emit a log record. The host's logging sink calls this once per log line.
 *
 * Reserved attributes: the SDK always writes `level`; if `attrs` contains a
 * `level` key the SDK value wins (the caller-supplied key is silently dropped).
 *
 * Never throws. Records emitted before `init` are dropped silently with a
 * diagnostic sent to the `onError` handler configured at init time.
 */
export function log(level: Level, msg: string, attrs?: Record<string, unknown>): void {
  if (!_initialized || _batcher === null) {
    _onError?.(new Error('observe-js: log() called before init(); record dropped.'));
    return;
  }

  try {
    const { severityNumber, severityText } = severityFor(level);
    const now = nowNanoString();

    // SDK-owned `level` attribute is placed first; user attrs follow.
    const attributes: KeyValue[] = [kv('level', stringValue(level))];
    if (attrs) {
      attributes.push(...attrsToKv(attrs, ['level']));
    }

    const record: LogRecord = {
      timeUnixNano: now,
      observedTimeUnixNano: now,
      severityNumber,
      severityText,
      body: stringValue(String(msg)),
      attributes,
    };

    // Stamp the active trace/span context when one exists.
    const ctx = getActiveContext();
    if (ctx !== undefined) {
      record.traceId = ctx.traceId;
      record.spanId = ctx.spanId;
      record.flags = ctx.traceFlags;
    }

    _batcher.enqueue(record);
  } catch {
    _onError?.(new Error('observe-js: unexpected error in log(); record dropped.'));
  }
}

/**
 * Force-drain the current record queue. Safe to call before `init` (resolves
 * immediately as a no-op). Never throws.
 */
export function flush(): Promise<void> {
  return _batcher?.flush() ?? Promise.resolve();
}

/**
 * Stop the periodic flush timer, drain remaining records, and await any
 * in-flight export. Idempotent — repeated calls are safe. Safe to call before
 * `init` (resolves immediately as a no-op). Never throws.
 */
export function shutdown(): Promise<void> {
  return _batcher?.shutdown() ?? Promise.resolve();
}
