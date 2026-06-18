# Winston transport drops every record — duplicate core singleton across subpath bundles

**Date:** 2026-06-18
**Source:** conversation context — live integration debugging from mind_api → Loki

## Key Findings

- `ObserveTransport` (`observe-js/winston`) silently drops **every** record. In a real consumer (mind_api) only the `service.start` marker reaches Loki — none of the host's `Logger.log(...)` output.
- Root cause is the **bundle layout**, not the source: `tsup.config.ts` emits `node` and `winston` as **separate entries with no code splitting**, so `dist/winston.cjs` bundles its **own duplicate copy** of the core module (`src/core/sdk.ts`) — including the `_initialized` / `_batcher` singletons. `init()` (imported from `observe-js` → `dist/node.cjs`) initializes one copy; `ObserveTransport.log()` (from `observe-js/winston` → `dist/winston.cjs`) reads the **other**, never-initialized copy, hits the `if (!_initialized || _batcher === null) return;` guard, and drops the record. `service.start` survives only because `init()` emits it directly through node.cjs's (initialized) core.
- Because `_initialized`/`_batcher` are provably never assigned inside the isolated winston bundle, esbuild treeshakes the whole body away — `dist/winston.cjs` ships `function log(){ { return; } }`, a literal no-op.
- Fix (**chosen: Option 2 — self-import + `external`**): the `winston` entry imports `log` from the package itself (`import { log } from 'observe-js'`) and `observe-js` is marked `external` for that entry, so `dist/winston.*` no longer inlines core — at runtime it resolves the package's own `dist/node.*` and shares its singleton. Source is otherwise correct (`src/node/winston.ts:18` already imports the real `log`, just via a relative path that gets re-bundled).
- **Impact is family-wide for Node consumers:** every consumer that attaches `ObserveTransport` — mind_api, mind_mcp, tradeoxy_core — loses all transport-routed logs, keeping only `service.start`.

## Details

### Current state

`tsup.config.ts`, Node config:

```ts
{
  entry: { core: 'src/core/index.ts', node: 'src/node/index.ts', winston: 'src/node/winston.ts' },
  platform: 'node',
  format: ['esm', 'cjs'],
  treeshake: true,
  // no `splitting` → each entry is bundled independently
}
```

`src/core/sdk.ts:136` — the real `log` with its init guard:

```ts
export function log(level, msg, attrs) {
  if (!_initialized || _batcher === null) { _onError?.(...); return; }
  ... enqueue ...
}
```

`dist/winston.cjs` evidence: it `require`s only `winston-transport` (no shared core chunk), inlines its own `levels`, and contains `function log(level, msg, attrs) { { return; } }`. `ObserveTransport.log()` calls this no-op.

### The change — Option 2: self-import + `external` (chosen)

Make `node` and `winston` resolve the **same** core module instance at runtime by having the winston entry depend on the package itself instead of re-bundling core:

1. `src/node/winston.ts`: import the runtime `log` from the package, not the relative core path —
   `import { log } from 'observe-js'` and `import type { Level } from 'observe-js'`
   (the type import is erased; only `log` matters at runtime).
2. `tsup.config.ts`: build the winston entry in **its own config object** with `external: ['observe-js']`, so `dist/winston.{cjs,mjs}` emits a bare `require('observe-js')` / `import 'observe-js'` instead of inlining core.

At runtime both subpaths land on the same file:
- CJS consumer (NestJS/`require`): `require('observe-js/winston')` → `dist/winston.cjs`, which `require('observe-js')` → `dist/node.cjs` (same absolute path, same Node require-cache instance) as the host's own `require('observe-js')` → **one `_batcher`**.
- ESM consumer: symmetric via `import`. The condition (`require`/`import`) is inherited from how `winston.*` itself is loaded, so the format stays consistent within the load graph — **no dual-package hazard**.

Invariant: **exactly one `_initialized`/`_batcher` per process**, shared by `observe-js` and `observe-js/winston`.

#### Why not Option 1 (tsup `splitting: true`) — rejected

