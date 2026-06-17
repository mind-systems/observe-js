# 06 — Correlation core: trace/span ids + `startSpan`/`withSpan`

**Task:** ROADMAP → Core → "Correlation core — trace/span ids + `startSpan`/`withSpan`"
**Contract:** `observe-contract@v0.1.2` (Public API: `startSpan`/`withSpan`; spans only stamp logs today — no export until Tempo)
**Depth:** full — id generation, span shape, and nesting semantics set the template for swift/dart.

## Goal

Generate W3C-shaped trace/span ids, keep an active span in ambient context, and expose `startSpan`/`withSpan` so logs inside inherit the ids. **Correlation only** — no timing, status, or export.

## Design (recommended signatures + defaults)

```ts
interface Span { traceId: string; spanId: string; parentSpanId?: string; traceFlags: number }

function startSpan(name?: string): Span        // name reserved for future export; unused in v0
function withSpan<T>(spanOrName: Span | string, fn: () => T): T
```

- **Id generation:** `traceId` = 16 random bytes → 32 lowercase hex; `spanId` = 8 random bytes → 16 lowercase hex. Source: Web Crypto `crypto.getRandomValues` (works in Node 18+ and browsers — keeps it isomorphic). Reject all-zero ids (regenerate).
- **`startSpan`:** if a context is active, inherit its `traceId` and set `parentSpanId` = active `spanId`, new `spanId`. If none active, start a **new trace** (new `traceId`, no parent).
- **`withSpan`:** create/accept the span, run `fn` inside `ContextManager.with({traceId, spanId, traceFlags})`, restore the parent on exit (try/finally via the context manager).
- **`traceFlags`:** default `01` (sampled). Logs are always emitted; sampling of spans is a tracing-backend concern for later. Document this default.
- Logs read the active context in `log` (task 08) and stamp `traceId`/`spanId`.

## Edge cases / watch

- **Nested `withSpan`:** inner span inherits the outer's `traceId`, parent = outer span; on inner exit the outer must be restored exactly (relies on task 05's `with` discipline).
- **Async boundary:** in Node, ALS carries the span across `await`. In the browser (task 10) the explicit context only holds within the sync stack + immediate microtask — document this divergence; it's the contract's browser caveat, not a bug.
- v0 has no span end/duration; `withSpan` simply scopes context. Don't add timing fields that imply export.

## Out of scope

Span export, durations, status codes, hierarchy beyond `parentSpanId` (all post-Tempo). `traceparent` wire format lives in task 07.

## Done when

Logs inside `withSpan` carry the span's `traceId`/`spanId`; a nested `withSpan` restores the parent span on exit; ids are valid 32/16-char lowercase hex.
