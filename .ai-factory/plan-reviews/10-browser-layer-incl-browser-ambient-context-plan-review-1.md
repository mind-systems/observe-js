# Plan Review: Browser layer (incl. browser ambient context)

**Plan:** `10-browser-layer-incl-browser-ambient-context.md`
**Files Reviewed:** plan + 11 source/config files cross-checked
**Risk Level:** 🟢 Low

## Verdict

The plan is solid, codebase-accurate, and architecturally aligned with the contract
(`observe-contract@v0.1.2`), the ARCHITECTURE OTLP boundary rules, and the observe-js ROADMAP
task it implements. Every concrete claim it makes about the existing code was verified and holds.
The findings below are non-blocking improvements (WARN/clarification), not defects.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** PASS. Honors all dependency rules — browser
  layer imports `../core/*` only, never `../node/`; no backend-specific encoding; never-throw export
  path preserved (beacon path routes failures to `onError`); ambient correlation, low-cardinality
  identifying attrs untouched. No Docker, no global patching.
- **Rules (`.ai-factory/RULES.md`):** Not present — WARN (optional file absent, no action needed).
- **Roadmap (`observe-js/.ai-factory/ROADMAP.md`):** PASS. Directly implements the open task
  "Browser layer (incl. browser ambient context)" and conforms to the fixed baseline decisions
  (lightweight explicit context, no `zone.js`, sync+microtask boundary, zero runtime deps, opt-in
  `fetch` propagation). Spec note `notes/10-browser-layer.md` faithfully reflected.
- **Skill-context (`.ai-factory/skill-context/aif-review/SKILL.md`):** Not present — no project
  overrides to apply.

## Verified Assumptions (all correct)

- `init`, `log`, `startSpan`, `withSpan`, `inject`, `extract`, `objectCarrier`, `headersCarrier`,
  `buildResource`, `createExporter`, `encodeLogs`, `createBatcher` are all exported from
  `src/core/index.ts` — confirmed.
- In `src/core/sdk.ts`, `resource` (from `buildResource`) feeds **only** `createExporter` (line 89–90),
  so Task 1's "skip `buildResource` + `createExporter` when an exporter is injected" is safe and
  backward-compatible.
- `package.json` `exports` already routes the `browser` condition to `./dist/browser.{mjs,cjs}` with
  `types`-first ordering; `verify:exports` already imports `dist/browser.mjs` under
  `--conditions=browser`; `tsup.config.ts` already has the `{ entry: { browser: ... }, platform:
  'browser' }` config. No packaging change is needed — confirmed.
- `ContextManager` interface (`active`/`with`/`bind`) and `src/node/context.ts` structure match what
  Task 2 mirrors. `encodeLogs(resource, records)` signature matches Task 4's beacon usage.
  `headersCarrier(headers: Headers)` matches Task 3's usage.
- Test posture confirmed: `vitest.config.ts` is `environment: 'node'`, and `test/context.node.test.ts`
  exists as the per-file module-isolation precedent the browser tests follow. No `jsdom` dependency
  is required.

## Critical Issues

None.

## Findings (non-blocking)

### 1. Name collision in `src/browser/init.ts` — alias the core `init` import (WARN)
The browser wrapper is named `init` and must also call core `init`. Within one module you cannot both
`import { init } from '../core/index.js'` and `export function init(...)`. The implementer must alias,
e.g. `import { init as coreInit, flush, buildResource, createExporter, encodeLogs } from '../core/index.js'`.
The plan implies this ("shadows the core init") but never states the alias explicitly — call it out so
implementation doesn't stumble.

### 2. Double-`init` robustness in the browser wrapper (WARN)
Core `init` no-ops on a second call (first wins), but the browser wrapper does its extra work
*unconditionally*: it builds a beacon exporter and installs `pagehide`/`visibilitychange` listeners
before/around the core call. A second `init()` therefore registers **duplicate** unload listeners and
creates an orphan exporter (discarded by core's no-op). The per-handler idempotency guard in Task 4
prevents harm *within one installation* but not across two installations. Suggest guarding the wrapper
itself (install handlers once) or short-circuiting when already initialized. Low impact, but it slightly
contradicts the "init second-call semantics owned by core" assumption since the wrapper adds new
side effects core doesn't know about.

### 3. `context.browser.test.ts` record-capture hint is slightly off (clarification)
Task 6 suggests "spy the exporter or assert via a captured record" for the "log stamped with span ids"
assertion. Note the browser `init` overrides any consumer-supplied `opts.exporter` with its own beacon
exporter (`core init({ ...opts, exporter })`), so a test **cannot** inject a capture exporter through
browser `init`. The viable path is stubbing `globalThis.fetch` (normal flush path) and inspecting the
POST body, or asserting context purely via `getActiveContext`/`withSpan` without `init`. Worth a one-line
clarification so the test author doesn't try to pass an exporter in.

### 4. `sendBeacon` + `application/json` CORS preflight caveat (watch, out of current scope)
A `Blob` typed `application/json` makes the beacon a non-simple CORS request, which triggers a preflight
that `navigator.sendBeacon` cannot perform — against a cross-origin OTLP endpoint the final flush can
silently fail. For the current **local** Loki target this is fine, and the never-throw contract is
preserved either way. Recommend a one-line comment in `init.ts` noting this is a known limitation of the
beacon final-flush for cross-origin endpoints, so a future reader isn't surprised.

### 5. Node/browser API asymmetry for `flush`/`shutdown` (minor)
Task 1 adds `flush`/`shutdown` to `core/index.ts`, and Task 5 re-exports them from the browser entry,
but `src/node/index.ts` is not updated to expose them. This is acceptable — they're outside the
documented public API (`init`/`log`/`startSpan`/`withSpan`/`inject`/`extract`) — but it leaves a small
cross-platform surface asymmetry. Optional: re-export them from the Node entry too for uniformity, or
explicitly note the omission is intentional.

## Positive Notes

- Correctly identifies the **pluggable-exporter seam** at `init` as the clean way to reuse the single
  buffered queue for the beacon final flush, explicitly avoiding a parallel queue — matches the
  batcher's existing `flush()`/`shutdown()` design.
- The unload flush is effectively synchronous where it matters: `batcher.flush()` runs the drain loop
  synchronously up to the first `await`, and `exportOnce()` does `queue.splice(0)` (single batch), so the
  `sendBeacon` call fires before suspension — the right property for a page-teardown flush.
- Honest, contract-faithful framing of the sync+microtask context boundary, with a dedicated test that
  *codifies* the non-survival across `await` rather than papering over it.
- Strong boundary discipline: core-only imports, no `zone.js`, no global `fetch` patching, tree-shaking
  kept alive via a used-value re-export of `browserContextManager` (mirrors the proven Node pattern under
  `sideEffects: false`).
- Backward compatibility for Node/Winston consumers is preserved (all new `InitOptions` fields optional;
  default path unchanged verbatim).
- Commit plan is sensibly staged (core enabler → browser layer → tests/verify).

PLAN_REVIEW_PASS
