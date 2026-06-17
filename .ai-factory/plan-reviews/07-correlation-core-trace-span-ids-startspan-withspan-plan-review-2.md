# Plan Review 2 — Correlation core: trace/span ids + `startSpan`/`withSpan`

**Plan:** `07-correlation-core-trace-span-ids-startspan-withspan.md`
**Scope reviewed:** plan fidelity vs. spec note `notes/06-correlation-core.md`, ROADMAP line 29 + milestone DoD, `ARCHITECTURE.md` dependency rules, and the current `src/` codebase (`core/context.ts`, `core/resource.ts`, `core/index.ts`, `node/index.ts`, `test/context.node.test.ts`).
**Risk Level:** 🟡 Medium — the plan is technically accurate and implementable; one carried-over public-reachability gap from review-1 is still unresolved in the plan text and should be addressed or explicitly deferred before implementation.

## Context Gates

- **Architecture — `core/` imports nothing outside itself (PASS):** Task 1 constrains `src/core/span.ts` to `./context.js` plus `globalThis.crypto`, matching the `resource.ts` precedent and the `core/ → nothing outside itself` rule in `ARCHITECTURE.md`. No Node/browser globals leak in. ✅
- **Rules / conventions (PASS):** `.js`-suffixed imports, the `export type` / `export` split in the barrel, and the defensive `globalThis.crypto?.…` + `Math.random` fallback all match existing code (`resource.ts` `newInstanceId`, `index.ts`). English-only respected.
- **Roadmap alignment (PASS with note):** Maps to ROADMAP line 29 ("Correlation core"). Scope boundaries (no export/timing/status) match the "Spans in v0 = correlation core only" baseline decision (line 15). The milestone DoD (line 46) requires the *public surface* to expose `startSpan`/`withSpan` — see Issue 1, which is about that DoD criterion, not this task's narrow "Done when".

## Critical Issues

None block the task's own "Done when" (the Task 3 tests import from `src/`, so they pass with the core barrel export alone).

## Issues / Recommendations

### 1. Public API still not reachable from the package entries — carried over from review-1, unresolved (medium)

Review-1 (Issue 1) raised this and recommended resolving it; the plan text is unchanged. Task 2 adds `startSpan`/`withSpan`/`Span` only to `src/core/index.ts`. But consumers never import the core barrel — `package.json` `exports` routes them to `dist/node.*` / `dist/browser.*`, built from `src/node/index.ts` / `src/browser/index.ts`. I confirmed `src/node/index.ts` re-exports only a hand-picked subset (`__sdk`, `nodeContextManager`, `Context`/`ContextManager`, `getActiveContext`/`runWithContext`/`bindContext`) — it does **not** wholesale-re-export the core barrel. So as written, `startSpan`/`withSpan` are invisible to anyone consuming the published package.

Critically, no downstream task is guaranteed to fix this: ROADMAP task 08 ("Public API: `init` + `log`") is scoped to `init`/`log` record-building, not to wiring `startSpan`/`withSpan` into the entries; tasks 09 (Winston) and 10 (browser) don't cover the Node entry's span surface either. For the *reference* SDK, where DoD line 46 makes the reachable public surface explicit, this risks silently shipping an unreachable API.

Recommendation (pick one, state it in the plan):
- **Preferred:** extend Task 2 to also add `export { startSpan, withSpan } from '../core/index.js';` and `export type { Span } from '../core/index.js';` to `src/node/index.ts`, and add a dist-level smoke assertion (mirroring `exports.smoke.test.ts` / the `dist/node.mjs` block in `context.node.test.ts`) that `dist/node.mjs` exports `startSpan`/`withSpan`. This keeps the public surface honest at the point the API is introduced.
- **Or:** add one explicit sentence deferring the entry re-export (and its dist coverage) to task 08, so the deferral is a deliberate decision rather than an omission.

### 2. Test file naming convention (minor)

Task 3 names the file `test/span.test.ts`, but the suite registers the Node `AsyncLocalStorage` manager via `import '../src/node/index.js'` (i.e. it mutates process-global context state). The established signal for such suites is the `.node.test.ts` suffix (`context.node.test.ts`, whose header documents the per-file isolation rationale). Vitest's per-file isolation holds regardless of filename, so this is cosmetic — but `test/span.node.test.ts` matches the existing convention.

### 3. `withSpan` arg widened to `Span | string | undefined` (minor, acceptable)

Spec note 06 documents `withSpan(spanOrName: Span | string, fn)`; the plan widens to `… | undefined` so `withSpan(undefined, fn)` delegates to `startSpan(undefined)`. This is a reasonable ergonomic superset, and the contract is vocabulary/semantics, not a literal TS signature — not a contract violation. Worth a one-line comment marking it an intentional superset. (Implementation note: discriminating `Span` from `string`/`undefined` is a trivial `typeof spanOrName === 'object'` check; not a plan-level concern.)

## Verified Correct (no change needed)

- **`Context` shape:** Plan correctly treats the ambient `Context` as exactly `{ traceId; spanId; traceFlags }` and keeps `parentSpanId` on the returned `Span` only — matches `src/core/context.ts` exactly.
- **Imports exist:** `getActiveContext()` and `runWithContext()` are both exported from `src/core/context.ts` and re-exported by the barrel; the Task 1 usage is valid.
- **Restore-on-exit/throw:** Delegating scope to `runWithContext` is correct — `node/context.ts` `als.run` restores on both normal return and throw, satisfying the nested-restore and restore-on-throw cases without the span module owning try/finally. The existing `context.node.test.ts` already exercises this guarantee.
- **Id generation & fallback:** `globalThis.crypto.getRandomValues` with a `Math.random` fallback faithfully mirrors `resource.ts`'s rationale (vitest VM contexts; ids are uniqueness tokens, not secrets). All-zero rejection is a correct W3C-shape guard.
- **`traceFlags` default `0x01` + carry-from-active:** Matches spec note 06 and the active-context inheritance rule; `Context` carries `traceFlags`, so inheritance is wired correctly.
- **Async transparency:** Returning `fn`'s result keeps `withSpan` transparent for `Promise`-returning callbacks; ALS carries context across awaits inside `fn` in Node (already covered by `context.node.test.ts`).
- **Test coverage:** Task 3's cases (id validity, new-trace-at-root with distinct trace ids, inheritance inside `withSpan`, nested restore, restore-on-throw, explicit-`Span` acceptance) cover the spec's "Done when" and documented edge cases. The "import `../src/node/index.js` first" instruction is correct and necessary — without it the no-op manager makes nesting assertions vacuous.

## Positive Notes

- The plan internalized the most error-prone subtlety (ambient `Context` vs. `Span` carrying `parentSpanId`) and is explicit about it.
- Defensive id generation and barrel-export conventions are matched to existing code rather than reinvented.
- Test plan reuses the registration discipline and dist-vs-src isolation reasoning already proven in `context.node.test.ts`.

## Recommendation

Resolve Issue 1 — add the Node-entry re-export (preferred) or explicitly state the deferral to task 08 — and the plan is ready to implement. Issues 2 and 3 are optional polish. Because the review-1 finding remains unaddressed in the plan text, this review does not pass.
