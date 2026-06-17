# Plan Review 2 — Contract conformance test (offline — required)

**Plan:** `.ai-factory/plans/11-contract-conformance-test-offline-required.md`
**Risk Level:** 🟢 Low
**Verdict:** Solid — ready to implement.

This is the second review of a plan that was already probe-validated end-to-end in
review 1. I independently re-verified every critical claim against the live codebase
and environment rather than trusting the prior review. All claims hold.

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md` present): No boundary or dependency
  violations. The plan adds a test-only artifact under `test/`, reads fixtures from the
  `contract/` submodule, and drives the existing `core/` + `node/` public surface. No new
  runtime code, no new dependency edges. **PASS.**
- **Rules** (`.ai-factory/rules/` present): No convention violations observed. The
  `.node.test.ts` suffix, the side-effecting `import '../src/node/index.js'`, and the
  `vi.stubGlobal` mocking style all match existing tests (`winston.node.test.ts`,
  `exporter.test.ts`). All files English. **PASS.**
- **Roadmap** (`.ai-factory/ROADMAP.md` present): Directly implements the open milestone
  "Contract conformance test (offline — required)" (ROADMAP line 40) and its spec note
  `.ai-factory/notes/11-conformance-test.md`. Scope correctly excludes the live-Loki smoke
  (that is a separate DoD item, line 47). The plan satisfies every "Watch" and "Done when"
  clause in the note. **PASS.**

## Verified Claims (independently re-confirmed)

- **Environment.** `node --version` → `v18.15.0`; `git -C contract describe --tags` →
  `v0.1.2`. Both load-bearing assumptions in the plan are true on this machine *right now*.
- **Clock arithmetic.** `nowNanoString()` (`src/core/sdk.ts:56`) = `BigInt(Date.now()) * 1_000_000n`.
  `vi.setSystemTime(1718632800000)` → `"1718632800000000000"`, which matches `timeUnixNano`
  and `observedTimeUnixNano` in both fixtures. ✓
- **Crypto stub.** `newInstanceId()` (`src/core/resource.ts:9-18`) guards on
  `typeof globalThis.crypto?.randomUUID === 'function'` and falls back to a `Math.random`
  UUID otherwise. The `vi.stubGlobal('crypto', { randomUUID })` approach is correct *and*
  robust: it works whether or not `globalThis.crypto` pre-exists in the node VM, always
  routing down the `randomUUID` branch to the fixed `0b9d7a3e-…` id. The warning against
  `vi.spyOn(globalThis.crypto, …)` is well-founded. ✓
- **Trace/span ids.** `extract(objectCarrier({ traceparent: '00-4bf9…-00f0…-01' }))`
  parses to `{ traceId, spanId, traceFlags: 1 }` (`parseInt('01',16)=1`); `log()` stamps
  `record.traceId/spanId/flags` from the active context (`sdk.ts:162-167`). Matches the
  golden record's `traceId`/`spanId`/`flags: 1`. ✓
- **Attribute order.** `log()` pushes `level` first, then user attrs in `Object.keys`
  order (`sdk.ts:147-149`), yielding `[level, order.id]` — matches the golden array order.
  The marker's `[level, event.name]` (`sdk.ts:119-123`) matches `service-start.json`. ✓
- **Wire capture.** Default exporter does `JSON.stringify(encodeLogs(resource, records))`
  and reads only `response.status`, accepting 200/204 (`exporter.ts:38,46`). Mocking
  `fetch` to capture `opts.body` and return `new Response(null, { status: 200 })` gives the
  exact on-wire payload. ✓
- **Context-manager registration.** `src/node/context.ts:36` calls `setContextManager`
  at module load; importing `src/node/index.ts` evaluates it. Without it `getActiveContext()`
  stays the no-op (`context.ts:35-45`) and trace ids never stamp. The `.node.test.ts` suffix
  and bare import are correct. ✓
- **Imports resolve as written.** `init`/`log`/`flush` are exported from `core/index.ts`
  (lines 50-51) but **not** from `node/index.ts`; `extract`/`objectCarrier`/`runWithContext`
  are exported from `node/index.ts` (lines 12,20). The plan's import split is exactly right,
  and both paths share the same `core/context.js` singleton so registration is honored. ✓
- **Fixture pathing.** `test/conformance.node.test.ts` → `../contract/*.json` resolves to
  repo-root `contract/`. `resolveJsonModule` is on; `tsconfig` `exclude: ["contract"]` does
  not block JSON imports (proven by `src/core/levels.ts:4` already importing
  `../../contract/levels.json`, and `test/levels.test.ts:3` importing `../contract/levels.json`). ✓
- **Fake timers.** `vitest.config.ts` sets `environment: 'node'`. Fake timers fake the
  batcher's unref'd `setInterval` harmlessly; `flush()` is microtask-based (unaffected);
  the mocked `fetch` resolves before `AbortSignal.timeout(5000)` could fire. ✓
- **Single-record envelopes.** Each `flush()` fully drains the queue (`batcher.ts:80-84`),
  so the one-ordered-`it` strategy yields `capturedBodies[0]` = marker, `[1]` = record, each
  a single-record `ExportLogsServiceRequest`. The re-init no-op claim holds (`sdk.ts:91-93`). ✓
- **Level table + pin.** `LEVELS`/`severityFor` derive from `contract/levels.json`
  (`levels.ts:4,11`); `levelsData.version === '0.1.2'`. The `expect(levelsData.version).toBe('0.1.2')`
  guard works. ✓

## Critical Issues

None.

## Minor Observations (non-blocking, no change required)

1. **`beforeEach` scope is broader than needed.** The fake-timers / `crypto` / `fetch`
   stubs are described as global `beforeEach`, so they also wrap the `level table conformance`
   describe, which needs none of them. Harmless (those tests touch no timers/globals), but
   scoping the setup to the `OTLP wire conformance` describe would read cleaner for the
   swift/dart teams copying this harness. Optional.
2. **Redundant side-effect import.** The top-of-file `import '../src/node/index.js';` is
   technically redundant with the named import of `extract`/`objectCarrier`/`runWithContext`
   from the same module (the named import already triggers `setContextManager`). The plan
   keeps it deliberately to match `winston.node.test.ts` convention — fine; just noting it is
   belt-and-suspenders, not load-bearing on its own.
3. **Soft version pin.** The contract pin is a JSON `version`-field check, not a git-tag /
   commit check — the plan already flags this honestly. It satisfies the note's "fail loudly
   if at another tag" intent in practice (submodule genuinely pinned to `v0.1.2` per the
   milestone-01 DoD), and would only miss a detached commit still carrying `version: "0.1.2"`.
   Acceptable for this milestone.

## Positive Notes

- The "control inputs, normalize nothing on output" strategy is the right one for a
  cross-platform oracle, and the plan defends every non-deterministic input (clock, instance
  id, trace ids) with a concrete, code-referenced mechanism.
- The single-ordered-`it` decision is well-justified: it makes marker-before-record
  sequencing explicit and removes the cross-test drain hazard separate `it` blocks would hide.
- Strict `toEqual` against parsed fixtures (no `toMatchObject`/subset) is exactly what the
  regression requirement needs, and the plan recognizes that `toEqual` array order also
  verifies attribute ordering.
- The verification step includes a deliberate-regression sanity check, matching the note's
  "Done when" clause.

PLAN_REVIEW_PASS
