# 10 — Browser layer (incl. browser ambient context)

**Task:** ROADMAP → Adapters → "Browser layer (incl. browser ambient context)"
**Contract:** `observe-contract@v0.1.2` (ambient context — explicit, not `zone.js`, with the browser caveat; carrier-agnostic propagation)
**Depth:** full — the browser ambient mechanism is the contract's v0.1.2 decision and the trickiest divergence from Node.

## Goal

The framework-agnostic browser entry: a lightweight explicit ambient context (no `zone.js`), trace origination on a user action, and `traceparent` injection on outgoing `fetch`.

## Design (recommended)

- **Browser `ContextManager`** (implements task 05's interface): an explicit current-context variable with a stack. `with(ctx, fn)` sets current, runs `fn`, restores in `finally`. **No `zone.js`** — do not patch globals.
  - **Boundary (be honest):** because JS is single-threaded, the active context is correct for the **synchronous stack and the immediately-chained microtask** (e.g. a click handler that synchronously calls `tracedFetch`). It does **not** survive arbitrary `await` hops — that needs TC39 `AsyncContext`, deferred. Document this exactly as the contract's caveat.
- **Trace origination:** a helper to open a span on a user action, e.g. `withSpan(startSpan(), () => { ... tracedFetch(...) ... })` inside a click handler — the dominant browser case.
- **`fetch` propagation:** ship a `tracedFetch(input, init?)` (or a `withTraceparent(headers)` helper) that reads the active context and `inject`s `traceparent` into the request headers (task 07). **Do not monkey-patch global `fetch`** by default — opt-in only.
- **Flush on unload (recommended):** on `pagehide`/`visibilitychange: hidden`, flush via `navigator.sendBeacon` (the exporter is pluggable per task 03) so buffered logs aren't lost on navigation.

## Edge cases / watch

- React/Angular/Vue: **no framework-specific code here** — framework glue is the consuming project's integration job. This stays framework-agnostic.
- Angular ships `zone.js` itself, but we still don't depend on it — our explicit context works regardless.
- `sendBeacon` has payload-size limits and only does POST — fine for a final flush; keep normal flushes on `fetch`.

## Out of scope

Node ambient/ALS (task 05). Framework adapters in consuming repos.

## Done when

A plain browser page can `init`, `log`, open a span on a click, and the next `tracedFetch` carries a correct `traceparent`; the documented sync+microtask boundary holds; unload flush works.
