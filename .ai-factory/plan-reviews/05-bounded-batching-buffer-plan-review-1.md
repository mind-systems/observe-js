# Plan Review: Bounded batching buffer

**Plan:** `.ai-factory/plans/05-bounded-batching-buffer.md`
**Risk Level:** 🟢 Low — implementable as written; only non-blocking clarifications below.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`)** — ✅ PASS. The batcher lands in `src/core/` (platform-neutral), imports only `Exporter`/`LogRecord` from core, and Task 2 explicitly keeps Node-only assumptions out via the `.unref?.()` feature check. Dependency rule "`core/` never imports Node or browser globals" is respected.
- **Rules (`.ai-factory/rules/base.md`)** — ✅ PASS. File name `batcher.ts` is kebab-case; `createBatcher` is camelCase; `Batcher`/`BatcherConfig` PascalCase. "Export failures degrade silently / `log()` returns synchronously" is honored: `enqueue` is synchronous and never throws, flush is fire-and-forget.
- **Roadmap (`.ai-factory/ROADMAP.md`)** — ✅ PASS. Directly implements the Core task "Bounded batching buffer" and faithfully covers its `Spec:` note `04-bounded-batching.md` (defaults 512/1000/2048, drop-oldest, single in-flight, `flush`/`shutdown`). WARN (non-blocking): the plan body does not cite the roadmap item or the `04-` spec note — adding that pointer would aid traceability, matching the two-tier convention used elsewhere.

## Verification against the codebase

- ✅ `src/core/exporter.ts` exists and exposes `interface Exporter { export(records: LogRecord[]): Promise<void> }` plus the `createExporter` factory — the plan's wrap target and factory style match exactly.
- ✅ `Exporter.export` is contractually non-throwing (swallows all errors, calls `onError`), so the batcher's "never throws" guarantee is achievable without extra try/catch around `export`.
- ✅ `src/core/index.ts` already lists "batcher" in its header comment and uses the `export type { … } from './x.js'` + `export { … } from './x.js'` pattern with `.js` extensions — Task 3 matches the existing block verbatim.
- ✅ `test/exporter.test.ts` uses vitest + `vi.fn()` + `vi.stubGlobal`; mirroring it for `test/batcher.test.ts` is consistent. `LogRecord` is importable from `../src/core/index.js`.
- ✅ Improvement over the spec note: note `04` sketched a `class Batcher`; the plan correctly switches to a `createBatcher` factory to match the actual `createExporter` style in the repo, and replaces the note's "surface drops via exporter.onError" with a dedicated `onDrop` hook (cleaner, same loop-avoidance rationale).

## Non-Critical Issues / Clarifications

1. **Drain granularity is unspecified when the queue exceeds `maxBatchSize` (medium).** After coalescing, the queue can hold up to `maxQueueSize` (2048) records while an export is in flight. The plan says `flush()` "force-drain the current queue now" — it does not state whether a drain emits **one `export()` call with the entire queue** or **chunks of `maxBatchSize`**. Both satisfy the listed tests, but they produce very different payload sizes (a 2048-record POST vs. four 512-record POSTs). Recommend deciding explicitly — chunking by `maxBatchSize` keeps payloads bounded and is more consistent with the "batch size" intent — and adding a test asserting the chosen behavior.

2. **`flush()` resolution semantics vs. an in-flight export (minor).** The plan defines coalescing for *triggers* but should state that a `flush()` (and therefore `shutdown()`) promise resolves only after the queue is fully drained **including** any export that was already in flight when `flush()` was called — otherwise `shutdown()` could resolve with records still pending. The drain-until-empty loop in Task 1 implies this; making it explicit avoids an off-by-one drain.

3. **Fire-and-forget flush should swallow rejections defensively (minor).** `enqueue` triggers a flush without awaiting. Since `Exporter.export` never rejects today, the flush promise won't reject — but a defensive `.catch(() => {})` on the un-awaited flush prevents a future unhandled-rejection if the drain logic itself ever throws. Worth one line in Task 1.

4. **Test authoring note for the "single in-flight" case (minor).** With `vi.useFakeTimers()`, the deferred-promise exporter mock needs explicit microtask draining (e.g. `await vi.advanceTimersByTimeAsync(...)` / awaiting a flushed microtask) between asserting "export not called concurrently" and "follow-up export runs after settle." Calling this out in Task 4 will save the implementer a flaky-test round-trip.

5. **`.unref?.()` typing (informational, not blocking).** `@types/node` is in the tsc include scope, so the global `setInterval` is typed to return `NodeJS.Timeout` whose `.unref()` is non-optional; `.unref?.()` is runtime-correct (browser returns a number) but a strict lint rule (`no-unnecessary-condition`) could flag the optional call. Storing the handle as `ReturnType<typeof setInterval>` and keeping the optional call is fine — just be aware it is intentional.

## Positive Notes

- Faithful coverage of the frozen-contract invariants (bounded, drop-oldest, never-throw, single in-flight) with sensible defaults carried straight from the spec note.
- Reentrancy is called out explicitly (enqueue-from-within-callback must not deadlock) — a real footgun the plan preempts.
- Isolation of the timer in a private helper keeps `core/` isomorphic and makes Task 2's `.unref` concern a one-spot change.
- The test task maps one-to-one onto the spec's "done when" bullets, including the negative "never throws after exporter rejects" case.

The plan is solid and implementable; all findings above are clarifications, not blockers.

PLAN_REVIEW_PASS
