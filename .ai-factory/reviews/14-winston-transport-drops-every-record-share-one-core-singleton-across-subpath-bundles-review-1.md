# Code Review: Winston transport drops every record — share one core singleton across subpath bundles

**Review 1**
**Scope:** code changes for milestone 14 — `git diff HEAD`
**Files reviewed in full:** `src/node/winston.ts`, `tsup.config.ts`, `tsconfig.json`, `test/winston.node.test.ts`, `test/winston.dist.test.ts`, plus built `dist/winston.{cjs,mjs}`, `src/core/exporter.ts`, `package.json`, `vitest.config.ts`.

## Verdict

**No blocking issues.** The fix is correct, the regression guard genuinely reproduces the original dual-bundle bug, and I verified the result end-to-end against the built output and the full test suite. One undocumented (but sound and necessary) deviation from the plan, and one trivial nit, documented below.

## Verification performed

- **Built output proves the fix.** `dist/winston.cjs` emits `var observeJs = require('observe-js')` and calls `observeJs.log(canonical, msg, …)` — the real shared singleton, not the previously-treeshaken `function log(){ return; }` no-op. `dist/winston.mjs` emits `import { log } from 'observe-js'`. `dist/core.*` is no longer emitted. So the `external: ['observe-js']` self-reference works as intended and core is not re-inlined.
- **Full suite green after a clean build:** `npm test` (which runs `npm run build` first) → 16 files, 148 tests passing, including the migrated `winston.node.test.ts` (13) and the new `winston.dist.test.ts` (2, both CJS and ESM pairs).
- **`npm run typecheck`** clean (against source alone).
- **`npm run verify:exports`** clean — `attw` reports "No problems found 🌟"; both `observe-js` and `observe-js/winston` are 🟢 across node10 / node16-CJS / node16-ESM / bundler.

## Observations

### 1. Undocumented deviation: `tsconfig.json` `paths` mapping was added (sound — and effectively necessary)

The implementation adds, not mentioned in the plan:

```json
"paths": { "observe-js": ["./src/core/index.ts"] }
```

This is correct and worth recording because the plan's own acceptance criterion ("`npm run typecheck` passes against source alone … no `dist/` dependency") was **not** actually achievable without it. The plan reasoned that keeping `import type { Level }` relative removes the dist dependency — but the runtime line `import { log } from 'observe-js'` is a *value* import, and `tsc` still resolves it for `log`'s type signature. Without the `paths` mapping, `tsc --noEmit` would resolve `observe-js` through `package.json` `exports` → `dist/node.d.ts`, reintroducing exactly the build-order dependency the plan wanted to avoid. Mapping `observe-js` → `src/core/index.ts` points the type checker at source, so standalone typecheck works.

Critically, this does **not** re-defeat the runtime fix:
- **esbuild/tsup:** `external: ['observe-js']` takes precedence over the tsconfig `paths` remap, so the winston bundle still emits a bare `require`/`import` (verified directly in `dist/winston.{cjs,mjs}` above), not an inlined copy of core.
- **vitest:** no `vite-tsconfig-paths` plugin is configured, so at test runtime `observe-js` resolves via node/`exports` to `dist/node.*` — the same specifier used by both the test's mock target and the transport, which is why the mock intercepts correctly.

No change requested; flagging only so the divergence is on record.

### 2. Migrated unit test is consistent (no issue)

`test/winston.node.test.ts` now mocks `'observe-js'` and imports `CoreModule` from `'observe-js'` — the same specifier the transport imports `log` from, so the spy intercepts the transport's actual call. Confirmed passing (13/13). This addresses the blocking gap from plan-review-1.

### 3. Dist regression test is well-constructed (no issue)

`test/winston.dist.test.ts` crosses the built subpaths (not source), stubs `fetch` before `init`, drives a **real** `winston.createLogger`, awaits the transport's `logged` event before `flush()` (so the enqueue is guaranteed complete — no race), and asserts the ordinary `'a plain line'` reaches the OTLP body, not only `service.start`. The exporter sends `body = JSON.stringify(encodeLogs(...))` (a string), so the test's `typeof body === 'string'` capture holds. CJS and ESM pairs are correctly isolated as distinct module instances.

## Nit (optional, non-blocking)

- `test/winston.dist.test.ts:31` imports `afterEach` from vitest but never uses it. Harmless (`noUnusedLocals` is not enabled, so typecheck passes) but it is dead code — drop it from the import for cleanliness.

## Conclusion

The change does what the milestone requires: `observe-js` and `observe-js/winston` now share one `_initialized`/`_batcher` per process, ordinary Winston log lines flow through the transport to OTLP, and a built-`dist/` cross-bundle test locks the regression in for both formats. Only the trivial unused-import nit remains.
