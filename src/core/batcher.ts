// Bounded batching buffer — sits between `log` and the OTLP exporter.
// Queues records, flushes on size (maxBatchSize) or interval (flushIntervalMs),
// drops oldest under pressure, and keeps a single in-flight export at a time.
//
// Future knobs (deferred):
//   - Per-batch retry with exponential back-off
//   - High-priority lane for service.start markers

import type { LogRecord } from './wire.js';
import type { Exporter } from './exporter.js';

export interface BatcherConfig {
  /** Downstream sink. Must never reject per the Exporter contract. */
  exporter: Exporter;
  /** Flush when queue reaches this length. Default: 512. */
  maxBatchSize?: number;
  /** Periodic flush cadence in milliseconds. Default: 1000. */
  flushIntervalMs?: number;
  /** Hard queue cap; beyond it, oldest records are dropped. Default: 2048. */
  maxQueueSize?: number;
  /**
   * Called with the count of records dropped in a single enqueue call.
   * Do NOT route through the host logger — same loop-avoidance rationale as exporter.onError.
   */
  onDrop?: (count: number) => void;
}

export interface Batcher {
  /** Synchronously append a record. Never throws. Triggers a flush at maxBatchSize. */
  enqueue(record: LogRecord): void;
  /** Force-drain the current queue; resolves after the export attempt settles. */
  flush(): Promise<void>;
  /** Stop the timer, drain remaining records, await any in-flight export. Idempotent. */
  shutdown(): Promise<void>;
}

export function createBatcher(config: BatcherConfig): Batcher {
  const { exporter, onDrop } = config;
  const maxBatchSize = config.maxBatchSize ?? 512;
  const flushIntervalMs = config.flushIntervalMs ?? 1000;
  const maxQueueSize = config.maxQueueSize ?? 2048;

  let queue: LogRecord[] = [];
  let inflight: Promise<void> | null = null;
  let shutdownPromise: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = startTimer();

  // ─── Private helpers ────────────────────────────────────────────────────────

  function startTimer(): ReturnType<typeof setInterval> {
    const handle = setInterval(() => {
      if (queue.length > 0) ensureFlushing();
    }, flushIntervalMs);
    // Prevent the interval from keeping a Node.js process alive after all other
    // work is done. Browser setInterval returns a number (no unref); Node returns
    // a Timeout object with unref — call defensively so core/ stays isomorphic.
    (handle as { unref?: () => void }).unref?.();
    return handle;
  }

  /** Snapshot the queue and dispatch a single export. Swallows errors defensively. */
  function exportOnce(): Promise<void> {
    if (queue.length === 0) return Promise.resolve();
    const batch = queue.splice(0);
    return exporter.export(batch).catch(() => {
      // Exporter is contractually never-reject; swallow here as a second line of defense.
    });
  }

  /**
   * Ensure a drain loop is running. If one is already in-flight, return its promise so
   * callers coalesce rather than spawning a concurrent export. The loop keeps running
   * while the queue is non-empty, so records enqueued during an export are picked up
   * in the next iteration without ever overlapping exports.
   */
  function ensureFlushing(): Promise<void> {
    if (inflight !== null) return inflight;
    if (queue.length === 0) return Promise.resolve();

    const drain = async (): Promise<void> => {
      while (queue.length > 0) {
        await exportOnce();
      }
    };

    inflight = drain().finally(() => {
      inflight = null;
    });

    return inflight;
  }

  // ─── Public interface ────────────────────────────────────────────────────────

  return {
    enqueue(record: LogRecord): void {
      // Drop from the front (oldest) when the queue is at capacity.
      if (queue.length >= maxQueueSize) {
        const count = queue.length - maxQueueSize + 1;
        queue.splice(0, count);
        onDrop?.(count);
      }
      queue.push(record);

      if (queue.length >= maxBatchSize) {
        ensureFlushing(); // fire-and-forget; never awaited inside enqueue
      }
    },

    flush(): Promise<void> {
      return ensureFlushing();
    },

    shutdown(): Promise<void> {
      if (shutdownPromise !== null) return shutdownPromise;

      shutdownPromise = (async (): Promise<void> => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
        await ensureFlushing();
      })();

      return shutdownPromise;
    },
  };
}
