# Plan Review: Winston transport drops every record — share one core singleton across subpath bundles

**Plan:** `14-winston-transport-drops-every-record-share-one-core-singleton-across-subpath-bundles.md`
**Files Reviewed:** plan + `tsup.config.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/node/winston.ts`, `src/node/index.ts`, `src/core/index.ts`, `src/core/sdk.ts`, `test/winston.node.test.ts`, `test/exports.smoke.test.ts`
**Risk Level:** 🟡 Medium

## Verdict

The root-cause analysis is correct and the chosen fix (self-import + `external`) is sound. The runtime resolution story checks out: `require('observe-js')` / `import 'observe-js'` from inside `dist/winston.*` resolves via Node/ESM **package self-reference** to `dist/node.*` (same absolute path → same require-cache / ESM-cache instance → one `_batcher`), both in real consumers and in the proposed `dist/` test. Dropping the `core` entry is safe — I verified nothing references `dist/core.*` at runtime (only historical notes/reviews mention it; it is not in the `exports` map, `typesVersions`, `verify:exports`, or any test).

However, there is **one blocking gap** and **one design weakness** the plan must address before implementation.

### Context Gates

- **ARCHITECTURE.md (root):** Fix preserves the OTLP boundary, the frozen public API, the `./winston` subpath shape, and "never break the host." No boundary violation. WARN: none.
- **RULES / CLAUDE.md:** "Publish to `main`, no tag" matches the owner decision recorded in note 14 and the dart precedent. Commit/push only on explicit go-ahead — plan honors this. No violation.
- **ROADMAP.md:** Modified (untracked plan/note alongside). This is a `fix` milestone; ensure the roadmap entry is linked. WARN (non-blocking).

---

## Critical Issues

### 1. Existing `test/winston.node.test.ts` will break — no migration step (BLOCKING)

This is the biggest omission. `test/winston.node.test.ts` mocks the SDK via:

```ts
vi.mock('../src/core/index.js', async (importOriginal) => { ... log: vi.fn() });
import * as CoreModule from '../src/core/index.js';
import { ObserveTransport } from '../src/node/winston.js';
const logSpy = vi.mocked(CoreModule.log);
```

All of its assertions (level mapping, attr forwarding, never-throw) depend on `logSpy` being the function the transport actually calls.

After **Task 1**, `src/node/winston.ts` imports `log` from `'observe-js'`, **not** `'../core/index.js'`. There is no vitest alias (`vitest.config.ts` has none), so `'observe-js'` resolves through `package.json` `exports` to `dist/node.mjs`. Consequences:

- The `vi.mock('../src/core/index.js')` mock no longer intercepts the transport's `log` — the transport calls the real `log` inside `dist/node.mjs`. `logSpy` is never called → **every assertion in `winston.node.test.ts` fails** (`toHaveBeenCalledOnce` etc.).
- Worse, if `vitest` is ever run without a prior build, `'observe-js'` is unresolvable and the file fails to import at all. (`npm test` builds first, so this only bites direct `vitest` runs — but the assertion failures bite regardless.)

The plan adds a new dist test (Task 3) but says nothing about the existing unit test, and Task 1 says "leave the rest of the file untouched." **Add an explicit task** to migrate `test/winston.node.test.ts`: change the mock target and `CoreModule` import from `'../src/core/index.js'` to `'observe-js'`, so the spy is installed on the same module the transport now imports. Verify `vi.mock('observe-js')` with `importOriginal` works against the built self-reference (it should, since the suite builds first). Without this, Task 4's "`npm test` passes" acceptance criterion is unmeetable.

---

## Design Weakness (should fix, not strictly blocking)

### 2. Changing the *type* import to `'observe-js'` adds an unnecessary dist-coupling to `typecheck`

Task 1 changes **both** imports to `'observe-js'`:

```ts
import type { Level } from 'observe-js';
import { log } from 'observe-js';
```

