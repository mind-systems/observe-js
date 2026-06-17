# Plan: Bounded batching buffer

## Context
Insert a bounded, batching buffer between `log` and the OTLP exporter so a slow or unreachable backend can never grow memory without limit or block the caller: queue records, flush on size + interval, drop oldest under pressure, keep a single in-flight export, and expose explicit `flush()`/`shutdown()`.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Batcher implementation

- [x] **Task 1: Implement the bounded batching `Batcher`**
  Files: `src/core/batcher.ts`
  Create a new platform-neutral module `core/batcher.ts` that wraps an `Exporter` (from `core/exporter.ts`). Follow the existing `createExporter` factory style (a `create*` function returning an object literal, header comment describing intent + deferred knobs).
  - Define `BatcherConfig`:
    - `exporter: Exporter` — the downstream sink.
    - `maxBatchSize?: number` — flush when `queue.length >= maxBatchSize`. Default `512`.
    - `flushIntervalMs?: number` — periodic flush cadence. Default `1000`.
    - `maxQueueSize?: number` — hard cap; beyond it drop oldest. Default `2048`.
    - `onDrop?: (count: number) => void` — diagnostics hook invoked when records are dropped (do NOT route through the host logger — same loop-avoidance rationale as `exporter.onError`).
  - Define and return a `Batcher` interface with:
    - `enqueue(record: LogRecord): void` — purely synchronous queue append, non-blocking, never throws. If appending would exceed `maxQueueSize`, drop from the FRONT (oldest), bump a `dropped` counter, and call `onDrop` with the number dropped this call. If `queue.length >= maxBatchSize` after append, trigger a flush (fire-and-forget, do not await inside `enqueue`).
    - `flush(): Promise<void>` — force-drain the current queue now; resolves after the export attempt settles.
    - `shutdown(): Promise<void>` — stop the timer, perform a final drain, await any in-flight export. Idempotent.
  - Single in-flight export: track a `flushing` flag / current promise. If a flush trigger fires while an export is running, do NOT overlap — coalesce. After the in-flight export settles, if the queue refilled (or a flush was requested meanwhile), flush again until the queue is empty.
  - Timer: start a `setInterval` (or self-rescheduling `setTimeout`) at `flushIntervalMs` that flushes when the queue is non-empty. The timer handle must be guarded for the Node `.unref()` case in Task 2 — keep the timer creation in one private helper so the platform-neutral core stays free of Node-only assumptions (call `.unref?.()` defensively only if present).
  - Reentrancy: a record enqueued from within a flush/export callback must not deadlock — `enqueue` only appends and maybe schedules; it never awaits.

- [x] **Task 2: Make the interval timer non-process-blocking**
  Files: `src/core/batcher.ts`
  Ensure the periodic timer never keeps a Node process alive: after creating the interval, call `.unref?.()` on the returned handle behind a feature check (browser `setInterval` returns a number with no `unref`, Node returns a `Timeout` object with `unref`). This keeps `core/` isomorphic — no `import` of `node:timers`. Keep this logic inside the private timer helper from Task 1.

### Phase 2: Wire-up

- [x] **Task 3: Export the batcher from the core barrel** (depends on Task 1)
  Files: `src/core/index.ts`
  Add `export type { Batcher, BatcherConfig } from './batcher.js';` and `export { createBatcher } from './batcher.js';`, following the existing exporter export block and `.js` extension convention.

### Phase 3: Tests

- [x] **Task 4: Unit tests for the batcher** (depends on Task 1, Task 3)
  Files: `test/batcher.test.ts`
  Mirror the structure of `test/exporter.test.ts` (vitest, `vi.fn()` mock exporter, fake timers via `vi.useFakeTimers()`). Use a fake `Exporter` whose `export` is a `vi.fn()` returning a controllable promise. Cover the spec's "done when":
  - **Size trigger:** enqueuing `maxBatchSize` records flushes automatically; the exporter receives exactly those records in order.
  - **Time trigger:** after enqueuing fewer than `maxBatchSize`, advancing the fake timer by `flushIntervalMs` flushes the queue; no flush fires while the queue is empty.
  - **Bounded + drop-oldest:** enqueue beyond `maxQueueSize` (with export held pending) drops the oldest records, increments the drop count, calls `onDrop`, and the surviving batch contains the newest records only.
  - **Single in-flight export:** while one export is pending, additional triggers do not call `exporter.export` concurrently; after the first settles and the queue refilled, a follow-up export runs.
  - **`flush()`** drains the current queue on demand.
  - **`shutdown()`** stops the timer (no further flushes after it resolves), awaits the in-flight export, and drains remaining records; is safe to call twice.
  - **Never throws:** `enqueue` after the exporter rejects still returns synchronously without throwing.
