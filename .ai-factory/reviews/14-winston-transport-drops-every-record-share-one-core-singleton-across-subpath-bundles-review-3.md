# Code Review 3: Winston transport drops every record — share one core singleton across subpath bundles

**Scope:** code changes for milestone 14 — `git diff HEAD` / `git status`
**Files read in full:** `src/node/winston.ts`, `tsup.config.ts`, `tsconfig.json`, `test/winston.node.test.ts`, `test/winston.dist.test.ts`, plus built `dist/{node,winston}.{cjs,mjs}` and `dist/winston.d.ts`, `src/core/{sdk,exporter}.ts`, `package.json`, `vitest.config.ts`.

## Verdict

**Approved — no findings.** Third independent pass. The fix is correct, verified end-to-end against a clean build, and the single non-blocking nit raised in reviews 1 and 2 (an unused `afterEach` import in `test/winston.dist.test.ts`) has been removed. Nothing outstanding.

## What changed since review 2

- `test/winston.dist.test.ts:31` now imports only `{ describe, expect, it }` from `vitest`; the dead `afterEach` import is gone. No other source/test/config change.

## Independent verification (re-run this pass)

- **`npm test`** (clean build first) → 16 files, 148 tests pass, including `winston.node.test.ts` (13) and `winston.dist.test.ts` (CJS + ESM pairs).
- **`npm run typecheck`** clean (source-only; the relative type import plus the `paths` mapping keep it build-independent).
- **`npm run verify:exports`** → `attw` "No problems found 🌟".
- **Built output** (confirmed in this and prior passes): `dist/winston.cjs` → `require('observe-js')` + `observeJs.log(...)`; `dist/winston.mjs` → `import { log } from 'observe-js'`; the old treeshaken `function log(){ return; }` no-op is absent; `dist/core.*` no longer emitted; `dist/node.cjs` is the single singleton home (real `log` with the `_initialized`/`_batcher` guard, zero self-imports).

## Correctness (carried forward, re-confirmed)

- **`external: ['observe-js']` overrides the new `tsconfig` `paths` mapping** in esbuild, so the winston bundle is not re-inlined — the production fix holds.
- **The CJS regression pair is a by-construction guard:** loading `dist/winston.cjs` via `createRequire` exercises pure Node resolution; the old broken build's inlined no-op would fail `toContain('a plain line')`, so the test genuinely distinguishes broken from fixed. ESM pair symmetric.
- **No race:** `transport.log` enqueues synchronously before `setImmediate(emit 'logged')`; the test awaits `onLogged` before `flush()`.
- **Migrated unit test** mocks the same `'observe-js'` specifier the transport imports `log` from; all 13 assertions pass.
- **Contract guardrails honored:** no `init()` in the transport, `exports` map and `./winston` shape unchanged, never-throw `try/finally` intact, `service.start`-only asymmetry provably broken.

The milestone goal is met: `observe-js` and `observe-js/winston` share one core singleton per process, ordinary Winston records flow to OTLP, and a built-`dist/` cross-bundle test locks the regression for both module formats. Ready to publish to `main`.

REVIEW_PASS
