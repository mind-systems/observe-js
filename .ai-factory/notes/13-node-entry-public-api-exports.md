# 13 — Node entry must re-export the public API (`init`/`log`/`flush`/`shutdown`)

**Date:** 2026-06-17
**Source:** conversation context (post-implementation review)
**Task:** ROADMAP → Follow-ups → "Node entry: re-export the public API"
**Contract:** `observe-contract@v0.1.2` (Public API & semantics — the uniform `init`/`log`/… surface)
**Depth:** full — small fix, but it is the headline API of the reference SDK, so the regression guard matters.

## Problem today

The package entry `"."` resolves, under Node, to `dist/node.*` (built from `src/node/index.ts`). That module re-exports `__sdk`, the Node context manager, the context functions, `startSpan`/`withSpan`, and the propagation helpers — but **not** `init`, `log`, `flush`, `shutdown`. Verified against the build:

```
require('./dist/node.cjs')  →  init: undefined, log: undefined, flush: undefined, startSpan: function
import('./dist/browser.mjs') →  init: function, log: function
```

So a Node consumer (mind_api, mind_mcp, tradeoxy_core — all NestJS/CJS) doing the documented `import { init, log } from 'observe-js'` gets `undefined`. The SDK's whole purpose — the uniform `init`/`log` surface — is unreachable from the package root on Node. `core` is built to `dist/core.*` but is **not** in the `exports` map, so there is no public path to `init`/`log` either.

`src/browser/index.ts` already re-exports `init` (its browser wrapper) plus `log`/`flush`/`shutdown` from core, so the browser entry is correct; only the node entry is missing them — an asymmetry, not a design choice.

**Why the test suite did not catch it:** `test/conformance.node.test.ts` and `test/smoke.loki.test.ts` import `init`/`log`/`flush` from `'../src/core/index.js'` directly, bypassing the node entry. `test/exports.smoke.test.ts` imports the built `dist/node.mjs`/`dist/browser.mjs` but only asserts the `__sdk` placeholder symbol — it never checks the real public API. The gap sits exactly in the blind spot between those two.

## The change

- In `src/node/index.ts`, add (mirroring `src/browser/index.ts`):
  - `export { init, log, flush, shutdown } from '../core/index.js';`
  - `export type { InitOptions } from '../core/index.js';`
  - `export type { Level } from '../core/index.js';` (the type of `log`'s first argument — consumers need it).
- Node uses **core `init` directly** (no browser-style wrapper) — there is no Node lifecycle glue to add. Do not introduce a node `init` wrapper.

## Regression guard (required — close the blind spot)

Extend `test/exports.smoke.test.ts` so it asserts the **built** entries expose the full public API, not just `__sdk`. Import `dist/node.mjs` and `dist/browser.mjs` and assert `typeof mod[name] === 'function'` for `init`, `log`, `flush`, `shutdown`, `startSpan`, `withSpan`, `inject`, `extract`. This is the test that would have caught the gap; it must run against the dist artifacts (post-build), not the `src/` modules.

## Edge cases / watch

- Do **not** re-export the browser `init` (the beacon/unload wrapper) from the node entry — node must export **core** `init`. Keep the layers from cross-importing (`node/` never imports `browser/`).
- Keep `core` out of the `exports` map — it remains a standalone build check, not a consumed entry; the fix is to surface the API through the node entry, not to publish `core`.
- After the fix, `npm run verify:exports` and `attw --pack .` should still pass unchanged (this only adds named re-exports; the `exports`/types shape is untouched).

## Out of scope

Any change to `package.json` `exports`, the build config, or the contract. No new public symbols beyond what `core` already exports — this is re-export wiring + a test, nothing more.

## Done when

`import { init, log } from 'observe-js'` yields functions under Node (CJS `require` and ESM `import`); `dist/node.*` and `dist/browser.*` both expose the full public API; the extended `exports.smoke` assertions pass against the built artifacts; the rest of the suite stays green.
