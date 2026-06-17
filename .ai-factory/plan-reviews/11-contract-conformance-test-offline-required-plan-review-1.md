# Plan Review: Contract conformance test (offline — required)

**Plan:** `.ai-factory/plans/11-contract-conformance-test-offline-required.md`
**Reviewed against:** observe-js source (`src/core`, `src/node`), `contract@v0.1.2` fixtures, `vitest` config, Node `v18.15.0`
**Risk Level:** 🟡 Medium — the overall strategy is sound and was validated end-to-end, but one central setup assumption is **confirmed broken** in this exact environment and will make the whole suite fail until fixed.

## Verification performed

I did not just read the plan — I executed its core path. Two throwaway probes under the project's real `vitest` config (Node 18.15.0, `environment: 'node'`):

1. A probe of the **exact** crypto-stubbing call the plan prescribes (`vi.spyOn(globalThis.crypto, 'randomUUID')`).
2. A probe of the full pipeline (fake timers → `init` → `flush` → `log` in `runWithContext` → `flush`) asserting `toEqual` against both fixtures, using a **corrected** crypto stub.

Probe 2 passed both assertions (service.start + golden record byte-identical through the real `buildResource → batcher → encodeLogs → JSON.stringify` path). Probe 1 revealed the critical issue below.

---

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** present. No boundary violation. The new test imports from `src/core/index.js` (neutral core) and `src/node/index.js` (Node layer) — exactly the dependency direction the layering allows. The `.node.test.ts` suffix correctly matches the `node` test environment and mirrors `context.node.test.ts`/`winston.node.test.ts`. **PASS.**
- **Rules (`.ai-factory/RULES.md`):** not present. **WARN** (optional file missing; nothing to enforce).
- **Roadmap (`.ai-factory/ROADMAP.md`):** present and clearly linked — this plan is the milestone *"Contract conformance test (offline — required)"* under Verification, with spec note `.ai-factory/notes/11-conformance-test.md`. The plan satisfies every "Watch"/"Done when" item in the note (no normalization, field exactness, level-table check, contract-pin guard, regression-fails check). **PASS.**
- **skill-context (`.ai-factory/skill-context/aif-review/SKILL.md`):** not present. No project-specific review overrides to apply.

---

## Critical Issues

### 1. `vi.spyOn(globalThis.crypto, 'randomUUID')` will fail — `globalThis.crypto` is `undefined` inside the vitest VM on Node 18.15.0 (CONFIRMED)

