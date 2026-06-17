# Code Review 2: Contract conformance test (offline — required)

Independent second-pass review. Change under review is unchanged since review 1: a single new file `test/conformance.node.test.ts` (117 lines); no source modified; the `contract` submodule is clean at `v0.1.2`. This pass re-derived the verdict from scratch with a focus on **determinism / flakiness** and the milestone's actual build gate, rather than re-reading review 1.

## Verification performed

| Check | Command | Result |
|---|---|---|
| Conformance file, run 1 | `npx vitest run test/conformance.node.test.ts` | ✅ 9/9 |
| Conformance file, run 2 (determinism) | same, repeated | ✅ 9/9, identical |
| **Milestone gate** | `npm test` (= `npm run build && vitest run`) | ✅ build OK, 143/143 across 14 files |
| Type safety | `npx tsc --noEmit` | ✅ exit 0 (verified review 1; unchanged) |
| Regression sensitivity | mutate `severityNumber` 9→"9" in golden fixture | ✅ wire test fails with explicit diff; fixture restored, submodule clean (verified review 1) |

The full `npm test` pass is the milestone's literal "Done when" criterion ("`vitest` conformance suite green against `observe-contract@v0.1.2`"), and it is met.

## Determinism / flakiness analysis (focus of this pass)

Every input that could vary run-to-run is pinned, so the suite cannot flake:

- **Wall clock** — `vi.setSystemTime(1718632800000)` feeds `BigInt(Date.now()) * 1_000_000n` → `"1718632800000000000"`, timezone-independent (epoch ms). Identical across both repeat runs.
- **Instance id** — `vi.stubGlobal('crypto', { randomUUID })` removes the only nondeterministic resource field; both fixtures share the resource so the single stub covers both captured envelopes.
- **Trace ids** — sourced from a literal W3C traceparent via `extract`, not generated, so no RNG in the path. `expect(ctx).toBeDefined()` precedes the `ctx!` deref, so an unexpectedly-unparseable header would fail the assertion cleanly rather than throw a TypeError.
- **Attribute ordering** — `log()` emits `level` then the single user key `order.id`; with one user attr there is no `Object.keys` ambiguity, and array `toEqual` pins the order regardless.
- **No real timers / no real network** — fake timers + stubbed `fetch` (resolves on a microtask) mean `await flush()` always settles before the assertion; the exporter's `AbortSignal.timeout(5000)` never fires.

## Isolation / side-effect analysis

- File-global `beforeEach`/`afterEach` stub `crypto` and `fetch` and install fake timers; `afterEach` calls `vi.useRealTimers()`, `vi.unstubAllGlobals()`, `vi.restoreAllMocks()`, and clears `capturedBodies`. The full suite — including browser-environment files and `winston.node.test.ts` (which does its own `vi.mock('../src/core/index.js')`) — stays green, confirming no cross-file bleed (vitest isolates module registries per file).
- The `init` module singleton is touched exactly once, inside the single ordered `it`; the level-table `describe` does not depend on init state. Robust even against `describe` reordering; the only ordering dependency (marker `[0]` before record `[1]`) is contained within one test.

## Correctness

Re-traced the pipeline against both fixtures: `buildResource` (stubbed id) → batcher `flush` → `encodeLogs` (`scope {name:'observe',version:'0.1.0'}`) → `JSON.stringify` reproduces `service-start.json` and `golden-record.json` field-for-field, including `eventName`/`event.name` on the marker, `flags: 1` and hex `traceId`/`spanId` on the record, and integer `severityNumber` / decimal-string timestamps throughout. The level-table block matches `levels.json` token-for-token plus the version pin. The `as string` casts and JSON imports under `exclude: ["contract"]` are valid (same pattern as `src/core/levels.ts`) and `tsc` agrees.

## Observations (non-blocking, informational — consistent with review 1)

1. `crypto` is stubbed as `{ randomUUID }` only; safe today, would need extending if real `startSpan` use is ever added to this file.
2. `new Response(null, { status: 200 })` relies on a global `Response` (present in this env); the exporter reads only `.status`, so a plain object would also work.
3. Contract pin is a soft assertion on `levelsData.version` — acknowledged in the test comment and plan; acceptable for this milestone.

No bugs, security issues, or correctness problems found. Deterministic, type-safe, strictly comparing against the frozen fixtures, side-effect-clean, and green through the full build gate.

REVIEW_PASS
</content>
