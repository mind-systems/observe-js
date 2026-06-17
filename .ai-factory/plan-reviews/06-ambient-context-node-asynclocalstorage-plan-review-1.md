# Plan Review: Ambient context — Node (`AsyncLocalStorage`)

**Plan:** `.ai-factory/plans/06-ambient-context-node-asynclocalstorage.md`
**Reviewed against:** `src/core/`, `src/node/`, `.ai-factory/notes/05-ambient-context-node.md`, `.ai-factory/ROADMAP.md`, `.ai-factory/ARCHITECTURE.md`, `package.json`, `tsup.config.ts`
**Risk Level:** 🟡 Medium

## Summary

The plan is faithful to spec note `05-ambient-context-node.md`: the `Context` / `ContextManager` shapes, the neutral free-function seam (`getActiveContext` / `runWithContext` / `bindContext` / `setContextManager`), the no-op default, and the `AsyncLocalStorage` Node impl all match the recommended design. It respects the dependency rules (`core/` → nothing; `node/` → `core/` only). File paths are correct: `src/core/context.ts`, `src/core/index.ts`, `src/node/context.ts`, `src/node/index.ts`, and `test/` all exist as targeted. No tsup config change is needed — the new modules are pulled transitively into the existing `core` and `node` entries via the barrels, which the plan correctly does not touch.

The issues below are gaps, not architectural mistakes.

## Context Gates

- **Architecture (`ARCHITECTURE.md`):** PASS. The plan honors all dependency rules; `node/context.ts` importing `node:async_hooks` is explicitly the Node layer's job. No `core/` → Node-global leak.
- **Rules:** PASS. English-only, barrel style (`export type` for types, `.js` extensions) matches existing `core/index.ts`. No `.ai-factory/RULES.md` present.
- **Roadmap (`ROADMAP.md`):** WARN — see Issue 4 (numbering). The milestone "Ambient context — Node (`AsyncLocalStorage`)" and its *Done when* are fully covered.

## Critical Issues

None that block correctness of the design. The following are real gaps that will surface as compile errors or test failures if implemented literally.

### Issue 1 — No-op `ContextManager` is missing `bind()` (will not satisfy the interface)
Task 1 specifies the default no-op manager only by `active()` (returns `undefined`) and `with(ctx, fn)` (calls `fn()`). The `ContextManager` interface also declares `bind(ctx): void`. With `strict` + `verbatimModuleSyntax` TypeScript, an object literal missing `bind` will not be assignable to `ContextManager` and the build/typecheck will fail. **Fix:** state that the no-op `bind` is a no-op (`() => {}`) so the default object fully implements the interface.

### Issue 2 — Task 4 test will fail unless it imports the Node entry for its registration side effect
The test imports `getActiveContext` / `runWithContext` from `core/`. Until some platform layer calls `setContextManager`, the active manager is the **no-op**, whose `with` just calls `fn()` and whose `active()` returns `undefined`. So the core assertion ("context visible across `await` inside the scope") will fail with the no-op still installed. The test must first import the Node entry (`../src/node/index.js`, or `../src/node/context.js`) so registration runs. The plan implies this but never states it — call it out explicitly in Task 4, otherwise the test is written against the no-op and fails.

## Suggestions (non-blocking)

### Issue 3 — `"sideEffects": false` conflicts with side-effect registration (latent, won't be caught by the planned test)
`package.json` declares `"sideEffects": false` and both tsup and Rollup run with `treeshake: true`. The whole mechanism depends on a module-level `setContextManager(...)` call running when the Node entry is imported. Re-exporting the manager from `node/index.ts` (as the plan suggests) keeps the *module* in the graph, but a tree-shaker told the package is side-effect-free may still drop a top-level call whose return value is unused. Two consequences worth pre-empting:
- The planned test runs against `src/` via vitest, so it would **not** catch a tree-shaking regression in the built `dist/`. The existing `exports.smoke.test.ts` only checks `__sdk`.
- **Mitigations to consider in the plan:** make `node/index.ts` *use* the registered value (e.g. export the singleton it registered, which the plan already does) and/or add a `dist`-level assertion that after importing `dist/node.mjs`, `getActiveContext` inside `runWithContext` actually sees the context. If tree-shaking proves to strip it, list the context module path under a `sideEffects` array. At minimum, note this risk so it is verified against the built output, not only `src/`.

### Issue 4 — Plan number collides with the next roadmap task
This plan implements roadmap/spec **05** ("Ambient context — Node"), but the file is named `06-…`. Spec/roadmap **06** is "Correlation core". The next plan for correlation core will naturally also want "06", causing collision/confusion. Consider renaming to `05-…` to match the spec note, or be aware the correlation-core plan must avoid the `06` prefix.

### Issue 5 — Minor: confirm test isolation expectation
Registration mutates process-global module state in `core/context.ts`. vitest isolates modules per test file by default, so this is fine, but if a future combined test imports both Node and browser entries in one file, the last `setContextManager` wins. Not in scope here — just keep the Node context test in its own file (the plan already does: `test/context.node.test.ts`).

## Positive Notes

- Correct, minimal seam: free functions for `core` consumers + `ContextManager` interface per platform — exactly the spec's intent and what tasks 06/08/10 need.
- `with` → `als.run` mapping correctly satisfies restore-on-return-and-throw without custom try/finally.
- Good judgment documenting `bind`/`enterWith` as callback-boundary-only with a leak caveat.
- Test cases map 1:1 to the milestone's *Done when* (across-await visibility, restore after scope, restore on throw, undefined outside scope).
- No over-reach: span/id generation and browser impl correctly deferred to tasks 06/10.

## Verdict

The design is sound and well-scoped, but Issue 1 (no-op missing `bind` → compile error) and Issue 2 (test must import the Node entry → otherwise fails) are concrete defects that will bite during implementation. Address those two and acknowledge the `sideEffects: false` risk (Issue 3) before implementing.
