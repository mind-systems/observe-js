# Code Review: Bounded batching buffer (round 2)

**Scope:** `src/core/batcher.ts`, `src/core/index.ts`, `test/batcher.test.ts`
**Verdict:** No blocking findings. Round-1's only must-fix is resolved; gates are green.

---

## Round-1 follow-up

- **[RESOLVED] `vi.fn` two-type-argument generic.** All four sites (`test/batcher.test.ts` lines 94, 162, 251, 296) now use the vitest 3 single function-type form `vi.fn<(records: LogRecord[]) => Promise<void>>()`. `tsc --noEmit` passes clean (exit 0). The broken typecheck gate is fixed.

## Gates verified this round

- `npx tsc --noEmit` → **pass** (no diagnostics).
- `npx vitest run test/batcher.test.ts` → **12 passed**.
- `src/core/batcher.ts` is unchanged from round 1; re-audited in full below.

## Logic re-audit (confirmed correct)

- **Single in-flight / coalescing:** `inflight` is assigned synchronously inside `ensureFlushing` before any suspension point, and `if (inflight !== null) return inflight` makes every concurrent trigger (size, timer, `flush`, `shutdown`) join the existing drain instead of spawning a parallel export. The `while (queue.length > 0)` loop re-checks synchronously after each `await exportOnce()`, so records enqueued mid-export are drained in the next iteration with no overlap.
- **Never throws / no unhandled rejection:** `enqueue` only appends + optionally fires `ensureFlushing` (un-awaited); `exportOnce` attaches `.catch(() => {})`, so neither `drain()` nor `inflight` can reject, and the fire-and-forget call cannot produce an unhandled rejection — holds with a rejecting exporter (test confirms).
- **Drop-oldest:** front `splice` with `count = queue.length - maxQueueSize + 1`; per-enqueue this is exactly 1, evicting the oldest and retaining the freshest records, with `onDrop(count)` surfaced synchronously.
- **Shutdown:** memoised `shutdownPromise` (idempotent, returns same promise — test asserts `p1 === p2`), clears the interval, then `await ensureFlushing()` drains to empty including any in-flight export; no flush fires after resolution.
- **Timer:** `(handle as { unref?: () => void }).unref?.()` keeps `core/` isomorphic (no `node:timers` import); safe on browser's numeric handle.
- **Barrel export** follows the existing `export type` + `export` + `.js`-extension convention.

## Non-blocking observations (carried from round 1 — not defects)

1. **Drain emits the whole queue per export.** `exportOnce` does `queue.splice(0)`, so `maxBatchSize` gates *when* a flush triggers but not payload size; under sustained pressure a single POST can carry up to `maxQueueSize` (2048) records. Consistent with the spec note's "force-drain the current queue"; flag only if bounded payload size is later desired (then chunk via `queue.splice(0, maxBatchSize)`).
2. **Degenerate `maxQueueSize: 0`** would call `onDrop` with inflated counts while still staying bounded. Harmless for the default and any `>= 1` config; no action needed.

Neither is a bug, security issue, or correctness problem.

REVIEW_PASS
