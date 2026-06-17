# Code Review: Browser layer (incl. browser ambient context) — review 2

Re-review after the revisions that followed review 1. Scope: full `git diff HEAD` for the
browser-layer milestone. All changed/new source files re-read in full:
`src/core/sdk.ts`, `src/core/index.ts`, `src/browser/context.ts`, `src/browser/fetch.ts`,
`src/browser/init.ts`, `src/browser/index.ts`, and the three browser test files.

## Empirical verification (all green)

| Gate | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`, includes `test/`) | ✅ passes |
| `npm run build` (tsup dual ESM+CJS + dts) | ✅ browser bundle emits `dist/browser.{mjs,cjs,d.ts,d.cts}` |
| `npm run verify:exports` | ✅ all conditions 🟢 (CJS `require`, ESM `import`, `--conditions=browser`); `attw` clean |
| `npx vitest run` (whole suite) | ✅ 134/134 across 13 files |
| dist-level context registration (manual) | ✅ `withSpan`→`getActiveContext` works through `dist/browser.mjs` — `setContextManager` side effect survives `sideEffects:false` tree-shaking |

## Review-1 findings — all resolved

1. **(HIGH) `typecheck` broken by the `addEventListener` stub** — fixed. `test/unload.browser.test.ts:31-34` now casts the stub `as unknown as typeof globalThis.addEventListener`. `tsc --noEmit` is clean.
2. **(MEDIUM) double-`init()` leaked listeners + orphan exporter** — fixed. `src/browser/init.ts:86,103-107` adds a module-level `_installed` guard that mirrors core's first-wins: a second call reports via `opts.onError` and returns before building an exporter or registering listeners. Docstring updated to match.
3. **(LOW) sync-`sendBeacon` fragility** — addressed. `init.ts:54-57` documents that `navigator.sendBeacon` must remain synchronous in the export path (no `await` before it) for unload delivery to be guaranteed.
4. **(LOW) `sendBeacon` boolean return ignored** — fixed. `init.ts:58-61` checks the return value and routes a `false` (payload rejected / over size limit) to `onError`.
5. **(LOW) test named for `log()` stamping never called `log()`** — addressed. `test/context.browser.test.ts:72-84` is renamed to describe what it actually asserts (the context values `log()` reads) and points to `unload.browser.test.ts` for the end-to-end `init()+log()+flush()` path.
6. **(LOW) dead `vi` import** — fixed. `context.browser.test.ts:22` no longer imports `vi`.
7. **(INFO) misleading hoisting comment** — fixed. `unload.browser.test.ts:54-58` now correctly explains that imports are hoisted and only the `init()` *call* must follow the stubs.

No regressions were introduced by the fixes. The `_installed` guard is set before `coreInit` (which is non-throwing), so the first-wins behavior is robust; the `!queued` branch is correctly inside the existing `try` and cannot throw into the caller.

## Correctness re-check (no defects found)

- **Isomorphic boundary**: no `node:` imports in `src/core`; the larger browser bundle (now pulling `buildResource`/`createExporter`/`encodeLogs`/`init`) loads under `--conditions=browser` and `attw` is clean.
- **Pluggable exporter**: when `opts.exporter` is supplied, core skips `buildResource`+`createExporter` and emits `service.start` exactly once; the browser wrapper does not duplicate the marker.
- **Beacon vs fetch routing**: normal flushes use fetch; only the post-`enableBeacon` final flush uses `sendBeacon`; the beacon call is reached synchronously within the unload handler (drain's async prefix runs sync up to the first `await`), so real-teardown delivery holds. A throwing `sendBeacon` is caught and routed to `onError`.
- **Context manager**: sync save/restore is correct across normal return, throw, and nesting; the explicit "not retained after await" test correctly codifies the v0.1.2 caveat.
- **`flush`/`shutdown`**: safely no-op before `init`, never throw; `verbatimModuleSyntax` type-only import discipline respected throughout.

## Non-blocking observation (accepted design behavior, not a defect)

- If a *normal* fetch export is already in-flight at the moment `pagehide`/`visibilitychange=hidden` fires, that already-snapshotted batch stays on the fetch path and could be dropped by the browser during teardown (only records still queued at that instant are beaconed). This is inherent to the plan-mandated pluggable-exporter design and consistent with the SDK's stated best-effort, drop-under-pressure buffering contract — the unload beacon is a recommended mitigation, not a delivery guarantee. No action required.

REVIEW_PASS
