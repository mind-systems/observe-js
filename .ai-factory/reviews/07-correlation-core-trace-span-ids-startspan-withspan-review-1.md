# Code Review — Correlation core: trace/span ids + `startSpan`/`withSpan`

**Plan:** `07-correlation-core-trace-span-ids-startspan-withspan.md`
**Changed code:** `src/core/span.ts` (new), `src/core/index.ts`, `src/node/index.ts`, `test/span.node.test.ts` (new)
**Verification run:** `tsc --noEmit` clean; `npm test` (build + vitest) green — 7 files, 71 tests pass, including the 19 new span tests.

## Scope

Reviewed the four code files in full against the spec note (`notes/06-correlation-core.md`), the plan, and the surrounding modules (`core/context.ts`, `core/resource.ts`, `node/context.ts`). Focus on runtime correctness, the ambient-context contract, id-generation semantics, and public reachability.

## Correctness — verified

- **Id generation (`randomBytes`/`randomHex`).** 16 bytes → 32 hex, 8 bytes → 16 hex via per-byte `padStart(2,'0')` — lengths and lowercasing are correct. The `globalThis.crypto?.getRandomValues` primary path with a `Math.random` fallback faithfully mirrors `resource.ts`'s `newInstanceId` rationale (vitest VM contexts; ids are uniqueness tokens, not secrets). No `core/` → outside-core import introduced; the architecture invariant holds.
- **All-zero rejection.** `isAllZero` uses `/^0+$/`, which rejects *only* the fully-zero id and accepts e.g. `…0001`. This matches the W3C trace-context rule (all-zero is the sole invalid id), and is more correct than a per-byte check would be. The `do…while` retry guarantees a non-zero return.
- **`startSpan` inheritance.** With an active context: same `traceId`, `parentSpanId = active.spanId`, fresh `spanId`, `traceFlags` carried from the active context. At root: new `traceId`, fresh `spanId`, no `parentSpanId`, `traceFlags = 0x01`. Matches the spec exactly. `parentSpanId` correctly lives only on the returned `Span`, never in the stamped `Context` — the most error-prone subtlety, gotten right.
- **`withSpan` discrimination & restore.** `typeof spanOrName === 'object' && spanOrName !== null` cleanly separates an explicit `Span` from `string | undefined`; the latter delegates to `startSpan`. Scope is delegated to `runWithContext`, whose `als.run` restores the prior context on both normal return and throw — so nesting and restore-on-throw need no try/finally in the span module. The new tests exercise nested restore and inner-throw restore and pass.
- **Async transparency.** Returning `runWithContext(...)`'s result verbatim keeps `withSpan` transparent for `Promise`-returning callbacks; ALS carries context across awaits inside `fn` in Node (already proven by `context.node.test.ts`).
- **Public reachability.** Both prior plan reviews flagged that consumers resolve `dist/node.*`, not the core barrel. The fix is in place: `src/node/index.ts` re-exports `startSpan`/`withSpan`/`Span`, and the new dist-level test imports `dist/node.mjs` and asserts the API is present and scopes context correctly. Confirmed the built `dist/node.mjs` carries the exports (test green). `exports.smoke.test.ts` uses presence-style assertions, so the added exports don't break it.

## Findings

No correctness, security, or runtime-breakage findings. The two notes below are optional style observations, not defects.

- **(Optional, style) Mixed barrel vs. direct re-export source in `node/index.ts`.** The span re-exports come from `../core/index.js` (the barrel) while the adjacent context re-exports come from `../core/context.js` (direct). Both resolve correctly and the plan specified the barrel path; harmonizing the source is cosmetic only.
- **(Optional) No structural validation of an explicit `Span`.** `withSpan(obj, fn)` trusts any non-null object as a `Span`; a malformed object would yield a context with `undefined` ids. This is acceptable for a typed API surface (TS enforces the shape at call sites) and matches the spec's intent — noted only for awareness, no change recommended.

## Conclusion

The change implements the milestone's "Done when" precisely: logs inside `withSpan` carry the span's `traceId`/`spanId`, nested spans inherit the trace and restore the parent on exit (and on throw), and ids are valid 32/16-char lowercase non-zero hex. Build, typecheck, and the full test suite are green.

REVIEW_PASS
