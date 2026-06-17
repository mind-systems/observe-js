# Plan Review 3 — Correlation core: trace/span ids + `startSpan`/`withSpan`

**Plan:** `07-correlation-core-trace-span-ids-startspan-withspan.md`
**Scope reviewed:** plan fidelity vs. spec note `.ai-factory/notes/06-correlation-core.md`, ROADMAP line 29 + milestone DoD (line 46), `ARCHITECTURE.md` dependency rules, and the current `src/` codebase (`core/context.ts`, `core/resource.ts`, `core/index.ts`, `node/index.ts`, `node/context.ts`, `test/context.node.test.ts`, `test/exports.smoke.test.ts`, `package.json` `exports`).
**Files Reviewed:** 8
**Risk Level:** 🟢 Low — the plan is technically accurate, implementable, and all three findings from review-2 are now resolved in the plan text.

## Context Gates

- **Architecture (PASS):** Task 1 confines `src/core/span.ts` to importing `./context.js` plus `globalThis.crypto`, matching the `resource.ts` precedent and the `core/ → imports nothing outside itself` rule in `ARCHITECTURE.md`. No Node/browser-only globals leak in. ✅
- **Rules / conventions (PASS):** `.js`-suffixed imports, the `export type` / `export` split in the barrel, and the defensive `globalThis.crypto?.…` + `Math.random` fallback all mirror existing code (`resource.ts` `newInstanceId`, `core/index.ts`). English-only respected. ✅
- **Roadmap alignment (PASS):** Maps cleanly to ROADMAP line 29 ("Correlation core"). Scope boundaries (no export/timing/status) match the spec note's "Out of scope" and the milestone baseline. Task 2's Node-entry re-export now satisfies DoD line 46's requirement that the *public surface* expose `startSpan`/`withSpan`. ✅

## Resolution of prior review findings

- **Review-2 Issue 1 (public reachability) — RESOLVED.** Task 2 now explicitly adds `export { startSpan, withSpan } from '../core/index.js';` and `export type { Span } from '../core/index.js';` to `src/node/index.ts`, with a clear rationale tying it to the `package.json` `exports` → `dist/node.*` routing and DoD line 46. Verified against the codebase: `src/node/index.ts` re-exports only a hand-picked subset (not the barrel wholesale) and `package.json` routes the `node`/`import`/`require` conditions to `dist/node.*`, so this re-export is genuinely required for the API to be reachable. Task 3 adds the matching dist-level smoke assertion.
- **Review-2 Issue 2 (test naming) — RESOLVED.** Task 3 now uses `test/span.node.test.ts`, matching the `.node.test.ts` convention established by `context.node.test.ts`.
- **Review-2 Issue 3 (`withSpan` arg widening) — RESOLVED.** The `Span | string | undefined` superset is documented as intentional and instructed to be marked in a comment.

## Critical Issues

None.

## Issues / Recommendations

### 1. `typeof spanOrName === 'object'` admits `null` (minor, implementation note)

The discriminator `typeof spanOrName === 'object'` is correct for the declared type `Span | string | undefined`, but `typeof null === 'object'` — a stray `withSpan(null, fn)` (from loosely-typed JS callers) would be treated as a `Span` and crash on property access. Cheap hardening: `spanOrName !== null && typeof spanOrName === 'object'`, falling through to `startSpan(undefined)` otherwise. Not contract-relevant and the TS type already excludes `null`; mention only so the implementer picks the defensive form.

### 2. Dist-level test must read context through the dist bundle (minor, implementation note)

The new Task 3 "Dist-level public surface" block should call `dist.getActiveContext()` (the dist bundle's own export), not the `src/` one — the bundled module has a *separate* context-manager registry instance, exactly as documented in the existing `context.node.test.ts` dist block. The plan says to mirror that block, so this is already implied; flagging it so the assertion isn't accidentally wired to the `src/` registry (which would read `undefined`).

## Verified Correct (no change needed)

- **`Context` vs `Span` shape:** Plan keeps the ambient `Context` as exactly `{ traceId; spanId; traceFlags }` and `parentSpanId` on the returned `Span` only — matches `src/core/context.ts` exactly. The note in Task 1 about `parentSpanId` not being needed for log stamping is correct.
- **Imports exist:** `getActiveContext()` and `runWithContext()` are exported from `src/core/context.ts` and re-exported by the barrel; Task 1's usage is valid.
- **Restore-on-exit/throw:** Delegating scope to `runWithContext` is correct — `node/context.ts` `als.run` restores on both normal return and throw, so the span module needs no try/finally. Already exercised by `context.node.test.ts`.
- **Id generation & fallback:** `globalThis.crypto.getRandomValues` with a `Math.random` fallback faithfully mirrors `resource.ts`'s rationale (vitest VM contexts; ids are uniqueness tokens, not secrets). `getRandomValues` is present on the Node 18+ main-realm `crypto` global, so the isomorphic claim holds. All-zero rejection is a correct W3C-shape guard.
- **`traceFlags` default `0x01` + carry-from-active:** Matches spec note 06; `Context` carries `traceFlags`, so inheritance is wired correctly.
- **Async transparency:** Returning `fn`'s result keeps `withSpan` transparent for sync and `Promise`-returning callbacks; ALS carries context across awaits inside `fn` in Node.
- **Test coverage:** Task 3's cases (id validity, distinct root trace ids, inheritance inside `withSpan`, nested restore, restore-on-throw, explicit-`Span` acceptance, dist-level public surface) cover the spec's "Done when" plus the documented edge cases. The "import `../src/node/index.js` first" instruction is correct and necessary.

## Positive Notes

- The plan internalized the most error-prone subtlety (ambient `Context` carrying only ids/flags vs. `Span` carrying `parentSpanId`) and is explicit about it.
- The public-reachability fix is now stated at the point the API is introduced, with a precise explanation of *why* (the `exports` routing) rather than a bare instruction — this prevents the API from silently shipping unreachable.
- Defensive id generation, barrel-export conventions, and test registration discipline are all matched to existing proven code rather than reinvented.

## Recommendation

The plan is solid and ready to implement. The two remaining notes are non-blocking implementation hygiene, not plan defects.

PLAN_REVIEW_PASS
