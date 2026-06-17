# Plan: Ambient context — Node (`AsyncLocalStorage`)

> Numbering note: this file is `06-…` per the assigned path, but it implements roadmap/spec **05** ("Ambient context — Node"). Spec/roadmap **06** is "Correlation core" — the correlation-core plan must NOT reuse the `06` prefix to avoid collision (review Issue 4).

## Context
Introduce a platform-neutral ambient-context interface in `core/` plus a Node implementation backed by `AsyncLocalStorage`, so `log` can read the active trace/span across `await` boundaries without call sites passing anything.

## Settings
- Testing: minimal
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Core neutral context interface

- [x] **Task 1: Define `Context`, `ContextManager`, and the core registry**
  Files: `src/core/context.ts`
  Create the platform-neutral context module. It must import nothing outside `core/` (dependency rule: `core/` → nothing outside itself; no Node/browser globals).
  - Export `interface Context { traceId: string; spanId: string; traceFlags: number }`.
  - Export `interface ContextManager` with the spec signatures:
    - `active(): Context | undefined`
    - `with<T>(ctx: Context, fn: () => T): T` — scoped; restores the previous context on both normal return and throw.
    - `bind(ctx: Context): void` — `enterWith`-style binding for callback boundaries (e.g. an interceptor binding extracted context for the rest of a request).
  - Provide a default **no-op `ContextManager`** that **fully implements the interface** (review Issue 1 — under `strict` + `verbatimModuleSyntax`, an object literal missing any member is not assignable to `ContextManager` and typecheck fails):
    - `active()` → returns `undefined`
    - `with(ctx, fn)` → just calls `fn()`
    - `bind(_ctx)` → no-op (`() => {}`) — **must be present**, not omitted.
    This keeps `core` usable (and logs valid with no trace id) before any platform manager registers.
  - Hold a module-level "current manager" (initialized to the no-op) and expose:
    - `setContextManager(mgr: ContextManager): void` — platform layers call this to register their implementation.
    - `getActiveContext(): Context | undefined` — delegates to the current manager's `active()` (the name used by the roadmap; this is what `log`/correlation core will call to read the active context without importing `node`/`browser`).
    - `runWithContext<T>(ctx: Context, fn: () => T): T` — delegates to the current manager's `with()`.
    - `bindContext(ctx: Context): void` — delegates to the current manager's `bind()`.
  Rationale: the free functions let `core` consumers (task 06 correlation, task 08 `log`) read/scope context through one neutral seam, while the `ContextManager` interface is what each platform implements.

- [x] **Task 2: Export the context surface from the core barrel** (depends on Task 1)
  Files: `src/core/index.ts`
  Add exports following the existing barrel style (type-only re-exports via `export type`, value re-exports via `export`, `.js` extension):
  - `export type { Context, ContextManager } from './context.js';`
  - `export { setContextManager, getActiveContext, runWithContext, bindContext } from './context.js';`

### Phase 2: Node implementation

- [x] **Task 3: Implement and register the `AsyncLocalStorage` context manager** (depends on Task 2)
  Files: `src/node/context.ts`, `src/node/index.ts`
  In `src/node/context.ts` (imports from `core/` only; never from `browser/`):
  - Import `AsyncLocalStorage` from `node:async_hooks`.
  - Implement a `ContextManager` over `AsyncLocalStorage<Context>`:
    - `active()` → `als.getStore()`
    - `with(ctx, fn)` → `als.run(ctx, fn)` (ALS `run` restores the previous store on return and on throw — satisfies the restore-on-throw requirement).
    - `bind(ctx)` → `als.enterWith(ctx)` (used only at callback boundaries; note in a comment that it leaks context into the rest of the current async scope and `with` is preferred everywhere else).
  - Export a factory (e.g. `createNodeContextManager()`) **and** the singleton instance it builds.
  - Register the singleton as the active manager by calling `setContextManager(...)` at module load, so importing the Node entry wires Node ambient context automatically.
  In `src/node/index.ts`:
  - Re-export the Node context manager **singleton** from `./context.js` (the registered value), and re-export `getActiveContext` / `runWithContext` / `bindContext` / `Context` / `ContextManager` from core for Node consumers. Re-exporting the singleton (a *used* value, not a bare side-effecting call) keeps the registration in the module graph under tree-shaking — see Task 5.

### Phase 3: Verification

- [x] **Task 4: Add a focused Node context test (against `src/`)** (depends on Task 3)
  Files: `test/context.node.test.ts`
  Cover the milestone's "Done when" with `vitest` (matches the existing `test/` convention). **Import the Node entry first** so its `setContextManager(...)` registration runs (review Issue 2 — without it the active manager is still the no-op, whose `active()` returns `undefined` and whose `with` only calls `fn()`, so the across-await assertion fails):
  - `import '../src/node/index.js';` (side-effect: registers the Node manager) **before** importing `getActiveContext` / `runWithContext` from `../src/core/index.js` — or import both from the Node entry.
  - Keep this in its own file (review Issue 5 — registration mutates process-global module state; vitest isolates modules per file, so a dedicated file avoids cross-entry `setContextManager` interference).
  Cases:
  - Context set via `runWithContext` is visible to `getActiveContext()` **across an `await` boundary** inside the scoped function.
  - After the scope returns, `getActiveContext()` is back to the previous value (`undefined` at top level).
  - The previous context is restored even when the scoped function throws.
  - Outside any scope, `getActiveContext()` returns `undefined` (logs with no active context carry no trace id — valid).

- [x] **Task 5: Guard registration against tree-shaking in the built output** (depends on Task 3, Task 4)
  Files: `package.json`, `test/context.node.test.ts` (add one dist-level assertion)
  `package.json` declares `"sideEffects": false` and the build tree-shakes; a top-level `setContextManager(...)` whose return value is unused can be dropped from `dist/`, and the `src/`-based test in Task 4 would not catch it (review Issue 3).
  - Add a `dist`-level check that, after `npm run build`, importing `dist/node.mjs` and running `getActiveContext()` inside `runWithContext(ctx, …)` actually sees `ctx` — i.e. the registration survived bundling. Append this as a case in the Node context test (the existing `test` script already runs `npm run build` before `vitest`, so `dist/` exists), mirroring how `exports.smoke.test.ts` reads `dist/`.
  - If that check fails (registration was stripped), narrow `sideEffects` in `package.json` from `false` to an array that retains the context module, e.g. `"sideEffects": ["./dist/node.*", "./src/node/context.ts"]` (keep it minimal — list only the entry/context modules, not the whole package, to preserve tree-shaking elsewhere). Re-run the build and the dist check until it passes.
