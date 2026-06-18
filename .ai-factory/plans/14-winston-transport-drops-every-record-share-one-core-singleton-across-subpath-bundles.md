# Plan: Winston transport drops every record — share one core singleton across subpath bundles

## Context
`ObserveTransport` (`observe-js/winston`) silently drops every `Logger.log(...)` because `dist/winston.cjs` inlines its own duplicate, never-initialized copy of `core/sdk.ts`. Make the winston entry resolve the package's own runtime via a self-import + `external`, so `observe-js` and `observe-js/winston` share exactly one `_initialized`/`_batcher` per process.

## Settings
- Testing: yes (cross-bundle regression test mandated by the spec; plus migrating the existing unit test)
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Share one core singleton

- [x] **Task 1: Self-import the runtime `log` in the winston adapter; keep the type import relative**
  Files: `src/node/winston.ts`
  Change only the **runtime** binding so the transport depends on the package itself instead of the relative core path. Replace `import { log } from '../core/index.js';` with `import { log } from 'observe-js';`. **Keep** `import type { Level } from '../core/index.js';` relative — `verbatimModuleSyntax` is enabled, so the type import is fully erased before bundling and never re-inlines core. Routing the type through `'observe-js'` would force `tsc --noEmit` (and the winston dts build) to resolve `observe-js` → `dist/node.d.ts`, adding a hard dependency on a prior build to standalone `npm run typecheck` and risking dts build-ordering issues; keeping it relative sidesteps both and leaves no `observe-js` reference in `dist/winston.d.ts` for `attw` to resolve. Leave the rest of the file (`ObserveTransport`, level mapping, error swallowing) untouched. Do **not** add an `init()` call inside the transport — the host inits once; duplicating init would create two SDKs.

- [x] **Task 2: Build the winston entry as its own config with `external: ['observe-js']`; drop the vestigial `core` entry** (depends on Task 1)
  Files: `tsup.config.ts`
  Split the Node build so the winston adapter no longer inlines core:
  - Remove `core: 'src/core/index.ts'` from the existing Node config object's `entry` — after this fix nothing references `dist/core.*` (`core` is not in the `package.json` `exports` map, `typesVersions`, `verify:exports`, or any test). Keep `node: 'src/node/index.ts'` in that object.
  - Remove `winston: 'src/node/winston.ts'` from that same object and give the winston entry its own config object in the exported array, with `entry: { winston: 'src/node/winston.ts' }`, `platform: 'node'`, `format: ['esm', 'cjs']`, `dts: true`, `sourcemap: true`, `treeshake: true`, `clean: false`, the same `outExtension` (`.mjs`/`.cjs`), and crucially `external: ['observe-js']`.
  - Isolate `external: ['observe-js']` to the winston object only; the browser and node objects keep `external: []`.
  This makes `dist/winston.{cjs,mjs}` emit a bare `require('observe-js')` / `import 'observe-js'` that resolves at runtime, via Node/ESM **package self-reference**, to `dist/node.{cjs,mjs}` — the same require-cache / module instance the host loads, so there is exactly one `_batcher`. Do not change the `package.json` `exports` map or the `./winston` subpath shape.

### Phase 2: Tests

- [x] **Task 3: Migrate the existing winston unit test to mock the self-import target** (depends on Task 1)
  Files: `test/winston.node.test.ts`
  After Task 1 the transport imports `log` from `'observe-js'`, not `'../src/core/index.js'`, so the existing `vi.mock('../src/core/index.js', …)` no longer intercepts the transport's `log` — every assertion (level mapping, attr forwarding, never-throw) would fail because `logSpy` is never called. Repoint the mock and the spy import to the same module the transport now imports:
  - Change `vi.mock('../src/core/index.js', async (importOriginal) => { … log: vi.fn() })` to mock `'observe-js'` instead, still spreading `importOriginal()` and overriding only `log` with `vi.fn()`.
  - Change `import * as CoreModule from '../src/core/index.js';` to `import * as CoreModule from 'observe-js';` so `vi.mocked(CoreModule.log)` is the spy the transport actually calls.
  - The side-effect import `import '../src/node/index.js';` (Node ContextManager registration) and everything else stay as-is.
  - This suite resolves `'observe-js'` through `package.json` `exports` → built `dist/node.mjs`; `npm test` builds first so the self-reference resolves. Confirm `vi.mock('observe-js')` with `importOriginal` correctly wraps the built module and the existing assertions pass unchanged.

