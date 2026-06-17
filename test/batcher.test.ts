import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBatcher } from '../src/core/index.js';
import type { Batcher, Exporter, LogRecord } from '../src/core/index.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRecord(msg = 'test'): LogRecord {
  return {
    timeUnixNano: '0',
    severityNumber: 9,
    severityText: 'INFO',
    body: { stringValue: msg },
    attributes: [],
  };
}

function makeExporter(): { export: ReturnType<typeof vi.fn> } & Exporter {
  return { export: vi.fn().mockResolvedValue(undefined) };
}

// ─── createBatcher ───────────────────────────────────────────────────────────

describe('createBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Size trigger ─────────────────────────────────────────────────────────

  it('flushes automatically when queue reaches maxBatchSize', async () => {
    const exporter = makeExporter();
    const batcher = createBatcher({ exporter, maxBatchSize: 3, flushIntervalMs: 10_000 });

    batcher.enqueue(makeRecord('a'));
    batcher.enqueue(makeRecord('b'));

    // Not yet at maxBatchSize — no flush started
    expect(exporter.export).not.toHaveBeenCalled();

    // Third record hits maxBatchSize and triggers ensureFlushing synchronously
    batcher.enqueue(makeRecord('c'));

    // drain() has started and called exporter.export with the snapshot
    expect(exporter.export).toHaveBeenCalledOnce();
    const batch = exporter.export.mock.calls[0][0] as LogRecord[];
    expect(batch).toHaveLength(3);
    expect(batch.map(r => (r.body as { stringValue: string }).stringValue)).toEqual(['a', 'b', 'c']);

    await batcher.shutdown();
  });

  // ── Time trigger ──────────────────────────────────────────────────────────

  it('flushes on interval when queue is non-empty', async () => {
    const exporter = makeExporter();
    const batcher = createBatcher({ exporter, maxBatchSize: 100, flushIntervalMs: 1000 });

    batcher.enqueue(makeRecord('a'));
    batcher.enqueue(makeRecord('b'));

    expect(exporter.export).not.toHaveBeenCalled();

    // Advance fake timer past the flush interval; also flushes microtasks
    await vi.advanceTimersByTimeAsync(1000);

    expect(exporter.export).toHaveBeenCalledOnce();
    expect((exporter.export.mock.calls[0][0] as LogRecord[])).toHaveLength(2);

    await batcher.shutdown();
  });

  it('timer does not flush when queue is empty', async () => {
    const exporter = makeExporter();
    const batcher = createBatcher({ exporter, maxBatchSize: 100, flushIntervalMs: 1000 });

    // No enqueues — advance through several intervals
    await vi.advanceTimersByTimeAsync(5000);

    expect(exporter.export).not.toHaveBeenCalled();

    await batcher.shutdown();
  });

  // ── Bounded buffer + drop-oldest ─────────────────────────────────────────

  it('drops oldest records when queue exceeds maxQueueSize', async () => {
    let resolveFirst!: () => void;
    const pendingExport = new Promise<void>(r => { resolveFirst = r; });

    const mockExport = vi.fn<(records: LogRecord[]) => Promise<void>>()
      .mockReturnValueOnce(pendingExport)
      .mockResolvedValue(undefined);

    const onDrop = vi.fn();
    const batcher = createBatcher({
      exporter: { export: mockExport },
      maxBatchSize: 100,
      maxQueueSize: 3,
      flushIntervalMs: 10_000,
      onDrop,
    });

    // Enqueue 3 records and flush — drain starts, exporter called, queue cleared
    batcher.enqueue(makeRecord('a'));
    batcher.enqueue(makeRecord('b'));
    batcher.enqueue(makeRecord('c'));
    const flushPromise = batcher.flush();

    // drain() called exporter.export synchronously with [a, b, c]
    expect(mockExport).toHaveBeenCalledOnce();

    // Enqueue more while the first export is in-flight
    batcher.enqueue(makeRecord('d')); // queue: [d]
    batcher.enqueue(makeRecord('e')); // queue: [d, e]
    batcher.enqueue(makeRecord('f')); // queue: [d, e, f] — at maxQueueSize
    batcher.enqueue(makeRecord('g')); // would be 4 → drop 'd'; queue: [e, f, g]

    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledWith(1);
    expect(mockExport).toHaveBeenCalledOnce(); // still only the one in-flight export

    // Resolve the first export; drain loop picks up [e, f, g]
    resolveFirst();
    await flushPromise;

    expect(mockExport).toHaveBeenCalledTimes(2);
    const second = mockExport.mock.calls[1][0] as LogRecord[];
    expect(second.map(r => (r.body as { stringValue: string }).stringValue)).toEqual(['e', 'f', 'g']);
  });

  it('onDrop receives the count of records dropped in a single enqueue call', () => {
    const onDrop = vi.fn();
    const batcher = createBatcher({
      exporter: makeExporter(),
      maxBatchSize: 100,
      maxQueueSize: 2,
      flushIntervalMs: 10_000,
      onDrop,
    });

    // Fill to maxQueueSize
    batcher.enqueue(makeRecord('a'));
    batcher.enqueue(makeRecord('b'));

    // Next enqueue must drop 1 to make room
    batcher.enqueue(makeRecord('c'));

    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledWith(1);
  });

  // ── Single in-flight export ───────────────────────────────────────────────

  it('does not call exporter concurrently; exports again after queue refills', async () => {
    let resolveFirst!: () => void;
    const firstExport = new Promise<void>(r => { resolveFirst = r; });

    const mockExport = vi.fn<(records: LogRecord[]) => Promise<void>>()
      .mockReturnValueOnce(firstExport)
      .mockResolvedValue(undefined);

    const batcher = createBatcher({
      exporter: { export: mockExport },
      maxBatchSize: 100,
      flushIntervalMs: 10_000,
    });

    batcher.enqueue(makeRecord('a'));
    batcher.enqueue(makeRecord('b'));

    const flushPromise = batcher.flush(); // starts drain; exports [a, b]

    expect(mockExport).toHaveBeenCalledOnce();

    // Enqueue more while first export is pending
    batcher.enqueue(makeRecord('c'));
    batcher.enqueue(makeRecord('d'));

    // Trigger flush again — must return the existing inflight, not a new export
    batcher.flush();
    batcher.flush();

    expect(mockExport).toHaveBeenCalledOnce(); // still only 1 concurrent export

    // Resolve the first export; drain loop immediately exports [c, d]
    resolveFirst();
    await flushPromise;

    expect(mockExport).toHaveBeenCalledTimes(2);
    const second = mockExport.mock.calls[1][0] as LogRecord[];
    expect(second.map(r => (r.body as { stringValue: string }).stringValue)).toEqual(['c', 'd']);
  });

  // ── flush() ───────────────────────────────────────────────────────────────

  it('flush() drains the current queue on demand', async () => {
    const exporter = makeExporter();
    const batcher = createBatcher({ exporter, maxBatchSize: 100, flushIntervalMs: 10_000 });

    batcher.enqueue(makeRecord('a'));
    batcher.enqueue(makeRecord('b'));

    expect(exporter.export).not.toHaveBeenCalled();

    await batcher.flush();

    expect(exporter.export).toHaveBeenCalledOnce();
    expect((exporter.export.mock.calls[0][0] as LogRecord[])).toHaveLength(2);

    await batcher.shutdown();
  });

  it('flush() resolves immediately when the queue is empty', async () => {
    const exporter = makeExporter();
    const batcher = createBatcher({ exporter, maxBatchSize: 100, flushIntervalMs: 10_000 });

    await expect(batcher.flush()).resolves.toBeUndefined();

    expect(exporter.export).not.toHaveBeenCalled();

    await batcher.shutdown();
  });

  // ── shutdown() ────────────────────────────────────────────────────────────

  it('shutdown() drains remaining records and stops the timer', async () => {
    const exporter = makeExporter();
    const batcher = createBatcher({ exporter, maxBatchSize: 100, flushIntervalMs: 1000 });

    batcher.enqueue(makeRecord('a'));

    await batcher.shutdown();

    expect(exporter.export).toHaveBeenCalledOnce();
    expect((exporter.export.mock.calls[0][0] as LogRecord[])).toHaveLength(1);

    // Timer is cleared — advancing through several intervals must not trigger more exports
    await vi.advanceTimersByTimeAsync(5000);

    expect(exporter.export).toHaveBeenCalledOnce();
  });

  it('shutdown() awaits an in-flight export before resolving', async () => {
    let resolveExport!: () => void;
    const pendingExport = new Promise<void>(r => { resolveExport = r; });

    const mockExport = vi.fn<(records: LogRecord[]) => Promise<void>>()
      .mockReturnValueOnce(pendingExport)
      .mockResolvedValue(undefined);

    const batcher = createBatcher({
      exporter: { export: mockExport },
      maxBatchSize: 1, // triggers flush on first enqueue
      flushIntervalMs: 10_000,
    });

    batcher.enqueue(makeRecord('a')); // triggers flush immediately
    expect(mockExport).toHaveBeenCalledOnce();

    let shutdownResolved = false;
    const shutdownPromise = batcher.shutdown().then(() => { shutdownResolved = true; });

    // Not yet resolved while export is still pending
    await Promise.resolve();
    expect(shutdownResolved).toBe(false);

    resolveExport();
    await shutdownPromise;

    expect(shutdownResolved).toBe(true);
  });

  it('shutdown() is idempotent — safe to call twice', async () => {
    const exporter = makeExporter();
    const batcher = createBatcher({ exporter, maxBatchSize: 100, flushIntervalMs: 10_000 });

    batcher.enqueue(makeRecord('a'));

    const p1 = batcher.shutdown();
    const p2 = batcher.shutdown();

    expect(p1).toBe(p2); // same promise returned

    await p1;

    expect(exporter.export).toHaveBeenCalledOnce();
  });

  // ── Never throws ──────────────────────────────────────────────────────────

  it('enqueue does not throw even when the exporter rejects', async () => {
    const mockExport = vi.fn<(records: LogRecord[]) => Promise<void>>().mockRejectedValue(new Error('export error'));

    const batcher: Batcher = createBatcher({
      exporter: { export: mockExport },
      maxBatchSize: 1, // size trigger fires on first enqueue
      flushIntervalMs: 10_000,
    });

    // Must not throw synchronously
    expect(() => batcher.enqueue(makeRecord())).not.toThrow();

    // flush() should still resolve (error is swallowed inside exportOnce)
    await expect(batcher.flush()).resolves.toBeUndefined();

    // Subsequent enqueue also must not throw
    expect(() => batcher.enqueue(makeRecord())).not.toThrow();

    await batcher.shutdown();
  });
});
