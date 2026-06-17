# Code Review: Ambient context — Node (`AsyncLocalStorage`)

**Plan:** `.ai-factory/plans/06-ambient-context-node-asynclocalstorage.md`
**Changed code files:** `src/core/context.ts` (new), `src/core/index.ts` (mod), `src/node/context.ts` (new), `src/node/index.ts` (mod), `test/context.node.test.ts` (new)
**Risk Level:** 🟢 Low

## Verification performed

- `npm run typecheck` → clean (`tsc --noEmit`, strict + verbatimModuleSyntax).
- `npm test` (build + vitest) → **52 tests pass**, including the new `test/context.node.test.ts` (6 tests) and the dist-level tree-shaking guard.
- Build emits `dist/node.mjs` / `.cjs` with the context API; the dist registration check passes, so **tree-shaking did not strip `setContextManager(...)`** — no `package.json` `sideEffects` change was needed (Task 5 fallback not triggered).

## Correctness assessment

The implementation matches the plan and spec note `05-ambient-context-node.md` faithfully:

- **No-op default fully implements the interface** (Issue 1 from plan review resolved): `active`/`with`/`bind` all present; `bind` is an explicit no-op. Typecheck confirms assignability.
- **`with` → `als.run`** correctly inherits restore-on-return-and-throw; the throw-restoration test passes.
- **`bind` → `als.enterWith`** with an accurate leak caveat in the comment.
- **Neutral seam** (`getActiveContext`/`runWithContext`/`bindContext`/`setContextManager`) lets `core` read context without importing `node`/`browser`. Registry initialized to the no-op.
- **Dependency rules honored:** `core/context.ts` imports nothing outside `core/`; `node/context.ts` imports only `core/` + `node:async_hooks`, never `browser/`. No import cycle (`node/index → core/index`, `node/index → node/context → core/context`; `core/index → core/context`).
- **Test correctly imports the Node entry first** (Issue 2 resolved) so registration runs before assertions; kept in its own file for module isolation (Issue 5). dist path resolution matches the existing `exports.smoke.test.ts` convention.

No bugs, security issues, or correctness defects found. The two items below are optional, non-blocking observations.

## Non-blocking observations

1. **`bind()` / `bindContext()` is untested.** The `enterWith`-backed path is public API but has zero coverage here. The plan's listed cases didn't require it, and the next milestone (task 07, propagation) is its real consumer — fine to defer, but a single test asserting `bindContext(ctx)` makes `getActiveContext()` return `ctx` within the same async scope would lock in the contract cheaply.

2. **dist-level test depends on a fresh build via the `test` script.** Running `vitest` standalone (e.g. watch mode) would import a stale or missing `dist/node.mjs`. This is acceptable and consistent with `exports.smoke.test.ts`, and is documented in the test header — noted only for awareness.

REVIEW_PASS
