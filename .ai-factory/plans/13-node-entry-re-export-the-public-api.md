# Plan: Node entry — re-export the public API

## Context
The package root `"."` resolves under Node to `dist/node.*` (built from `src/node/index.ts`), which omits `init`/`log`/`flush`/`shutdown`, so `import { init, log } from 'observe-js'` is `undefined` for NestJS/CJS consumers. This milestone surfaces the full public API through the node entry and adds a built-artifact regression guard so the gap can never recur.

## Settings
- Testing: yes (regression guard required by the spec)
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Surface the public API on the node entry

- [x] **Task 1: Add the missing public-API re-exports to `src/node/index.ts`**
  Files: `src/node/index.ts`
  Mirror the relevant lines from `src/browser/index.ts`, but use **core** `init` (node has no init wrapper — never import from `browser/`):
  - `export { init, log, flush, shutdown } from '../core/index.js';`
  - `export type { InitOptions } from '../core/index.js';`
  - `export type { Level } from '../core/index.js';`
  Do **not** re-export the browser `init` wrapper, `createBeaconExporter`, or any other browser-only symbol. Do **not** add `core` to `package.json` `exports`. Keep the existing `__sdk`, context, span, and propagation re-exports as-is. `core/index.ts` already exports all four functions plus `InitOptions` and `Level`, so no core changes are needed.

### Phase 2: Close the regression blind spot

- [x] **Task 2: Extend `test/exports.smoke.test.ts` to assert the full public API on the built artifacts** (depends on Task 1)
  Files: `test/exports.smoke.test.ts`
  Add a test block that dynamically imports the built `dist/node.mjs` and `dist/browser.mjs` and asserts `typeof mod[name] === 'function'` for each of: `init`, `log`, `flush`, `shutdown`, `startSpan`, `withSpan`, `inject`, `extract`. Run the same assertion set against both entries (e.g. `it.each` over the two dist paths). Keep the existing `__sdk` and dist-artifact-existence assertions. This must run against the post-build `dist/*` artifacts (the `test` script already runs `npm run build` first), not the `src/` modules — that is precisely the blind spot the current suite leaves open.

### Phase 3: Verify

- [x] **Task 3: Confirm the full suite and export gates stay green** (depends on Task 2)
  Files: (none — verification only)
  Run `npm test` (builds then runs the extended smoke test plus the existing suite), `npm run verify:exports`, and `attw --pack .`. The `exports`/types shape is untouched, so `verify:exports` and `attw` must pass unchanged; the new smoke assertions must pass against `dist/node.*` and `dist/browser.*`. Sanity-check the headline outcome both ways: `require('./dist/node.cjs').init` and the ESM `import { init, log } from` the node entry both yield functions.