This is the determinism linchpin for the `service.instance.id` (`0b9d7a3e-…`) that appears in the `resource` block of **both** fixtures. The plan (Key design decision #2 and Task 1) prescribes:

```ts
vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('0b9d7a3e-5f2c-4c1a-9e7d-3a6b8c1f2e4d')
```

In a plain `node -e` realm `globalThis.crypto` exists, but **inside the vitest `node` test VM on this machine it is `undefined`** — I verified this directly:

```
node -e realm:   crypto: object   | randomUUID: function
vitest VM:       crypto: undefined
```

This is precisely the case `src/core/resource.ts` warns about in its own comment ("vitest VM contexts on older Node 18.x patch levels"). Two failure modes result:

- `vi.spyOn(undefined, 'randomUUID')` **throws** in `beforeEach` → the whole suite errors out before any assertion.
- Even if it didn't throw, `buildResource → newInstanceId()` checks `typeof globalThis.crypto?.randomUUID === 'function'` — `false` here — and takes the **`Math.random` UUID fallback**, producing a random id that never equals the fixture. Both `toEqual` assertions (Task 2 and Task 3) would then fail on the `service.instance.id` attribute.

**Fix (validated):** stub the whole global with `vi.stubGlobal`, which *defines* the global even when absent (and is the pattern the codebase already uses for `fetch` in `exporter.test.ts`):

```ts
vi.stubGlobal('crypto', { randomUUID: () => '0b9d7a3e-5f2c-4c1a-9e7d-3a6b8c1f2e4d' });
```

This both makes the global exist and routes `resource.ts` down the `randomUUID` branch. It pairs cleanly with the `vi.unstubAllGlobals()` already planned for `afterEach`. With this single change, my full-pipeline probe produced byte-identical matches against `service-start.json` and `golden-record.json`. No other part of the strategy needs to change.

> Note: this also means the `globalThis.crypto?.` optional-chaining and Math.random fallback in `resource.ts` are load-bearing on this runtime — do not "simplify" them away.

---

## Medium Issues

### 2. "Second captured request" / "next captured body" wording contradicts the `beforeEach`-clears-array structure (Task 3)

The plan is internally inconsistent about capture indexing. Task 1 says `afterEach` clears the captured-bodies array; Task 3 then says to "Parse the **next** captured body (the one produced after the `service.start` flush)" and that "the order record is the **second** captured request."

Those cannot both be true if Tasks 2 and 3 are **separate `it` blocks** (the form the plan leans toward). `beforeEach` re-stubs `fetch` and clears the array before each test, so in the order-record test the order record is `capturedBodies[0]`, **not** `[1]`. My probe confirmed this: with separate `it` blocks the golden record is at index `0` of the freshly-cleared array. An implementer who literally reads `capturedBodies[1]` will get `undefined` → `toEqual` fails.

**Fix:** make the structure and the indexing consistent. Either (a) keep separate `it` blocks and assert `capturedBodies[0]` in each, or (b) use a single ordered `it` that does `flush` after `init` (capture `[0]` = marker), then `log` + `flush` (capture `[1]` = order) and assert both. Pick one and state the exact index. Drop the "second captured request" phrasing if going with (a).

### 3. The order-record test is not independently runnable (hidden cross-test coupling)

Because `init` is a module singleton that enqueues the `service.start` marker, the order-record test only produces a clean single-record envelope **if the marker was already drained by a prior `flush`**. If the order-record `it` runs in isolation (e.g. `it.only`, or test reordering / `sequence.shuffle`), then `init` enqueues the marker, `log` enqueues the order record, and a single `flush` drains **both into one POST body with two `logRecords`** — so `capturedBodies[0]` is the marker (or a 2-record envelope), and `toEqual(goldenRecord)` fails. The plan relies on definition-order execution and on Task 2 running first, but never states this dependency as a hard requirement.

**Recommendation:** prefer the single-ordered-`it` form from Issue #2 (it makes the marker-then-record sequencing explicit and self-contained, which also better serves the "self-contained reference artifact for swift/dart" goal). If keeping separate blocks, add a comment that the order-record test depends on the marker having been flushed first, and avoid any test-shuffle config.

---

## Minor Notes / Observations

- **Contract pin is a soft pin, not a git-tag check.** `expect(levelsData.version).toBe('0.1.2')` asserts the JSON `version` field, not the actual submodule tag. The submodule is currently at `v0.1.2` (`git -C contract describe --tags` → `v0.1.2`) and `levels.json` says `"0.1.2"`, so it passes today and satisfies the spec's "fail loudly if at another tag" intent well enough. Just be aware it would not catch a detached commit that still carries `version: "0.1.2"`. Acceptable for this milestone.
- **Task 4 level-table assertion is somewhat tautological for JS.** `src/core/levels.ts` *derives* `LEVELS` directly from `contract/levels.json`, so comparing `LEVELS`/`severityFor` back against `levels.json` mostly verifies the import passthrough rather than an independent serializer. It still earns its keep via the key-set-equality and version-pin guards, and it makes the suite a complete copyable reference for swift/dart (where `levels.json` is a genuinely external oracle). No change needed — just don't expect it to catch JS-side mapping bugs.
- **Fetch mock return shape:** the design section says `return { status: 200 }` while Task 1 says `return new Response(null, { status: 200 })`. Both work (the exporter only reads `.status`, and accepts 200/204). My probe used the `Response` form successfully. Harmless inconsistency; pick one.
- **Fake timers are compatible with the batcher/exporter.** Confirmed: `vi.useFakeTimers()` mocks `Date.now()` (so `nowNanoString()` yields the fixture timestamp), the batcher's `setInterval` is harmlessly faked, `flush()` is promise-based (not timer-coupled), and `AbortSignal.timeout(5000)` in the exporter never fires because the mocked `fetch` resolves immediately. The plan's preference for explicit `await flush()` over advancing timers is correct.
- **JSON fixture imports resolve fine** despite `tsconfig` `exclude: ["contract"]` — `resolveJsonModule` is on and vite/esbuild resolves the import regardless; `src/core/levels.ts` already imports `../../contract/levels.json` in the build. The plan's `../contract/...` paths from `test/` are correct.

---

## Positive Notes

- **The core strategy is correct and was proven, not assumed.** Controlling inputs (fake clock, stubbed id, reconstructed W3C context) while normalizing *nothing* on output, then strict `toEqual` against the parsed fixtures, is exactly right and produced byte-identical envelopes through the real pipeline in my probe.
- **Trace-id mechanism is accurate.** The plan correctly identifies that the Node `AsyncLocalStorage` manager must be registered via the side-effecting `import '../src/node/index.js'` (confirmed: `src/node/context.ts` calls `setContextManager(nodeContextManager)` at module load), and that `log()` only stamps `traceId`/`spanId`/`flags` when a context is active. The canonical W3C example traceparent maps exactly to the golden record's hex ids and `flags: 1`.
- **Single-record-envelope reasoning is sound** and matches `encodeLogs` + batcher behavior (one `flush` drains the queue into one POST with one `scopeLogs`/`logRecords` entry), *provided* the marker-then-record sequencing from Issues #2/#3 is respected.
- **Attribute ordering matches.** `log()` writes `level` first then user attrs in `Object.keys` order, giving `[level, order.id]` — identical to the fixture, and `toEqual` on arrays is order-sensitive as intended.
- **Strong alignment with the spec note and roadmap DoD**, including the deliberate-regression sanity check in the Verification section.

---

## Required changes before implementation

1. **(Critical)** Replace `vi.spyOn(globalThis.crypto, 'randomUUID')` with `vi.stubGlobal('crypto', { randomUUID: () => '0b9d7a3e-5f2c-4c1a-9e7d-3a6b8c1f2e4d' })` (Key design decision #2 and Task 1).
2. **(Medium)** Make capture indexing consistent with the chosen test structure; remove the contradictory "second captured request"/"next captured body" wording or commit to a single ordered `it` that captures `[0]`=marker and `[1]`=record.
3. **(Medium)** Document/guarantee the marker-before-record ordering so the order-record assertion is not silently dependent on test execution order.

The plan is fundamentally well-designed and nearly ready; it needs the crypto-stub fix (a real, environment-confirmed defect) plus two clarifications around capture ordering before implementation.
