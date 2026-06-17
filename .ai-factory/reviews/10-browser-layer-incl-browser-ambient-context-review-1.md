# Code Review: Browser layer (incl. browser ambient context) — review 1

Scope: `git diff HEAD` for the browser-layer milestone. Source files reviewed in full:
`src/core/sdk.ts`, `src/core/index.ts`, `src/browser/context.ts`, `src/browser/fetch.ts`,
`src/browser/init.ts`, `src/browser/index.ts`, and the three new test files.

Empirical checks run:
- `npm run typecheck` → **FAILS** (see Finding 1).
- `npm run build` → success (browser bundle emits `dist/browser.{mjs,cjs,d.ts,d.cts}`).
- `npm run verify:exports` → success; `--conditions=browser` import loads cleanly and `attw` is clean — the isomorphic guarantee (no `node:`-only code in the browser bundle) holds.
- `npx vitest run` on the three browser suites → 20/20 pass at runtime.

Overall the design matches the plan and the contract (explicit no-`zone.js` context with an honest sync+microtask boundary, opt-in `tracedFetch`, beacon unload flush reusing the same batcher via a pluggable exporter). Core changes are correctly additive and backward-compatible. The findings below are one real regression plus correctness/robustness gaps.

---

## Finding 1 — HIGH: `npm run typecheck` is broken by the unload test's `addEventListener` stub

`test/unload.browser.test.ts:29`

```ts
globalThis.addEventListener = (type: string, handler: () => void) => { ... };
```

