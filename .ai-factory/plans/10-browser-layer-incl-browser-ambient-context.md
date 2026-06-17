# Plan: Browser layer (incl. browser ambient context)

## Context
Deliver the framework-agnostic browser entry: a lightweight explicit ambient `ContextManager` (no `zone.js`), trace origination on a user action via `startSpan`/`withSpan`, `traceparent` injection on outgoing `fetch` (`tracedFetch`), and a `navigator.sendBeacon` flush on page unload — so a plain browser page can `init`, `log`, open a span on a click, and have the next `fetch` carry a correct `traceparent`.

## Settings
- Testing: yes (the contract's sync+microtask context boundary, `traceparent` injection on `fetch`, and the unload-flush path are this task's correctness guarantees; they are unit-testable under the repo's existing `environment: node` vitest setup by stubbing the minimal DOM globals — no `jsdom` dependency added, keeping the repo's zero-dep test posture. Repo precedent: every prior task shipped a focused suite.)
- Logging: minimal
- Docs: no

## Boundaries & assumptions (deliberate, not gaps)

- **Framework-agnostic — no React/Angular/Vue code.** Framework glue is the consuming project's integration job (see note `10-browser-layer.md`). This entry uses only standard web globals (`fetch`, `Headers`, `Blob`, `navigator`, `addEventListener`, `document`).
- **Honest context boundary (the contract's v0.1.2 caveat).** The browser `ContextManager` is an explicit current-context variable with synchronous save/restore. Because JS is single-threaded, the active context is correct for the **synchronous call stack and immediately-chained microtasks** (e.g. a click handler that synchronously calls `tracedFetch`). It does **not** survive arbitrary `await` hops — that needs TC39 `AsyncContext`, which is deferred. Document this exactly; do **not** pretend ALS-equivalent semantics. This is the intended divergence from Node (`05-ambient-context-node.md`).
- **No `zone.js`, no global patching.** Do not depend on or import `zone.js`; do not patch globals. Angular ships `zone.js` itself, but our explicit context works regardless and must not rely on it.
- **Do NOT monkey-patch global `fetch`.** Out of scope. Propagation is opt-in via `tracedFetch`/`withTraceparent` only. A future opt-in `installGlobalFetch()` is explicitly deferred — do not build it here.
- **Reuse core; do not re-implement.** `init`, `log`, `startSpan`, `withSpan`, `inject`, `extract`, `objectCarrier`, `headersCarrier`, `buildResource`, `createExporter`, `encodeLogs`, `createBatcher` already exist in `core/` and are exported from `src/core/index.js`. The browser layer wires them together and adds only the browser-specific pieces (context manager, `tracedFetch`, beacon/unload flush). Import from `../core/index.js` only — **never** from `../node/`.
- **Packaging is already scaffolded (task 01).** `package.json` `exports` already routes the `browser` condition to `./dist/browser.{mjs,cjs}`, and `tsup.config.ts` already has the `{ entry: { browser: 'src/browser/index.ts' }, platform: 'browser' }` config. tsup bundles whatever `src/browser/index.ts` imports, so adding sibling files under `src/browser/` needs **no** packaging change. Do **not** touch `package.json` `exports`/`typesVersions`/`main`/`module`/`types` or the tsup entry/`outExtension` blocks.
- **Pluggable exporter, not a second batcher.** The unload flush must reuse the SAME buffered records the normal path uses. The clean seam is making the exporter pluggable at `init` (the note's "the exporter is pluggable per task 03"): the browser builds a beacon-capable exporter that uses `fetch` normally and switches to `sendBeacon` for the final flush, passes it to core `init`, and on unload toggles beacon mode + calls `flush()`. Do not introduce a parallel queue.
- **Context-manager registration is global module state.** Like `src/node/context.ts`, registering the browser manager via `setContextManager()` mutates a module-global singleton. Re-export the singleton from the entry (a used value, not a bare side-effect import) so tree-shaking keeps the registration alive. Tests touching this go in dedicated `*.browser.test.ts` files (vitest isolates modules per file), mirroring `context.node.test.ts`.
- **`init` second-call / `log`-before-`init` semantics are owned by core** (`src/core/sdk.ts`) and stay as-is. The browser `init` wrapper adds resource+exporter construction and unload-handler installation around the core call; it must not duplicate the `service.start` emission (core already emits it).

## Tasks

### Phase 1: Core enablers (platform-neutral)

- [x] **Task 1: Make the exporter pluggable at `init` and surface `flush`/`shutdown`**
  Files: `src/core/sdk.ts`, `src/core/index.ts`
  Two additive, backward-compatible changes to the public core API so the browser layer can inject a beacon-capable exporter and drive a final drain. Node/Winston callers are unaffected (all new fields optional; default behavior unchanged).
  - In `InitOptions` (`sdk.ts`), add an optional `exporter?: Exporter` (`import type { Exporter } from './exporter.js'`). In `init(...)`, when `opts.exporter` is provided, use it directly and **skip** the internal `buildResource(...)` + `createExporter(...)` (those exist only to feed the default exporter); when absent, keep the current behavior verbatim. The `service.start` marker emission and the batcher wiring stay unchanged in both branches.
  - Add module-level `flush(): Promise<void>` and `shutdown(): Promise<void>` that delegate to the singleton `_batcher` (`_batcher?.flush() ?? Promise.resolve()`, same for `shutdown`). Both must be safe to call before `init` (no-op resolved promise) and never throw. Document that `shutdown` is idempotent (the batcher already guarantees this).
  - Export `flush` and `shutdown` from `src/core/index.ts` alongside the existing `init`, `log` re-exports (and keep `InitOptions` exported).

### Phase 2: Browser layer

- [x] **Task 2: Browser explicit ambient `ContextManager`** (depends on Task 1)
  Files: `src/browser/context.ts` (new)
  Implement the `ContextManager` interface from `../core/context.js` with a single explicit current-context variable (no stack array needed — `with` saves the previous value in a local and restores it in `finally`, which composes correctly for nesting):
  - `active()` → returns the current `Context | undefined`.
  - `with(ctx, fn)` → save previous, set current = `ctx`, run `fn()`, restore previous in a `finally` (restore on both return and throw). Return `fn`'s result transparently (works for sync and the synchronously-returned value of async callbacks).
  - `bind(ctx)` → set current = `ctx` without restoring (enterWith-style; document the same "use only at well-defined boundaries" caveat as Node).
  - Export a singleton `browserContextManager: ContextManager` and call `setContextManager(browserContextManager)` on module load (mirror `src/node/context.ts` structure and header comments). Add a header comment stating the **sync + immediate-microtask** boundary honestly. Imports from `../core/*` only.

- [x] **Task 3: `traceparent` injection on outgoing `fetch`** (depends on Task 1)
  Files: `src/browser/fetch.ts` (new)
  Provide framework-agnostic, opt-in propagation helpers built on the existing carrier API:
  - `withTraceparent(headers?: HeadersInit): Headers` — construct a `Headers` from the input (if any), wrap it with `headersCarrier(...)`, call `inject(carrier)` (reads the active context; no-ops when no span is open), and return the populated `Headers`.
  - `tracedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>` — compute `headers = withTraceparent(init?.headers)` and call the global `fetch(input, { ...init, headers })`. Uses only web/Node-18+ globals (`fetch`, `Headers`) — no import of `node:` anything. Header comment: this is the opt-in propagation surface; global `fetch` is intentionally **not** patched.

- [x] **Task 4: Browser `init` wrapper, beacon exporter, and unload flush** (depends on Task 1)
  Files: `src/browser/init.ts` (new)
  The browser lifecycle glue. Keep imports to `../core/index.js` and the sibling `./context.js` for registration ordering.
  - **Beacon-capable exporter** — a factory `createBeaconExporter({ endpoint, resource, onError })` returning `{ exporter: Exporter, enableBeacon(): void }`. It wraps `createExporter(...)` (the normal `fetch` path) and holds a `beacon` flag (default `false`). `exporter.export(records)`:
    - When `beacon === true` and `typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'`: encode via `encodeLogs(resource, records)`, `JSON.stringify`, wrap in `new Blob([body], { type: 'application/json' })`, and call `navigator.sendBeacon(endpoint, blob)`; resolve (never throw — guard and route failures to `onError`).
    - Otherwise delegate to the wrapped `fetch` exporter.
    - `enableBeacon()` sets the flag (one-way, for the final flush).
  - **`init(opts: InitOptions)`** (browser wrapper, shadows the core `init` in the browser entry) — build `resource = buildResource(opts.project, opts.service)`, create the beacon exporter with `{ endpoint: opts.endpoint, resource, onError: opts.onError }`, call core `init({ ...opts, exporter })`, then install the unload flush. Do not emit `service.start` here (core does).
  - **Unload flush installer** — register, only when the globals exist (`typeof addEventListener === 'function'`): a `pagehide` handler and a `visibilitychange` handler that fires when `document.visibilityState === 'hidden'`. Both call `enableBeacon()` then `flush()` (the core flush, which drains the buffered records through the now-beacon exporter). Make the handler idempotent (guard so repeated `hidden`/`pagehide` events don't double-work in a harmful way; calling `flush()` again is safe). Keep normal periodic/size flushes on the `fetch` path (only the unload final flush uses beacon), per the note.

- [x] **Task 5: Browser entry — register context + export the full public surface** (depends on Tasks 2, 3, 4)
  Files: `src/browser/index.ts` (replace current stub contents)
  Make the browser entry expose the same uniform public API as the Node entry, plus the browser-only propagation helpers. Concretely:
  - `import './context.js'` for its registration side effect and re-export `browserContextManager` (used value → survives tree-shaking, mirroring `node/index.ts`'s `nodeContextManager` re-export).
  - Re-export the browser `init` and the beacon/unload helpers from `./init.js`; re-export `tracedFetch`, `withTraceparent` from `./fetch.js`.
  - Re-export from `../core/index.js`: `log`, `flush`, `shutdown`, `startSpan`, `withSpan`, `getActiveContext`, `runWithContext`, `bindContext`, `inject`, `extract`, `objectCarrier`, `headersCarrier`, and the types `InitOptions`, `Context`, `ContextManager`, `Span`, `Carrier`. **Do not** re-export the core `init` (the browser `init` from `./init.js` is the one consumers must get). Keep the existing `__sdk` re-export.
  - Header comment: "Browser layer — explicit lightweight ambient context (no zone.js), framework-agnostic. Imports from core only; never imports from node/."

### Phase 3: Tests & verification

- [x] **Task 6: Browser-layer unit tests** (depends on Task 5)
  Files: `test/context.browser.test.ts` (new), `test/fetch.browser.test.ts` (new), `test/unload.browser.test.ts` (new)
  Run under the existing `environment: node` setup; stub the few DOM globals where needed (no `jsdom`). Use dedicated files because the context registration mutates global module state (same rationale as `context.node.test.ts`).
  - **`context.browser.test.ts`** — `import '../src/browser/index.js'` first (registers the browser manager). Assert: `getActiveContext()` is `undefined` outside any scope; visible inside `runWithContext`/`withSpan`; restored after the scope returns; restored even when the callback throws; nested `withSpan` restores the parent on exit; a `log()` issued synchronously inside `withSpan` is stamped with the span's `traceId`/`spanId` (spy the exporter or assert via a captured record). Add one test documenting the boundary honestly: context is **not** retained after an `await` hop (assert `getActiveContext()` is the restored/outer value after `await Promise.resolve()` inside the scoped fn) — this codifies the contract caveat rather than asserting ALS behavior.
  - **`fetch.browser.test.ts`** — stub `globalThis.fetch` with a spy. Assert: inside `withSpan`, `tracedFetch(url)` calls `fetch` with a `traceparent` header whose value matches `00-<traceId>-<spanId>-<flags>` for the active span; outside any span, no `traceparent` header is added; existing `init.headers` are preserved and merged. Also unit-test `withTraceparent(headers)` directly.
  - **`unload.browser.test.ts`** — stub `globalThis.navigator.sendBeacon`, `globalThis.addEventListener`/`document.visibilityState`, and `globalThis.fetch`. Drive `init(...)` → `log(...)`, then dispatch the registered `pagehide` / `visibilitychange(hidden)` handler and assert the buffered records are flushed via `sendBeacon` (not `fetch`) with the correct endpoint and a JSON body that `encodeLogs` would produce; assert normal (pre-unload) flushes still go through `fetch`. Confirm the never-throw contract: a throwing `sendBeacon` is swallowed (routed to `onError`, no exception escapes).

- [x] **Task 7: Build + exports verification gate** (depends on Tasks 5, 6)
  Files: (no source changes — verification only)
  Run `npm run build` then `npm run verify:exports`. Confirm: the browser bundle emits `dist/browser.{mjs,cjs,d.ts,d.cts}`; the `--conditions=browser` import in `verify:exports` resolves and loads the browser entry (proving no `node:`-only code leaked into the browser bundle); `attw --pack .` stays clean (no FalseCJS/types regressions on the `.`/`browser` condition). Finally run `vitest run` (via `npm test`) green. If `attw` flags the browser condition, fix the offending re-export ordering in `src/browser/index.ts` rather than touching `package.json`.

## Commit Plan
- **Commit 1** (after Task 1): "Make core exporter pluggable and surface flush/shutdown"
- **Commit 2** (after tasks 2-5): "Add framework-agnostic browser layer with explicit context, traced fetch, and beacon unload flush"
- **Commit 3** (after tasks 6-7): "Add browser-layer tests and verify dual-build exports"
