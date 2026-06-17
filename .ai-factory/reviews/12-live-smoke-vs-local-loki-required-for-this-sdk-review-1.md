# Code Review: Live smoke vs local Loki (required for this SDK)

**Scope:** `test/smoke.loki.test.ts` (new, 190 lines), `package.json` (+1 script).
**Reviewed against:** the plan, `backend/verify.sh` (oracle), and the SDK source (`src/core/sdk.ts`, `span.ts`, `resource.ts`, `src/node/index.ts`).

## Verification performed

Cross-checked every API fact the test relies on against the source:

- `init({ project, service, endpoint, onError })` — all four fields exist on `InitOptions` (`sdk.ts:24-46`); `onError` is invoked on export failures. ✓
- `log('info', msg, { 'run.id': runId })` — signature matches (`sdk.ts:136`); the SDK-owned `level` attribute is written as `kv('level', stringValue('info'))` and a user `run.id` attribute is preserved. ✓
- `startSpan('smoke')` returns a `Span` with a 32-char lowercase-hex `traceId` (`span.ts:46-52,72-97`); called outside any active context it opens a fresh root trace, so `span.traceId` is genuinely new per run. ✓
- `withSpan(span, fn)` binds `{ traceId, spanId, traceFlags }` via `runWithContext`, so `log()` inside stamps `record.traceId = ctx.traceId` (`sdk.ts:162-167`). The OTLP top-level `traceId` is what Loki exposes as the `trace_id` structured-metadata field — exactly what assertion 4 and `verify.sh` step 5b query. ✓
- `flush()` awaits the in-flight export, so any export error is captured into `errors[]` before the poll loop runs — the diagnostic-on-timeout path is correctly ordered. ✓
- Side-effect import `import '../src/node/index.js'` registers the Node ContextManager (matches the `*.node.test.ts` convention). ✓
- `buildResource` emits `project`, `service.name`, `service.instance.id` (`resource.ts:28-35`) → Loki labels `project`, `service_name`, `service_instance_id` — matching assertions 2 and 3 and the `verify.sh` forbidden list. ✓
- ns timestamp helpers use BigInt (`* 1_000_000n`), matching the SDK's own `nowNanoString()`; no float-rounding above `MAX_SAFE_INTEGER`. ✓
- `package.json` `test:loki` runs only the smoke file with no `build` prefix (imports from `src/`), as planned. ✓

## Correctness analysis

- **Run isolation is sound.** `init` enqueues both the `service.start` marker and the log record; the poll query filters `|= "${runId}"`, and the marker body is the literal `"service.start"` — no false match from the marker. The unique `runId` in the body isolates this run from accumulated history under the stable `project`. ✓
- **The negative label assertions are the right technique.** Querying `{project="observe-js-smoke", trace_id!=""}` and expecting 0 results proves `trace_id`/`span_id`/`service_instance_id` are not promoted to index labels — a non-existent index label matches no streams (Loki returns an empty result, not an error, since the `project=` matcher satisfies the "non-empty matcher" requirement). This correctly sidesteps the Loki-3.x behavior (noted in the test comments) where `stream.stream` in `query_range` responses merges structured metadata into the displayed label set, which would make a `not.toHaveProperty()` check on `stream.stream` a false negative. Good call, and well-documented inline. ✓
- **Ordering protects against false passes.** If the record never ingested (e.g. labels not promoted), assertion 1's poll fails first with the captured-error diagnostic — the trivially-empty negative queries can't mask a missing record. ✓
- **Skip path is robust.** `AbortSignal.timeout(2000)` rejection (timeout) and connection-refused both fall through `.catch(() => false)`; a non-200 `/ready` yields `r.ok === false`. All routes resolve to `describe.skip`, keeping the default `npm test` green without a backend. ✓
- **Timeout.** Explicit `20_000` third arg comfortably exceeds the ~10s poll budget; no opaque 5s-default timeout. ✓

No bugs, security issues, or correctness problems found.

## Non-blocking observations (no change required)

1. **Backend-config coupling (informational).** Assertion 2 (`labels['level'] === 'info'`, plus `project`/`service_name` present) depends on the backend's `otlp_config` promoting those three OTLP attributes to index labels. This is identical to the coupling in `backend/verify.sh` and is intentional for this milestone — the test is meaningful only against the project's own Loki config. Worth being aware of if the suite is ever pointed at a differently-configured Loki.
2. **~2s probe cost on every default `npm test` when Loki is down (informational).** The top-level reachability `await` runs at module-collection time, so each `npm test` without a backend pays up to the 2s abort timeout once before skipping. Acceptable; flagged only for awareness.

REVIEW_PASS
