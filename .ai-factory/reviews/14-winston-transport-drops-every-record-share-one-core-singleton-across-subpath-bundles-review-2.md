# Code Review 2: Winston transport drops every record — share one core singleton across subpath bundles

**Scope:** code changes for milestone 14 — `git diff HEAD` / `git status`
**Files read in full:** `src/node/winston.ts`, `tsup.config.ts`, `tsconfig.json`, `test/winston.node.test.ts`, `test/winston.dist.test.ts`, plus built `dist/{node,winston}.{cjs,mjs}`, `dist/winston.d.ts`, `src/core/exporter.ts`, `src/core/sdk.ts`, `package.json`, `vitest.config.ts`.

## Verdict

**Correct. No blocking issues.** This is an independent second pass; I re-ran a clean build and the full verification matrix rather than trusting the diff. The fix lands exactly as designed and the regression guard genuinely fails on the old build / passes on the new. One trivial, non-blocking nit (unused import).

## Independent verification

- **Clean `npm run build`** → all entries emit; `dist/core.*` is gone (0 artifacts).
- **`dist/winston.cjs`**: `var observeJs = require('observe-js')` and `observeJs.log(canonical, msg, …)`. The previously-treeshaken `function log(){ return; }` no-op is **absent**.
- **`dist/winston.mjs`**: `import { log } from 'observe-js'` and `log(canonical, msg, …)`.
- **`dist/node.cjs`** is the single singleton home: contains the real `log` with `if (!_initialized || _batcher === null) …`, `_batcher.enqueue(...)`, and `init()` setting `_initialized = true`. It has **zero** `require('observe-js')` self-imports — core is bundled into the node entry, and winston resolves *to* it. This is the intended topology: one `_initialized`/`_batcher`, owned by `node.*`, shared by `winston.*`.
- **`dist/winston.d.ts`**: no `observe-js` self type-import (the only `observe-js` hit is prose in a doc comment), so `attw` has nothing to choke on.
- **`npm run typecheck`** clean.
- **`npx vitest run`** → 16 files, 148 tests pass, including `winston.node.test.ts` (13) and `winston.dist.test.ts` (2: CJS + ESM).
- **`npm run verify:exports`** → `attw` "No problems found 🌟".

## Correctness analysis (beyond re-running)

- **`external` vs the new `tsconfig` `paths` mapping.** `tsconfig.json` adds `paths: { "observe-js": ["./src/core/index.ts"] }` (undocumented in the plan). The real risk this raises — esbuild honoring `paths` and re-inlining core into the winston bundle — does **not** occur: `external: ['observe-js']` wins, and the built `dist/winston.{cjs,mjs}` carry a bare `require`/`import` (verified above). The mapping serves a legitimate purpose: the *value* import `import { log } from 'observe-js'` needs a type for `log`, so without the mapping `tsc` would resolve `observe-js` through `package.json exports` → `dist/node.d.ts` and couple standalone `typecheck` to a prior build. Pointing it at source keeps typecheck build-independent. Sound.
- **The CJS regression pair is a bulletproof guard.** `winston.dist.test.ts` loads `dist/winston.cjs` via `createRequire(import.meta.url)` — pure Node CJS resolution, outside Vitest's transform graph. Its internal `require('observe-js')` self-resolves to the same `dist/node.cjs` absolute path already in the require cache, so they share one `_batcher`. Decisively: the *old* broken `winston.cjs` had the inlined `function log(){ return; }` baked into the file body — loading it here would call the no-op, drop the record, and the `expect(...).toContain('a plain line')` assertion would **fail**. So the test distinguishes broken from fixed by construction, independent of any Vitest resolver nuance. The ESM pair is symmetric.
- **No race in the dist test.** `transport.log` enqueues synchronously, *then* `setImmediate(emit 'logged')`; the test awaits `onLogged` before `flush()`, so the record is guaranteed enqueued before the export. Body is `JSON.stringify(...)` (string), matching the stub's `typeof body === 'string'` capture.
- **Migrated unit test is consistent.** `winston.node.test.ts` mocks `'observe-js'` and imports `CoreModule` from `'observe-js'` — the same specifier the transport imports `log` from, so `vi.mocked(CoreModule.log)` intercepts the actual call. Vitest applies no `tsconfig` `paths` (no `vite-tsconfig-paths` plugin), so both resolve identically to `dist/node.*`; the 13 assertions pass unchanged.
- **Contract guardrails honored.** No `init()` inside the transport; `package.json` `exports` map and the `./winston` subpath shape unchanged; never-throw `try/finally` in `ObserveTransport.log` intact; `service.start`-only asymmetry now provably broken (ordinary line lands).

## Nit (non-blocking)

- `test/winston.dist.test.ts:31` imports `afterEach` from `vitest` but never uses it (the suite uses `try/finally` + `restore()`). Dead import — `noUnusedLocals` is off so it passes, but it should be dropped for cleanliness.

## Conclusion

The milestone goal is met and verified end-to-end: `observe-js` and `observe-js/winston` share one core singleton per process, ordinary Winston records flow through the transport to OTLP, and a built-`dist/` cross-bundle test locks the regression for both module formats. Only the trivial unused-import nit remains; nothing blocks publishing to `main`.