Only the **runtime** `log` binding needs to come from the package self-reference. `verbatimModuleSyntax` is enabled, so `import type { Level }` is fully erased before bundling — keeping it relative does **not** re-inline core. But routing the type through `'observe-js'` means `tsc --noEmit` must resolve `observe-js` → `dist/node.d.ts`, which only exists after a build. So `npm run typecheck` silently gains a hard dependency on `dist/` being present (today it runs against source alone). Task 4 happens to build first, so it passes there, but standalone typecheck / CI lint stages will now fail with a confusing "cannot find module 'observe-js'" until something builds dist.

**Recommendation:** keep the type import relative and self-import only the value:

```ts
import type { Level } from '../core/index.js';
import { log } from 'observe-js';
```

Bonus: this also removes any `observe-js` reference from `dist/winston.d.ts`, sidestepping concern 3 below entirely (no self type-import for `attw`/dts to resolve), and keeps the relative-import mock surface intact (relevant to issue 1 if you choose to keep mocking `Level`-adjacent core there).

---

## Minor Notes / Verify-During-Implementation

- **tsup dts build ordering (Task 2).** Splitting winston into its own config object with `dts: true` means its declaration build must resolve `import type { Level } from 'observe-js'` → `dist/node.d.ts`. Within a single `tsup` array run the configs may build concurrently, so `node.d.ts` may not exist when winston's dts emits. With `external: ['observe-js']` the dts plugin should preserve the bare import without resolving file contents, but this is unverified. Applying recommendation 2 (relative type import) eliminates the risk. If you keep the self type-import, explicitly confirm `dist/winston.d.ts` builds and that `verify:exports` (`attw`) does not flag the self-import.
- **fetch stub ordering (Task 3) — correct as written.** `init()` constructs the exporter eagerly, so the OTLP send path is bound at init time. The plan's order (stub `globalThis.fetch` → `init` → `logger.info` → `flush`) is the right sequence; keep it. Assert against the request body the stub captured.
- **cjs/mjs isolation (Task 3) — already safe.** `dist/node.cjs` and `dist/node.mjs` are distinct module instances with independent `_initialized`/`_batcher`, so the two format cases cannot bleed singleton state across each other. The plan's "reset between cases" is still worth doing for the `fetch` stub, but no extra teardown is needed for SDK state across formats. (Within a single format, the second `init` would be a first-wins no-op — fine since each format inits once.)
- **New test file name.** `test/winston.dist.test.ts` is appropriate; unlike `*.node.test.ts` it loads from `dist/` and does not rely on the side-effect Node context-manager registration, so the differing suffix is correct.
- **Self-reference reproduction in the dist test — confirmed valid.** Loading `dist/winston.cjs` via `createRequire(import.meta.url)` and `dist/node.cjs` separately works because winston.cjs's internal `require('observe-js')` self-resolves to the same `dist/node.cjs` absolute path → shared require-cache entry. The ESM pair is symmetric via resolved-URL identity. The test genuinely reproduces the consumer's dual-bundle path. Good.

## Positive Notes

- Root cause (independent per-entry bundling → duplicate treeshaken `log(){ return; }` in `winston.cjs`) is accurately diagnosed and matches the `tsup.config.ts` layout (`entry` map, no `splitting`).
- Correctly rejects `splitting: true` (esbuild splits ESM only; the failing consumers load `.cjs`).
- Test mandate targets exactly the gap that let the bug through: crosses **built** subpath bundles, drives a **real** Winston logger, asserts an ordinary line lands (not just `service.start`), and runs **both** format pairs.
- Honors the contract guardrails: no `init()` inside the transport, `exports` map and `./winston` shape unchanged, host-inits-once invariant preserved.
- Out-of-scope `globalThis[Symbol.for('observe-js')]` fallback is correctly deferred (only needed for self-bundling consumers; NestJS/`tsc` consumers resolve un-bundled).

---

**Required before implementation:** add the `winston.node.test.ts` migration task (Issue 1); apply the relative-type-import refinement (Issue 2). With those two addressed, the plan is solid.
