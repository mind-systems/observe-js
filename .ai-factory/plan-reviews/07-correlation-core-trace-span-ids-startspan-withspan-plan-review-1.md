# Plan Review — Correlation core: trace/span ids + `startSpan`/`withSpan`

**Plan:** `07-correlation-core-trace-span-ids-startspan-withspan.md`
**Scope reviewed:** plan fidelity vs. spec note `06-correlation-core.md`, the frozen contract (`observe-contract@v0.1.2`), and the existing `src/` codebase.
**Risk Level:** 🟡 Medium — one real surface-area gap to resolve or explicitly defer; everything else is accurate.

## Context Gates

- **Architecture (`core/` imports nothing outside itself):** PASS. Task 1 correctly constrains `src/core/span.ts` to `core/`-only imports (`./context.js`) plus `globalThis.crypto`, mirroring the `resource.ts` precedent. The `node/`/`browser/` layering invariant is respected.
- **Rules / conventions:** PASS. `.js` extension imports, `export type` / `export` separation in the barrel, and the `newInstanceId` defensive-fallback pattern are all matched. English-only output respected.
- **Roadmap alignment:** PASS with note. Maps to ROADMAP line 29 ("Correlation core"). The scope boundaries (no export/timing/status) match the roadmap's "Spans in v0 = correlation core only" decision. See Issue 1 regarding the milestone-level "Verified" criterion (line 46).

## Critical Issues

None that block the task's own "Done when". One gap (Issue 1) should be resolved or explicitly deferred before implementation.

## Issues / Recommendations

### 1. Public API not reachable from the package entries (medium)

Task 2 adds `startSpan`/`withSpan` only to `src/core/index.ts`. But package consumers do **not** import the core barrel — `package.json` `exports` routes them to `dist/node.*` / `dist/browser.*`, built from `src/node/index.ts` and `src/browser/index.ts`. Neither entry re-exports the core barrel wholesale; `src/node/index.ts` re-exports only a hand-picked subset (`__sdk`, `nodeContextManager`, `Context`/`ContextManager`, `getActiveContext`/`runWithContext`/`bindContext`). As written, `startSpan`/`withSpan` will be invisible to anyone consuming the published package — yet the contract lists them as public API and ROADMAP line 46 requires the public surface to expose them.

This does not break the task's narrow "Done when" (the tests in Task 3 import from `src/`), so it is not strictly blocking. But the plan should make a deliberate choice instead of leaving it implicit:
- **Either** add `export { startSpan, withSpan } from '../core/index.js';` and `export type { Span }` to `src/node/index.ts` (and note the browser entry follows in task 10),
- **or** add an explicit sentence deferring the entry re-export to task 08 (Public API: `init` + `log`).

Recommend the first — it keeps the public surface honest and lets a `dist/node.mjs` smoke assertion (consistent with `exports.smoke.test.ts` / the dist-level block in `context.node.test.ts`) cover it. Right now there is no dist-level coverage planned for the new API, which is itself a symptom of this gap.

### 2. Test file naming convention (minor)

Task 3 names the file `test/span.test.ts`, but the test depends on registering the Node `AsyncLocalStorage` manager (`import '../src/node/index.js'`). The established convention for Node-registration-dependent suites is the `.node.test.ts` suffix (`context.node.test.ts`), whose header comment explains the per-file module isolation rationale. Vitest's per-file isolation still holds with any unique filename, so this is cosmetic — but `test/span.node.test.ts` would match the existing signal that "this suite mutates process-global context state."

### 3. `withSpan` signature widened to include `undefined` (minor, acceptable)

Spec note 06 documents `withSpan(spanOrName: Span | string, fn)`. The plan widens the first arg to `Span | string | undefined` so `withSpan(undefined, fn)` delegates to `startSpan(undefined)`. This is a reasonable ergonomic improvement (lets a caller open a fresh root/child span without naming it) and the contract is language-neutral vocabulary, not a literal TS signature — so it is not a contract violation. Worth a one-line note in the implementation that this is an intentional superset of the spec signature.

## Verified Correct (no change needed)

- **`Context` shape understanding:** The plan correctly recognizes that the ambient `Context` is exactly `{ traceId; spanId; traceFlags }` and that `parentSpanId` lives only on the returned `Span`, not in stamped context. This matches `src/core/context.ts` precisely — a common place to get it wrong.
- **Restore-on-exit/throw:** Delegating scope to `runWithContext` is right; `node/context.ts` uses `als.run`, which restores on both normal return and throw, satisfying the nested-restore and restore-on-throw test cases without the span module owning any try/finally.
- **Id generation & fallback:** Sourcing `globalThis.crypto.getRandomValues` with a `Math.random` fallback faithfully mirrors `resource.ts`'s `newInstanceId` rationale (vitest VM contexts; ids are uniqueness tokens, not secrets). All-zero rejection is a correct W3C-shape guard.
- **`traceFlags` default `0x01` + carry-from-active:** Matches spec note 06 §traceFlags and the active-context inheritance rule.
- **Async transparency:** Returning `fn`'s result keeps `withSpan` transparent for `Promise`-returning callbacks; ALS carries context across awaits inside `fn` in Node, consistent with the existing across-await test in `context.node.test.ts`.
- **Test coverage:** Task 3's cases (id validity, new-trace-at-root, inheritance inside `withSpan`, nested restore, restore-on-throw, explicit-`Span` acceptance) cover the spec's "Done when" and the documented edge cases.

## Recommendation

Resolve Issue 1 (add the node-entry re-export now, or state the deferral explicitly) and the plan is ready. Issues 2 and 3 are optional polish.
