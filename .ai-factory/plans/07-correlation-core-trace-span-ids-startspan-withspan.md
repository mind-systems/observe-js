# Plan: Correlation core — trace/span ids + `startSpan`/`withSpan`

## Context
Add W3C-shaped trace/span id generation and the `startSpan`/`withSpan` API so logs emitted inside a span ambiently inherit `traceId`/`spanId`, with nested spans restoring the parent on exit. Correlation only — no timing, status, or export.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Implementation

- [x] **Task 1: Add span module with id generation and `startSpan`/`withSpan`**
  Files: `src/core/span.ts` (new)
  Create the platform-neutral span module. Import nothing outside `core/` (no Node/browser globals beyond `globalThis.crypto`, per the `resource.ts` precedent).
  - Define and export `interface Span { traceId: string; spanId: string; parentSpanId?: string; traceFlags: number }` exactly as in the spec.
  - Id generation: `traceId` = 16 random bytes → 32 lowercase hex; `spanId` = 8 random bytes → 16 lowercase hex. Source randomness via `globalThis.crypto.getRandomValues` (isomorphic: Node 18+ main realm and browsers). Mirror the defensive pattern in `src/core/resource.ts` (`newInstanceId`): fall back to a `Math.random`-based byte fill when `globalThis.crypto?.getRandomValues` is absent (vitest VM contexts), since ids are uniqueness tokens, not secrets. Add two private helpers `newTraceId()` / `newSpanId()` over a shared `randomHex(byteLen)`. **Reject all-zero ids and regenerate** (loop until a non-zero id is produced).
  - `traceFlags` default `0x01` (sampled). Add a brief comment: logs are always emitted; span sampling is a future tracing-backend concern.
  - `export function startSpan(name?: string): Span` — `name` is reserved for future export and unused in v0 (note this in a comment). Read the active context via `getActiveContext()` from `./context.js`. If a context is active: inherit its `traceId`, set `parentSpanId` = active `spanId`, generate a new `spanId`, carry `traceFlags` from the active context. If none: start a new trace (new `traceId`, fresh `spanId`, no `parentSpanId`, `traceFlags` = `0x01`).
  - `export function withSpan<T>(spanOrName: Span | string | undefined, fn: () => T): T` — discriminate with `typeof spanOrName === 'object'`: if it's a `Span` object use it as-is; otherwise call `startSpan(spanOrName)` to create one (passing through a `string` name or `undefined`). Run `fn` inside `runWithContext({ traceId, spanId, traceFlags }, fn)` from `./context.js` — the context manager's try/finally restores the parent context on both normal return and throw. Note: the ambient `Context` only carries `traceId`/`spanId`/`traceFlags`; `parentSpanId` lives on the returned/passed `Span` and is not needed for log stamping. Return `fn`'s result so `withSpan` is transparent for sync and async (`Promise`-returning) callbacks.
    - The `undefined` arm widens the spec note's `withSpan(spanOrName: Span | string, fn)` to `Span | string | undefined`. This is an intentional ergonomic superset, not a contract violation — the contract is language-neutral vocabulary/semantics, not a literal TS signature, and `withSpan(undefined, fn)` simply opens a fresh root/child span without naming it. Mark it as an intentional superset in a comment.

- [x] **Task 2: Export span API from the core barrel and the Node entry** (depends on Task 1)
  Files: `src/core/index.ts`, `src/node/index.ts`
  - In `src/core/index.ts`: add a "Span / correlation core" export block after the ambient-context exports: `export type { Span } from './span.js';` and `export { startSpan, withSpan } from './span.js';`. Follow the existing `export type` / `export` separation and `.js` extension convention used throughout the file.
  - In `src/node/index.ts`: also re-export the new API so it reaches package consumers. This resolves the public-reachability gap from both prior reviews: `package.json` `exports` routes consumers to `dist/node.*` (built from `src/node/index.ts`), which re-exports only a hand-picked subset of the core barrel — not the barrel wholesale — and no downstream task (08 `init`/`log`, 09 Winston, 10 browser) is scoped to wire the Node entry's span surface. Without this, public `startSpan`/`withSpan` would be invisible to anyone consuming the published package, contradicting milestone DoD line 46. Add `export { startSpan, withSpan } from '../core/index.js';` and `export type { Span } from '../core/index.js';`, matching the existing context re-export style. Leave the browser entry (`src/browser/index.ts`) untouched — it re-exports the same API in task 10.

### Phase 2: Tests

- [x] **Task 3: Unit tests for id shape and span nesting** (depends on Task 2)
  Files: `test/span.node.test.ts` (new)
  Use the `.node.test.ts` suffix (matching `context.node.test.ts`) to signal that the suite registers the Node `AsyncLocalStorage` manager and mutates process-global context state; vitest's per-file isolation keeps it from leaking into other suites. Follow the structure and registration discipline of `test/context.node.test.ts`. Import `../src/node/index.js` first (side effect: registers the Node `AsyncLocalStorage` `ContextManager`) so `withSpan` actually scopes context; without it the no-op manager makes nesting assertions vacuous. Cover the spec's "Done when":
  - **Id validity:** `startSpan()` produces `traceId` matching `/^[0-9a-f]{32}$/`, `spanId` matching `/^[0-9a-f]{16}$/`, both non-all-zero; `traceFlags === 1`.
  - **New trace at root:** `startSpan()` with no active context has no `parentSpanId` and a fresh `traceId`; two root calls produce different `traceId`s.
  - **Logs inherit ids inside `withSpan`:** inside `withSpan(...)`, `getActiveContext()` returns a context whose `traceId`/`spanId` equal the span's.
  - **Nested `withSpan`:** inner span inherits the outer `traceId`, inner `parentSpanId` === outer `spanId`, inner `spanId` !== outer `spanId`; after the inner scope returns, `getActiveContext()` is restored exactly to the outer span's context; after the outer scope returns it is `undefined`.
  - **Restore on throw:** a `withSpan` whose `fn` throws still restores the previous context (assert `getActiveContext()` is `undefined`/outer after the throw).
  - **Accepts an explicit `Span`:** `withSpan(existingSpan, fn)` scopes to that exact span rather than creating a new one.
  - **Dist-level public surface:** add a block (mirroring the `dist/node.mjs` block in `context.node.test.ts` and `exports.smoke.test.ts`) that dynamically imports `dist/node.mjs` and asserts `startSpan`/`withSpan` are exported functions and that `withSpan` over the dist bundle scopes a context whose ids match the span — confirming Task 2's Node-entry re-export reaches the published package.