- [x] **Task 4: Add a cross-bundle regression test against the built `dist/`** (depends on Task 2)
  Files: `test/winston.dist.test.ts` (new)
  Add a regression test that crosses the **built** subpath bundles (the same model as the note-13 `exports.smoke` guard) — it must import from `dist/`, never from source, because source runs core as a single in-process module and cannot reproduce the dual-bundle duplicate (which is why conformance + live-smoke passed). The `npm test` script runs `npm run build` first, so `dist/` is present; the test must not build itself.
  - For **each** of the two format pairs — `dist/node.cjs` ↔ `dist/winston.cjs` (the pair that reproduced the bug) **and** `dist/node.mjs` ↔ `dist/winston.mjs` — load `init`/`flush` from the node entry and `ObserveTransport` from the winston entry by their absolute `dist/` paths (use `createRequire(import.meta.url)` for the `.cjs` pair, dynamic `import()` for the `.mjs` pair). The self-reference reproduces the consumer path: `winston.cjs`'s internal `require('observe-js')` self-resolves to the same `dist/node.cjs` absolute path → shared require-cache entry; the ESM pair is symmetric via resolved-URL identity.
  - Stub `globalThis.fetch` to capture posted OTLP requests **before** calling `init` (init constructs the exporter eagerly, binding the send path at init time), then `init({ project, service, endpoint })`, attach the transport to a **real** `winston.createLogger({ transports: [new ObserveTransport()] })`, call `logger.info('a plain line')`, then `await flush()`.
  - Assert the stubbed `fetch` received a request whose decoded OTLP body contains the ordinary `logger.info(...)` line — **not** only the `service.start` marker. That marker-yes/logs-no asymmetry was the bug, so drive a real Winston logger (not a direct `ObserveTransport.log()` call) to exercise the consumer's actual path.
  - Restore the original `fetch` between the two format cases. No extra SDK-state teardown is needed across formats — `dist/node.cjs` and `dist/node.mjs` are distinct module instances with independent `_initialized`/`_batcher`, so the cases cannot bleed singleton state; within a format the single `init` is first-wins.

- [x] **Task 5: Build and verify** (depends on Task 3, Task 4)
  Files: (none — verification only)
  Run `npm run build`, then confirm the fix in the built output:
  - `dist/winston.cjs` now contains a bare `require('observe-js')` (or the resolved equivalent) and **no** inlined `function log(...) { { return; } }` no-op body; `dist/core.*` is no longer emitted.
  - `npm test` passes, including the migrated `test/winston.node.test.ts` and the new `test/winston.dist.test.ts` for both the `.cjs` and `.mjs` pairs.
  - `npm run typecheck` passes against source alone (the type import stayed relative, so no `dist/` dependency).
  - `npm run verify:exports` still passes (subpath resolution and `attw` unchanged; no `observe-js` self-import surfaces in `dist/winston.d.ts`).

## Notes
- **Publish to `main`, no tag.** Per the spec/owner decision (consistent with the dart precedent), the fix ships by pushing `observe-js/main`; consumers repin their git-dep from `#v0.1.0` → `main` and reinstall. Do **not** cut a new tag. (Commit/push only on the user's explicit go-ahead.)
- **Out of scope (recorded for awareness):** the `globalThis[Symbol.for('observe-js')]` singleton fallback is only needed if a consumer bundles the SDK itself into one file; NestJS/`tsc` consumers (our case) resolve `observe-js` un-bundled, so it is not required now.
