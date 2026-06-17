# 04 — Bounded batching buffer

**Task:** ROADMAP → Core → "Bounded batching buffer"
**Contract:** `observe-contract@v0.1.2` (Cross-cutting invariants → never break the host, bounded buffer)
**Depth:** full — buffer/flush defaults and drop policy are design decisions the contract only constrains ("bounded buffer, drop/buffer, never throw").

## Goal

Sit between `log` and the exporter: accumulate records, flush on size or time, and stay bounded so a slow/down backend can never grow memory without limit or block the caller.

## Design (recommended signatures + defaults)

```ts
interface BatcherConfig {
  maxBatchSize?: number     // flush when queue reaches this — default 512
  flushIntervalMs?: number  // periodic flush — default 1000
  maxQueueSize?: number     // hard cap — default 2048; beyond it, drop oldest
}
class Batcher {
  enqueue(record: LogRecord): void   // sync, non-blocking, never throws
  flush(): Promise<void>             // force-drain now (used by shutdown + tests)
  shutdown(): Promise<void>          // stop timer, final flush
}
```

- **Triggers:** flush when `queue.length >= maxBatchSize`, or every `flushIntervalMs`, or on `flush()`/`shutdown()`.
- **Bounded + drop-oldest:** when `enqueue` would exceed `maxQueueSize`, drop from the front (oldest) and bump a `dropped` counter (surfaced via the exporter's `onError`/a diagnostics hook). Never block, never throw.
- **Single in-flight export:** at most one `export()` outstanding; if a flush trigger fires while one is running, coalesce — don't overlap. Re-flush after it settles if the queue refilled.
- **Timer:** `setInterval`/`setTimeout`; in Node use `.unref()` so it never keeps the process alive.

## Edge cases / watch

- Drop-oldest vs drop-newest: oldest is correct here — keep the freshest debug context.
- `shutdown` must await the final in-flight export then drain remaining (best-effort, respecting timeout).
- Reentrancy: `enqueue` called from within a flush callback must not deadlock — keep enqueue purely synchronous queue-append.

## Out of scope

The actual HTTP POST (task 03). Retry/backoff (deferred with the exporter).

## Done when

Tests prove: size-trigger and time-trigger both flush; exceeding `maxQueueSize` drops oldest and counts it; only one export runs at a time; `shutdown` drains.