esbuild code splitting is **ESM-only**; it does not split CJS output. `splitting: true` would fix `dist/winston.mjs` (the format that was never failing) and leave `dist/winston.cjs` with its inlined core copy and the dead `log(){ return; }`. But the failing consumers — mind_api (NestJS, compiled to CJS), tradeoxy_core, mind_mcp — all load `winston.cjs` via `require`. So splitting fixes the wrong format and does not reach the broken one. Rejected.

#### Implementation refinements

- **Isolate `external: ['observe-js']` on the winston entry only** — give it its own tsup config object. Today only `winston.ts` self-imports; `node.ts`/`core.ts` still use the relative `../core`, so the external is harmless to them, but isolating it removes any chance of surprise.
- **Drop the vestigial `core` entry** — after this fix `dist/core.*` is referenced by nothing (`core` is not in the `exports` map; note 01 only ever called it a "standalone build check"). Remove it from `tsup.config.ts` in the same change.

#### Honest limit + fallback (not needed now)

Self-import relies on Node's **runtime** resolution (package self-reference + require-cache identity). That holds for **un-bundled** consumers — NestJS compiled by `tsc` is exactly our case. If a consumer **bundles the SDK itself** into a single file, the duplicate could reappear. The bulletproof fallback (apply only if that surfaces): store the core singleton on `globalThis[Symbol.for('observe-js')]` inside `core/sdk.ts`, which survives any module duplication. Out of scope now — recorded here so the option is known.

### Guards

- Do not "fix" by calling `init()` inside the transport — the contract says the host inits once; duplicating init would create two SDKs.
- Keep the existing public `exports` map and subpath (`./winston`) shape; only how winston resolves core changes.
- **Publish to `main`, no tag bump.** Owner decision (consistent with how `observe-dart` was just handled): push the fix to `observe-js/main` and have all observe-js consumers repin their git-dep from `#v0.1.0` → `main` and reinstall. The Winston bug only affects the Node consumers that attach `ObserveTransport` (mind_api, tradeoxy_core, mind_mcp), but the repin is package-wide — the browser consumers (mind_web, tradeoxy_gui) move to `main` too for consistency. Do **not** cut a new tag.

### Verify

- **Regression guard — cross-bundle test against the built `dist/`.** Import `init`/`flush` from the built node entry and `ObserveTransport` from the built winston entry, stub `globalThis.fetch`, `init(...)`, attach the transport to a **real `winston.createLogger({ transports: [...] })`**, call `logger.info('...')`, `flush()`, and assert the stubbed `fetch` received the record. Two non-negotiables:
  - **Run both formats** — `dist/node.cjs ↔ dist/winston.cjs` (the format that was failing) **and** `dist/node.mjs ↔ dist/winston.mjs`. The `.cjs` pair is the one that reproduced the bug.
  - **Assert an ordinary `logger.info(...)` line lands — not just `service.start`.** That asymmetry (marker yes, logs no) *was* the bug. Drive a real Winston logger, not a direct `ObserveTransport.log()` call, so the test exercises the consumer's actual path.
  - It **must cross the built subpaths**, not import source from one entry — source runs core as a single in-process module and never reproduces the dual-bundle duplicate (which is why conformance + live-smoke passed). This is the same model as the note-13 `exports.smoke` guard.
- Against running Loki from mind_api with `LOG_DESTINATION=both`: a breath session's `[ActivityEngine] Session started …` line appears in Loki under `service_name=mind_api`, not just `service.start`.

## Open Questions

- **Why nothing caught it:** the conformance test (note 11) and live-smoke (note 12) `init` + `log` from a single import graph, so they exercise one core singleton and pass. The bug only manifests when `init` and `ObserveTransport` are loaded as **separate built subpath bundles** in a real consumer. The missing guard is a test that imports across `dist/node.*` and `dist/winston.*` (above).
- The same duplicate-singleton risk applies to any future subpath that touches core state. Confirm `observe-dart` (single bundle) and `observe-swift` (single module) are not structurally exposed.
