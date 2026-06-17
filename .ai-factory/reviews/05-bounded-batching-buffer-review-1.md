# Code Review: Bounded batching buffer

**Scope:** `src/core/batcher.ts`, `src/core/index.ts`, `test/batcher.test.ts`
**Verdict:** One must-fix (broken typecheck gate). Implementation logic is correct.

---

## Findings

### 1. [HIGH] `vi.fn` two-type-argument generic breaks `npm run typecheck`

`test/batcher.test.ts` uses the deprecated **two**-type-parameter form of `vi.fn`:

```ts
const mockExport = vi.fn<[LogRecord[]], Promise<void>>()
```

at lines **94, 162, 251, 296**. That signature was removed in vitest 1.0; this project is on **vitest ^3.2** (`package.json`), where `vi.fn` takes a single function-type argument. `tsc --noEmit` fails:

```
test/batcher.test.ts(94,30): error TS2558: Expected 0-1 type arguments, but got 2.
test/batcher.test.ts(162,30): error TS2558: Expected 0-1 type arguments, but got 2.
test/batcher.test.ts(251,30): error TS2558: Expected 0-1 type arguments, but got 2.
test/batcher.test.ts(296,30): error TS2558: Expected 0-1 type arguments, but got 2.
```

This passes `npm test` (`tsup` + `vitest run` both transpile via esbuild, which strips types without checking) but fails the dedicated `typecheck` script — a broken quality gate that will surface in CI / pre-commit.

**Fix** — switch to the single function-type generic at all four sites:

```ts
const mockExport = vi.fn<(records: LogRecord[]) => Promise<void>>()
```

### 2. [LOW] Drain emits the entire queue in one export, ignoring `maxBatchSize`

`exportOnce()` does `queue.splice(0)` — it snapshots the **whole** queue, not a `maxBatchSize` chunk. Under sustained pressure the queue can grow to `maxQueueSize` (2048) before an in-flight export settles, so the follow-up export POSTs up to 2048 records in a single request. `maxBatchSize` then only governs *when* a flush is triggered, never the payload size.

This satisfies every listed test and the spec note's "force-drain the current queue," so it is a design choice rather than a defect — but it is worth a deliberate decision. If bounded payload size is desired (more consistent with the "batch size" intent), splice in `maxBatchSize` chunks: `queue.splice(0, maxBatchSize)` inside the drain loop. Recommend documenting whichever is chosen.

### 3. [INFO] Degenerate `maxQueueSize: 0` miscounts drops

With `maxQueueSize: 0`, every `enqueue` enters the drop branch and calls `onDrop` even when nothing was actually removed (`queue.splice(0, 1)` on an empty array drops zero), and reports inflated counts thereafter. The queue still stays bounded, so this is harmless for the default (2048) and any sane config — noting only for completeness. No action needed unless a `maxQueueSize >= 1` guard is considered worthwhile.

---

## Verified correct

- **Single in-flight / coalescing:** `inflight` is assigned synchronously within `ensureFlushing` before any `await`, and the guard `if (inflight !== null) return inflight` prevents overlapping exports. The drain loop re-checks `queue.length` synchronously after each `await exportOnce()`, so records enqueued during an export are picked up without a concurrent export. Confirmed by the "single in-flight" test.
- **Never throws / no unhandled rejection:** `enqueue` only appends + schedules (fire-and-forget); `exportOnce` attaches `.catch(() => {})`, so `drain()`/`inflight` never reject and the un-awaited flush in `enqueue` cannot produce an unhandled rejection. Holds even with a rejecting exporter (test passes).
- **Drop-oldest:** front-splice with `count = queue.length - maxQueueSize + 1`; for the normal per-enqueue path this is always 1, dropping the oldest record and keeping the newest — matches the spec.
- **Shutdown:** idempotent (memoised `shutdownPromise`), clears the interval, then `await ensureFlushing()` drains to empty including any in-flight export. Timer cleared so no post-shutdown flushes. All three shutdown tests pass.
- **Timer:** `.unref?.()` behind an optional call keeps `core/` isomorphic (no `node:timers` import); browser `setInterval` returns a number with no `unref`, handled safely.
- **Barrel export** (`src/core/index.ts`) follows the existing `export type` + `export` + `.js`-extension convention.

Runtime suite: `vitest run test/batcher.test.ts` → **12 passed**.

---

Finding 1 must be fixed before this is mergeable (it breaks `tsc --noEmit`). Findings 2–3 are non-blocking.
