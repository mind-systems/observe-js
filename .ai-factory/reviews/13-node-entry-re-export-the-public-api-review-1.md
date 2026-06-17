# Code Review: Node entry — re-export the public API

**Scope reviewed:** `src/node/index.ts`, `test/exports.smoke.test.ts` (plus the non-code plan/note/roadmap artifacts).
**Result:** Change is correct, minimal, and matches the spec exactly.

## What changed
- `src/node/index.ts` gains three lines re-exporting the public API from **core** (`init`/`log`/`flush`/`shutdown` values, `InitOptions`/`Level` types). No browser import, no `package.json` `exports` change — as required.
- `test/exports.smoke.test.ts` adds a `it.each` block asserting `typeof mod[name] === 'function'` for the eight public functions against both `dist/node.mjs` and `dist/browser.mjs`.

## Correctness verification (runtime, not just diff)
- **All symbols exist on core.** `src/core/index.ts` exports `init/log/flush/shutdown` (line 51), `InitOptions` (line 50), `Level` (line 20). The re-export targets are real.
- **`init` source is correct.** Node re-exports core `init`, not the browser beacon/unload wrapper. The dependency rule (`node/ → core/` only, never `browser/`) is respected.
- **Built artifacts now expose the API (confirmed):**
  - `dist/node.d.ts` re-exports `init, log, flush, shutdown, InitOptions, Level` (plus the pre-existing context/span/propagation symbols) from `./core.js`.
  - `node -e "require('./dist/node.cjs')"` → `init/log/flush/shutdown` all `function`.
- **No type/resolution regression.** `npm run verify:exports` → "No problems found"; `attw --pack .` → all-green for `node10` / `node16` CJS+ESM / `bundler`. The `exports` map shape is untouched, only named re-exports were added.
- **Full suite green.** `npm test` → 15 files, 146 tests pass, including the new `exports.smoke` assertions (13 tests in that file).
- **Browser entry import under Node is safe.** The new test imports `dist/browser.mjs` in the Node vitest env but only checks `typeof`, never invokes — the browser `init`'s DOM references live inside function bodies, not module top-level, so resolution does not touch `window`/`document`. Confirmed by the passing run.

## Notes (non-blocking, no action required)
- The test correctly runs against post-build `dist/*` artifacts (the `test` script builds first), which is precisely the blind spot that let the original gap through. Good placement of the guard.
- Minor asymmetry: the node entry now re-exports `Level` while the browser entry (`src/browser/index.ts`) does not. This is harmless and arguably an improvement (consumers of `log(level, …)` want the type); the smoke test only asserts on the eight functions, so it does not depend on `Level` being present on either entry. Worth aligning the browser entry in a future pass, but out of scope here.

No bugs, security issues, or correctness problems found.

REVIEW_PASS
