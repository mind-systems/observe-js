# Code Review: Contract conformance test (offline — required)

**Reviewed against:** plan `.ai-factory/plans/11-contract-conformance-test-offline-required.md`, observe-js source (`src/core`, `src/node`), `contract@v0.1.2` fixtures, `vitest` config, Node 18.15.0.
**Change under review:** one new file — `test/conformance.node.test.ts` (117 lines). No source files modified.

## Verification performed (not just read — executed)

| Check | Command | Result |
|---|---|---|
| Conformance suite | `npx vitest run test/conformance.node.test.ts` | ✅ 9/9 passed |
| Full suite (regression / cross-file pollution) | `npx vitest run` | ✅ 143/143 passed, 14 files |
| Type safety | `npx tsc --noEmit` | ✅ exit 0 |
| Regression sensitivity | mutated `golden-record.json` `severityNumber` 9 → "9", re-ran | ✅ wire test **failed** with a clear diff (`"severityNumber": "9"` vs `9`); fixture restored, submodule clean |

The byte-for-byte equality is real: the captured POST bodies (produced through the *actual* `buildResource → batcher → encodeLogs → JSON.stringify` pipeline) deep-equal both fixtures, and the level table matches `levels.json` token-for-token. The deliberate-regression probe confirms strictness (`toEqual`, not subset).

## Correctness assessment

- **Determinism is sound.** `vi.setSystemTime(1718632800000)` → `nowNanoString()` yields `"1718632800000000000"` for both `timeUnixNano`/`observedTimeUnixNano`, matching the fixtures. The `vi.stubGlobal('crypto', …)` (not `vi.spyOn`) correctly *defines* the absent global and routes `resource.ts` down the `randomUUID` branch — verified the resource block carries the fixed `service.instance.id`. The W3C example traceparent reconstructs `traceId`/`spanId`/`flags: 1` exactly via `extract` + `runWithContext`, and `log()` stamps them (sdk.ts 162–167).
- **`await flush()` reliably captures before assertion.** `flush()` → `ensureFlushing()` drains the queue through `exporter.export()` → mocked async `fetch`; all microtask-based, so fake timers (which only fake timer callbacks, not Promises) do not stall it. Confirmed by green runs.
- **Single-record-envelope sequencing is honored.** One ordered `it` captures `[0]`=marker (after `init` + flush) then `[1]`=record (after `log` + flush), so each captured body is a one-record envelope. No hidden cross-test coupling; the full-suite run with default (non-shuffled) order passes, and the level-table tests are independent of the singleton `init` state.
- **No teardown leaks.** `afterEach` restores real timers, unstubs globals, and clears `capturedBodies`; the batcher's `setInterval` is `unref`'d. Full suite (including browser-env files) stays green, so the file-global `beforeEach`/`afterEach` stubs don't bleed into other tests.
- **Types are clean.** `tsc --noEmit` passes; JSON imports resolve despite `exclude: ["contract"]` (same pattern `src/core/levels.ts` already uses); `opts.body as string` and `ctx!` are valid assertions under `strict`.

## Observations (non-blocking — no action required)

1. **`crypto` is stubbed as `{ randomUUID }` only.** Safe for the current path (only `buildResource` touches crypto). If a future revision adds real span creation (`startSpan`) to this file, span-id generation may reach for other crypto APIs not present on the stub. Worth a one-line awareness comment if the suite grows, but not a defect today.
2. **Mock returns `new Response(null, { status: 200 })`.** Relies on a global `Response` in the vitest node VM (present here; probe + runs confirm). The exporter reads only `.status`, so a plain `{ status: 200 }` would work equally — purely stylistic.
3. **Contract pin is a soft pin** on `levelsData.version` (already acknowledged in the test's own comment and the plan). Acceptable for this milestone; a detached commit still carrying `version: "0.1.2"` would slip past the version assertion but would be caught by the baked-in fixture values diverging.

No bugs, security issues, or correctness problems found. The test is faithful to the contract, deterministic, type-safe, strict enough to catch field-shape regressions, and free of cross-test side effects.

REVIEW_PASS
</content>
