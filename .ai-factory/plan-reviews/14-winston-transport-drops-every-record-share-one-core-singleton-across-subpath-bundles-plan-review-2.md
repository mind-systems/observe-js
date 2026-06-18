# Plan Review 2: Winston transport drops every record — share one core singleton across subpath bundles

**Plan:** `14-winston-transport-drops-every-record-share-one-core-singleton-across-subpath-bundles.md`
**Files Reviewed:** plan + `tsup.config.ts`, `package.json`, `tsconfig.json`, `src/node/winston.ts`, `src/node/index.ts`, `src/core/index.ts`, `src/core/sdk.ts`, `src/core/exporter.ts`, `test/winston.node.test.ts`, `test/exports.smoke.test.ts`
**Risk Level:** 🟢 Low

## Verdict

Both blocking items from review-1 are resolved:

1. **Test migration (was BLOCKING)** — Task 3 now explicitly repoints `vi.mock('../src/core/index.js')` and the `CoreModule` import to `'observe-js'`, matching the module the transport imports after Task 1. Correct.
2. **Type-import coupling (was design weakness)** — Task 1 now keeps `import type { Level } from '../core/index.js'` relative and self-imports only the runtime `log`. This correctly removes any `observe-js` reference from `dist/winston.d.ts` and sidesteps the dts build-ordering risk.

The root-cause analysis and the self-import + `external` fix remain sound. I re-verified the runtime resolution: `require('observe-js')` / `import 'observe-js'` from inside `dist/winston.*` resolves via Node/ESM package self-reference (the importing module lives inside the package dir, `name` + `exports` are present) to `dist/node.*` — the same absolute path / require-cache / ESM-cache entry the host loads, so there is exactly one `_batcher`. Dropping the `core` entry is safe; nothing references `dist/core.*` (not in `exports`, `typesVersions`, `verify:exports`, or any test).

I confirmed the API details Task 4 depends on: `init({ project, service, endpoint })` matches `InitOptions` (`src/core/sdk.ts`); `init` constructs the exporter and enqueues the `service.start` marker eagerly; the exporter calls bare `fetch` (`globalThis.fetch`), so stubbing it before `init` is valid; `flush()` drains the batcher.

### Context Gates

- **ARCHITECTURE.md (root):** Fix preserves the OTLP boundary, the frozen public API, the `./winston` subpath shape, and "never break the host." No boundary violation.
- **RULES / CLAUDE.md:** "Publish to `main`, no tag" matches the recorded owner decision and the dart precedent; commit/push gated on explicit go-ahead. No violation.
- **ROADMAP.md:** `fix` milestone — ensure the roadmap entry is linked to this work. WARN (non-blocking).

## Critical Issues

None.

## Should-Fix (non-blocking)

### Task 1 / Task 5: the "typecheck has no dist dependency" claim is inaccurate

Task 1 argues that keeping the type import relative "sidesteps" the `tsc --noEmit` dependency on `dist/`, and Task 5 lists `npm run typecheck passes against source alone (the type import stayed relative, so no dist/ dependency)` as an acceptance criterion.

This is only half-true. `verbatimModuleSyntax` erases the *type* import, so keeping `Level` relative does avoid one coupling — and it genuinely fixes the **dts build-ordering** concern (no `observe-js` ref lands in `dist/winston.d.ts`). But the **value** import `import { log } from 'observe-js'` is *not* erased, and `tsc --noEmit` must still resolve `'observe-js'` to type-check it. With `moduleResolution: "Bundler"` and the package's own `name` + `exports`, that self-reference resolves to `./dist/node.d.ts` (the `import`→`types` condition). There is no `node_modules/observe-js` (it is the root package), so the self-reference is the only resolution path.

Consequence: after this change, `tsc --noEmit` gains a hard dependency on `dist/node.d.ts` existing. On a freshly cleaned tree (`npm run clean` with no subsequent build) `npm run typecheck` would fail with TS2307 "Cannot find module 'observe-js'". This coupling is **inherent to the fix** — you cannot import the runtime `log` from the self-reference without `tsc` resolving the package — so it is not avoidable, but the plan's claim that it is sidestepped is wrong.

In practice it does not break the normal flow: `prepare` (and `npm run build`, `npm test`) all produce `dist/` before typecheck would run, so the criterion is met whenever a build has occurred. The same applies to the migrated `test/winston.node.test.ts`, which now also imports `'observe-js'` and is included in `tsconfig`'s `include`.

**Recommendation:** reword Task 5's criterion to "`npm run typecheck` passes (it now resolves the `observe-js` value self-import to `dist/node.d.ts`, so a prior build must exist — `prepare`/`build`/`test` all produce it)", and drop the "no dist/ dependency" rationale from Task 1. No change to the actual edits — Task 1's instruction (relative type, self-import value) is the right implementation; only the explanation/criterion needs correcting.

## Minor Notes / Verify-During-Implementation

- **Task 3 mock resolution.** Both `vi.mock('observe-js')` and the transport's `import { log } from 'observe-js'` key on the same resolved module id (`dist/node.mjs` via `exports`), so the spy intercepts the transport's call. The retained side-effect import `import '../src/node/index.js'` registers the ContextManager on the *source* core instance (a different module than the mocked built `'observe-js'`), but since `log` is the spy, that mismatch is irrelevant to the assertions — harmless to keep. Confirm `vi.mock('observe-js', { importOriginal })` wraps the built module cleanly, as the plan already flags.
- **Task 4 write timing.** The plan does `logger.info(...)` then `await flush()`. winston-transport's `_write` invokes `transport.log` synchronously within `logger.info()`, so the `_batcher.enqueue` happens before `flush()` snapshots the queue (the `'logged'` event fires later via `setImmediate`, which is why the unit test awaits it). The sequence is safe as written; if the assertion ever flakes, gate the `flush()` on the transport's `'logged'` event.
- **Task 4 fetch-stub rationale.** Stubbing before `init` is correct, but note the exporter references `fetch` at *call* time inside its export closure (not bound at construction), so any time before `flush()` would also work. The plan's order is fine; the stated reason ("binding the send path at init time") is slightly imprecise.
- **Task 4 body scan.** `service.start` and the `logger.info` line may land in the same batch or separate POSTs; assert across *all* captured request bodies for the plain line, not just the first.
- **`external` scoping (Task 2).** `external: ['observe-js']` on the winston object matches the bare `.` specifier exactly and does not interfere with the browser/node objects (`external: []`). Keeping `clean: false` on all three is correct since the `build` script owns cleaning. Good.

## Positive Notes

- Both review-1 blockers are addressed precisely and with correct reasoning about why each edit is needed.
- The dist regression test targets exactly the gap that let the bug through: crosses **built** subpath bundles, drives a **real** Winston logger, asserts an ordinary line lands (not only `service.start`), and runs **both** `.cjs` and `.mjs` pairs.
- Contract guardrails honored: no `init()` inside the transport, `exports` map and `./winston` shape unchanged, host-inits-once invariant preserved.
- The `globalThis[Symbol.for('observe-js')]` fallback is correctly scoped out (only needed for self-bundling consumers; the NestJS/`tsc` consumers resolve `observe-js` un-bundled).

---

The remaining item is a non-blocking wording correction; the implementation steps are all correct.

PLAN_REVIEW_PASS
