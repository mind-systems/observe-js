# Plan Review: Node entry — re-export the public API

**Plan:** `13-node-entry-re-export-the-public-api.md`
**Risk Level:** 🟢 Low

## Verdict
The plan is accurate, well-scoped, and correctly grounded in the codebase. The root-cause diagnosis is verified, the fix is the minimal correct change, and the regression guard targets exactly the blind spot that allowed the gap.

## Verification Against the Codebase

**Premise is real (verified).** `src/node/index.ts` re-exports only `__sdk`, context, span, and propagation symbols — `init`/`log`/`flush`/`shutdown` are absent. The built artifacts confirm the runtime impact: `grep` over `dist/node.mjs` and `dist/node.d.ts` finds no `init`/`log`/`flush`/`shutdown`. So `import { init, log } from 'observe-js'` does resolve to `undefined` for Node/CJS consumers today. The milestone is justified.

**Correct `init` source (verified).** The plan mandates core `init`, not the browser wrapper. This is right: `src/browser/init.ts` wraps core with beacon-exporter + unload-flush registration that depends on `addEventListener`/`navigator`/`document` — browser-only glue that must never enter the Node entry. Node has no init wrapper, so core `init` is the intended public entry. This also respects the dependency rule in `ARCHITECTURE.md`/`base.md` (`node/` → `core/` only; never `browser/`).

**All symbols exist on core (verified).** `src/core/index.ts` exports `init, log, flush, shutdown` (line 51), `InitOptions` (line 50), and `Level` (line 20). No core changes needed, as the plan states.

**No new `exports` entry needed (verified).** `node/index.ts` already re-exports from `'../core/index.js'` (e.g. `startSpan`, `__sdk`), and tsup bundles those into `dist/node.*`. The new re-exports follow the identical, already-working pattern — no `./core` subpath export required.

**Smoke test is safe to run in the Node vitest env (verified).** The eight asserted symbols are all present after the change: node gains `init/log/flush/shutdown` (Task 1) and already has `startSpan/withSpan/inject/extract`; browser already exports all eight. The test only checks `typeof === 'function'` — it never *calls* them — so importing `dist/browser.mjs` under Node stays safe even though the browser `init` references DOM globals (those are inside function bodies, not module top-level). This matches the existing test's note about stub-only browser resolution.

## Minor Notes (non-blocking)

- **`Level` re-export asymmetry.** The plan adds `export type { Level }` to the node entry, but `src/browser/index.ts` does *not* currently re-export `Level`. This is a harmless and arguably useful addition (callers of `log(level, …)` may want the type), but it is a small divergence from the "mirror browser" instruction. Consider also adding `Level` to the browser entry in a future pass for symmetry — not required for this milestone.

- **"types shape untouched" wording (Task 3).** Adding re-exports *does* change the generated `node.d.ts` content (new symbols appear). What stays untouched is the `exports` **map** and module-resolution shape — which is what `attw --pack .` and `verify:exports` actually validate. The plan's expectation that both gates pass unchanged is correct; the phrasing just conflates "type declarations" with "resolution shape." No action needed.

## Architecture / Rules / Roadmap Gates
- **Architecture:** PASS — change keeps `node/ → core/` dependency direction; no browser import introduced.
- **Rules (`base.md`):** PASS — no console output, no host-path throws, no synchronous-`log` violation introduced; purely re-export wiring.
- **Roadmap:** PASS — milestone 13 is an explicit roadmap item; the regression guard aligns with the SDK's "never break the host / uniform public API" contract.

## Positive Notes
- Correctly forbids importing the browser `init` wrapper into the Node entry — the single most likely mistake here.
- The regression guard is placed against the **built `dist/*` artifacts**, not `src/`, which is precisely what would have caught this gap originally.
- Phasing (surface → guard → verify) with explicit dependencies is clean; verification step double-checks both ESM and CJS resolution.

PLAN_REVIEW_PASS
