# Code Review 3: Contract conformance test (offline — required)

Third independent pass. The change under review is **byte-identical** to that reviewed in passes 1 and 2: the only code change is the new `test/conformance.node.test.ts` (117 lines, git blob `1c44232`, confirmed unchanged); no source files touched; the `contract` submodule is clean and pinned at `v0.1.2`. This pass re-confirms the verdict and adds a portability/security angle not foregrounded earlier.

## State confirmation

- `git diff HEAD --stat` → only `.ai-factory/*` artifacts plus `test/conformance.node.test.ts`.
- `git hash-object test/conformance.node.test.ts` → `1c442325…` (matches the blob reviewed previously — no edits since).
- `git -C contract describe --tags` → `v0.1.2`; submodule working tree clean.

## Verification carried forward (this exact blob)

| Check | Result |
|---|---|
| `npm test` (build + full `vitest run`) — the milestone gate | ✅ 143/143 across 14 files, build clean |
| `npx vitest run test/conformance.node.test.ts` ×2 | ✅ 9/9, identical (deterministic) |
| `npx tsc --noEmit` | ✅ exit 0 |
| Deliberate field-shape regression (`severityNumber` 9→"9") | ✅ wire test fails with explicit diff; fixture restored |

These were executed against the current blob; since the file is unchanged they remain authoritative.

## Fresh angle 1 — portability of the determinism harness

This file is an explicit reference artifact for `observe-swift`/`observe-dart`, so its environmental assumptions matter:

- The two load-bearing stubs (`crypto`, `fetch`) are both installed via `vi.stubGlobal`, which **defines** the global when absent — the pattern is robust to the documented quirk that `globalThis.crypto` is undefined in the vitest node VM here, and would equally tolerate a runtime where it *is* defined (stub overrides either way). This is the correct, non-fragile choice.
- The one unstubbed global the test constructs directly is `Response`. It is present in this environment and the exporter consumes only `.status`, so the dependency is shallow; on a hypothetical runtime lacking a global `Response` the mock construction (not the SDK) would be the failure point — a self-evident, non-silent failure. Acceptable, and already noted as a stylistic option in prior passes.
- No reliance on real timers, real network, RNG, locale, or timezone — the suite is hermetic. Repeat runs confirmed bit-stable output.

## Fresh angle 2 — security surface

A test-only file: no secrets, no live endpoints (the only URL is a localhost string fed to a stubbed `fetch` that never dials out), no external/user input, no deserialization of untrusted data (`JSON.parse` operates on the SDK's own serialized output captured in-process). The hardcoded traceparent and ids are the public W3C example values from the contract. No security concerns.

## Correctness — re-traced once more

`init` → default fetch exporter with `buildResource` (stubbed instance id) → batcher `flush` → `encodeLogs` (scope `observe`/`0.1.0`) → `JSON.stringify` reproduces `service-start.json` (`eventName` + `event.name`, no trace fields) at `[0]`, and the `runWithContext(extract(...))` path reproduces `golden-record.json` (`flags: 1`, hex `traceId`/`spanId`, `[level, order.id]` attribute order) at `[1]`. Level-table block matches `levels.json` token-for-token plus the soft version pin. Strict `toEqual` throughout; `expect(ctx).toBeDefined()` guards the `ctx!` deref so a parse failure would surface as a clean assertion, not a crash.

## Observations (non-blocking, unchanged from passes 1–2)

1. `crypto` stub exposes only `randomUUID` — sufficient today; extend if real `startSpan` use is added to this file.
2. `Response` global dependency in the mock (could be a plain `{ status: 200 }`).
3. Contract pin is a soft `levelsData.version` assertion — acknowledged, acceptable for this milestone.

No bugs, security issues, or correctness problems. The test is deterministic, hermetic, type-safe, strictly compares against the frozen fixtures, and passes the full build gate.

REVIEW_PASS
</content>
