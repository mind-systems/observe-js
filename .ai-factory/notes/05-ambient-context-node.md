# 05 — Ambient context (Node, `AsyncLocalStorage`)

**Task:** ROADMAP → Core → "Ambient context — Node (`AsyncLocalStorage`)"
**Contract:** `observe-contract@v0.1.2` (ambient context is platform-native; `trace_id` never threaded through call sites)
**Depth:** full — defines the unified internal context interface that the browser layer (task 10) and correlation core (task 06) both build on.

## Goal

A platform-neutral context interface, with the Node implementation backed by `AsyncLocalStorage`, so `log` can read the active trace/span without call sites passing anything.

## Design (recommended signatures)

```ts
interface Context { traceId: string; spanId: string; traceFlags: number }

interface ContextManager {
  active(): Context | undefined
  with<T>(ctx: Context, fn: () => T): T   // scoped; restores previous on return/throw
  bind(ctx: Context): void                // enterWith-style, for callback-boundary binding
}
```

- **Node impl:** wrap `AsyncLocalStorage<Context>`. `with` → `als.run(ctx, fn)`. `active` → `als.getStore()`. `bind` → `als.enterWith(ctx)` (needed where there's no enclosing callback to wrap, e.g. a gRPC interceptor binding extracted context for the rest of a request).
- The neutral interface is what `core` depends on; `node` and `browser` provide their own `ContextManager`. The build selects which via `exports` conditions.

## Edge cases / watch

- `with` must restore the previous store on both normal return and throw (ALS `run` handles this).
- Prefer `with` over `bind` everywhere possible; `bind`/`enterWith` leaks context into the rest of the current async scope and is only for callback boundaries.
- Logs emitted with no active context simply carry no trace id — that is valid (startup, schedulers).

## Out of scope

Span creation and id generation (task 06). Browser implementation (task 10) — this task only ships the interface + Node impl.

## Done when

Context set via `with` is visible to `active()` across `await` boundaries in Node; restored correctly after the scope; logs read it.
