# Plan Review 2: Ambient context — Node (`AsyncLocalStorage`)

**Plan:** `.ai-factory/plans/06-ambient-context-node-asynclocalstorage.md`
**Reviewed against:** `src/core/index.ts`, `src/node/index.ts`, `src/node/winston.ts`, `test/*.test.ts`, `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `.ai-factory/notes/05-ambient-context-node.md`, `.ai-factory/ROADMAP.md`
**Risk Level:** 🟢 Low

## Summary

This is the second-iteration plan, and it has cleanly absorbed every finding from plan-review-1. All five prior issues are now addressed *inline in the task text*, each with a back-reference to the review item it resolves:

- **Issue 1** (no-op missing `bind`) → Task 1 now mandates `bind(_ctx) → () => {}` and explicitly explains why an incomplete object literal fails under `strict` + `verbatimModuleSyntax`.
- **Issue 2** (test must trigger registration) → Task 4 now requires `import '../src/node/index.js'` *before* importing the core free functions, with the no-op rationale spelled out.
- **Issue 3** (`sideEffects: false` vs. side-effecting registration) → promoted to a dedicated Task 5 with a `dist`-level assertion and a concrete fallback (`sideEffects` array) plus a verify-and-fix loop.
- **Issue 4** (number collision) → called out at the top of the file with explicit guidance for the correlation-core plan.
- **Issue 5** (test isolation) → Task 4 keeps the Node context test in its own file and documents the process-global mutation reasoning.

I re-verified the technical claims against the actual codebase and they hold:

- File paths are correct. `src/core/index.ts` and `src/node/index.ts` exist as barrels; `src/core/context.ts` and `src/node/context.ts` are new (correct). `test/context.node.test.ts` follows the existing `test/*.test.ts` convention.
- Barrel style in Task 2 matches `src/core/index.ts` exactly: `export type { … }` for types, `export { … }` for values, `.js` extensions.
- The src-import test pattern is what existing tests use (`import { … } from '../src/core/index.js'` in `batcher.test.ts`/`resource.test.ts`), so Task 4's import strategy is consistent and vitest resolves it.
- The `test` script is `npm run build && vitest run`, so `dist/` exists before vitest runs — Task 5's dist-level assertion and Task 4's reuse of the `exports.smoke.test.ts` dist-reading pattern are both valid.
- `package.json` has `"sideEffects": false` and both tsup configs use `treeshake: true`, so Issue 3's concern is real and the Task 5 mitigation is the right shape.
- Node 18+ baseline (ROADMAP) supports `AsyncLocalStorage.enterWith` / `run` — no version risk.
- Dependency rules honored: `core/context.ts` imports nothing outside `core/`; `node/context.ts` imports `node:async_hooks` + `core/` only, never `browser/`.

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** PASS. Layer boundaries respected; `node:async_hooks` is legitimately the Node layer's concern; no Node global leaks into `core/`.
- **Rules (`.ai-factory/rules/base.md`):** PASS. English-only, barrel conventions, zero new runtime dependencies (uses only the `node:async_hooks` built-in).
- **Roadmap (`ROADMAP.md`):** WARN (acknowledged, non-blocking). The file is `06-…` but implements roadmap/spec **05** ("Ambient context — Node"); roadmap **06** is "Correlation core". The plan flags this prominently and instructs the next plan to avoid the `06` prefix. The milestone's *Done when* ("context propagates across `await`; logs read the active context") is fully covered by Task 4's cases.

## Critical Issues

None. No blocking correctness, security, or architectural defects.

## Minor Issues (non-blocking)

### M1 — Make the type-only re-export explicit in Task 3 (mirror Task 2)
Task 3 instructs `node/index.ts` to "re-export `getActiveContext` / `runWithContext` / `bindContext` / `Context` / `ContextManager` from core" in one breath. `Context` and `ContextManager` are interfaces; under `verbatimModuleSyntax: true` (confirmed in `tsconfig.json`), re-exporting them through a value `export { … }` is a compile error (TS1205) — the same class of failure that Task 1's Issue-1 fix guards against. Task 2 already shows the correct split (`export type { Context, ContextManager }` separate from `export { …functions }`). Recommend Task 3 state the same split explicitly so it isn't implemented as a single mixed `export`. A competent implementer following Task 2's established pattern would likely get this right, hence non-blocking — but spelling it out removes the ambiguity.

## Positive Notes

- Every fix carries a "review Issue N" back-reference, making the iteration auditable against review-1.
- Task 5's verify-and-fix loop (dist assertion first, narrow `sideEffects` array only if stripping is observed) is the right order: it preserves tree-shaking everywhere else and only adds the minimal retention path if the build actually drops the registration. The suggested array `["./dist/node.*", "./src/node/context.ts"]` correctly covers both the package's own rollup build (which processes `src/`) and downstream consumers bundling `dist/`.
- Keeping the dist-level assertion in the same Node context test file is sound — the src-graph and dist-graph `core/context` module instances are separate, so there is no cross-registration interference.
- `with → als.run` mapping satisfies restore-on-return-and-throw without hand-rolled `try/finally`; the `bind`/`enterWith` leak caveat is documented as callback-boundary-only.
- Scope discipline intact: id/span generation deferred to correlation core (task 06), browser impl to task 10.

## Verdict

The plan is solid, well-scoped, faithful to spec note `05-ambient-context-node.md`, and has resolved all prior-iteration findings. The single remaining item (M1) is a non-blocking clarification that the existing Task 2 pattern already models. Approving.

PLAN_REVIEW_PASS