`tsc --noEmit` (the project's `typecheck` script; `tsconfig.json` includes `test`) fails:

```
test/unload.browser.test.ts(29,1): error TS2322:
Type '(type: string, handler: () => void) => void' is not assignable to type
'{ <K extends keyof WindowEventMap>(type: K, listener: ...): void; ... }'.
  Target signature provides too few arguments. Expected 1 or more, but got 0.
```

The DOM `addEventListener` signature (in scope because `tsconfig` `lib` includes `DOM`) requires the listener to accept an event argument; `() => void` is too narrow. This is a new regression introduced by this diff — it breaks `npm run typecheck` and the editor TS server, even though the plan's Task 7 gate (build + `verify:exports` + `vitest`) happens not to invoke `typecheck` and so went green.

Fix options:
- Stub via `vi.stubGlobal('addEventListener', handler)` (cleaner, auto-restored), or
- Widen the type: `globalThis.addEventListener = ((type: string, handler: EventListenerOrEventListenerObject) => { ... }) as typeof addEventListener;` and store handlers typed as `EventListener`.

Note: the SDK source itself (`src/browser/init.ts`) typechecks fine — only the test stub is wrong.

---

## Finding 2 — MEDIUM: browser `init()` double-call leaks event listeners and an orphan exporter

`src/browser/init.ts:91-128`

The browser `init` wrapper builds a beacon exporter and calls `coreInit({ ...opts, exporter })`. Core enforces first-wins (`src/core/sdk.ts:91-94`: a second `init` reports via `onError` and returns without touching the batcher). But the browser wrapper does **not** mirror that: after `coreInit` returns, it unconditionally proceeds to `addEventListener('pagehide', …)` and `addEventListener('visibilitychange', …)` and has already constructed a second `createBeaconExporter`.

Consequences of a second `init(...)` call:
- Duplicate `pagehide` / `visibilitychange` handlers are registered (each call creates fresh closures, so `addEventListener` does not dedupe them).
- The second beacon exporter is orphaned — the live batcher still holds the first exporter — yet it is retained via the second handler set's `enableBeacon` closure (small leak).
- The wrapper's own docstring claims "a second call is a no-op (core first-wins semantics)" (`init.ts:88-89`), which is now inaccurate.

This only bites a host that calls `init` twice (a misuse core already flags), so impact is limited, but the wrapper diverges from its documented contract. Suggest a module-level `installed` guard so the listener registration and exporter construction also honor first-wins (bail before building the exporter / registering listeners on the second call).

---

## Finding 3 — LOW: unload delivery depends on no `await` preceding `navigator.sendBeacon` (fragile, currently correct)

`src/browser/init.ts:112-120` + `src/core/batcher.ts:62-91` + `init.ts:45-60`

The unload handler does `enableBeacon(); void flush();` — fire-and-forget. This is only safe during real page teardown because the call chain is synchronous up to `navigator.sendBeacon`: the batcher's `drain()` async fn runs synchronously until its first `await exportOnce()`, `exportOnce()` calls `exporter.export(batch)` synchronously, and the beacon branch reaches `navigator.sendBeacon(...)` with **no `await` before it**. So the beacon is dispatched synchronously inside the event handler, before the browser tears the page down.

This is correct today, but invisible and brittle: if anyone later adds an `await` before `sendBeacon` in the export path (e.g. to inspect a response, or compress the body), the beacon would be scheduled in a microtask that may never run during unload, silently losing the final flush — and no test would catch it (the suite `await flush()`s, masking the timing dependency). Recommend a code comment at the beacon branch documenting that it must remain synchronous, and/or a fast-path in the unload handler that beacons the queue synchronously rather than routing through the async drain.

---

## Finding 4 — LOW: `navigator.sendBeacon` boolean return is ignored (oversized final flush drops silently)

`src/browser/init.ts:54`

```ts
navigator.sendBeacon(endpoint, blob);
```

`sendBeacon` returns `false` when the UA refuses to queue the payload (commonly because it exceeds the ~64 KB beacon limit). The note (`10-browser-layer.md`) explicitly calls out beacon payload-size limits. Here the return value is discarded, so an oversized final flush is dropped with no signal. Consider routing `if (!navigator.sendBeacon(endpoint, blob)) onError?.(new Error('observe-js: sendBeacon rejected payload'))` so the host at least learns about the drop. Low severity (final-flush best-effort), but cheap to add and matches the SDK's onError-everywhere posture.

---

## Finding 5 — LOW: test claims to verify `log()` stamping but never calls `log()`

`test/context.browser.test.ts:72-82`

The test named *"log() issued synchronously inside withSpan is stamped with the span traceId/spanId"* never calls `log()`; its body only re-asserts `getActiveContext()` returns the active span. Plan Task 6 intended this to verify the emitted **record** carries `traceId`/`spanId` ("assert via a captured record"). As written it duplicates the earlier `getActiveContext` assertions and provides no coverage of `log()`'s stamping path (`src/core/sdk.ts:161-167`). Either rename the test to reflect what it checks, or actually drive `log()` with a captured exporter/batcher and assert the record fields.

---

## Finding 6 — LOW (nit): dead `vi` import

`test/context.browser.test.ts:22` imports `vi` from vitest but never uses it. Harmless today only because `noUnusedLocals` is not enabled in `tsconfig.json`. Remove it to avoid noise.

---

## Finding 7 — INFO (nit): misleading comment in unload test

`test/unload.browser.test.ts:52` ("SDK import (after stubs are set up)"). ES `import` statements are hoisted and evaluated before the top-level stub assignments at lines 22-50, so the imports actually run *first*. The test works only because the `init()` **call** (line 64) — not the import — runs after the stubs. The module-load side effect of importing `init.js` (context registration) doesn't touch the stubs, so there's no bug; the comment is just inaccurate.

---

## Verified non-issues

- **Isomorphic boundary holds.** No `node:` imports anywhere in `src/core`; `resource.ts`/`span.ts` use `globalThis.crypto` defensively. `--conditions=browser` import succeeds, confirming the now-larger browser bundle (it pulls `buildResource`/`createExporter`/`encodeLogs`/`init`) stays Node-free.
- **Pluggable exporter wiring is correct.** When `opts.exporter` is supplied, `init` skips `buildResource`+`createExporter` and the browser-built resource/endpoint are used; `service.start` is still emitted exactly once by core (the wrapper correctly does not duplicate it).
- **Context save/restore is correct** for sync, throw, and nesting; the explicit "context not retained after await" test correctly codifies the contract caveat rather than asserting ALS semantics.
- **`flush`/`shutdown`** safely no-op before `init` and never throw; `verbatimModuleSyntax` type-only import discipline is respected across all new files.
- **Beacon vs fetch routing** is correct: normal flushes use fetch, only the post-`enableBeacon` final flush uses `sendBeacon`; a throwing `sendBeacon` is caught and routed to `onError`.
