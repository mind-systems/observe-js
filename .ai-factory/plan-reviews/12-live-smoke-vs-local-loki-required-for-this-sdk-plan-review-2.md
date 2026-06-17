# Plan Review 2: Live smoke vs local Loki (required for this SDK)

**Plan:** `.ai-factory/plans/12-live-smoke-vs-local-loki-required-for-this-sdk.md`
**Risk Level:** 🟡 Medium (one concrete correction — test timeout; otherwise sound and implementation-ready)

## Summary

The revised plan incorporates **all five findings** from review 1 and is materially stronger:

1. **README removed (review-1 #1)** — Task 2 no longer touches a non-existent `README.md`; discoverability is now the top-of-file doc comment + the `test:loki` script name. ✓
2. **`node:crypto` randomUUID (review-1 #2)** — switched from the bare `crypto.randomUUID()` global (which can throw in the Node 18.x vitest VM) to `import { randomUUID } from 'node:crypto'`, with the rationale documented inline. ✓
3. **Label assertion (review-1 #3)** — replaced the brittle exact key-set `toEqual` with positive-containment (`project`/`service_name`/`level` present) + negative-forbidden (`trace_id`/`span_id`/`service_instance_id` absent), tolerating Loki-internal labels like `detected_level`. ✓
4. **Stable `project` (review-1 #4)** — drops the per-run `project` name (which would inflate index cardinality) in favor of a stable `observe-js-smoke` project isolated by a `runId` body line filter. This is the correct call and matches the SDK's own attribute discipline. ✓
5. **Top-level-await precedent corrected (review-1 #5)** — the plan now explicitly states this is a new pattern, not a copy of `conformance.node.test.ts` (which uses `beforeEach`). ✓

API facts were re-verified against the codebase and all hold:

- `init({ project, service, endpoint })`, `log('info', msg, attrs)`, `flush()` are exported from `src/core/index.ts` (`InitOptions` in `src/core/sdk.ts`). ✓
- `startSpan`/`withSpan` re-exported from `src/node/index.ts`; `Span.traceId` is a 32-char lowercase hex string (`src/core/span.ts`). ✓
- `withSpan(span, fn)` binds context via `runWithContext`, so `log()` inside stamps `record.traceId = ctx.traceId` (`src/core/sdk.ts` lines 161–167). The emitted OTLP `traceId` is what Loki exposes as the `trace_id` structured-metadata field — exactly what `backend/verify.sh` step 5b queries on the golden record. ✓
- Side-effect import `import '../src/node/index.js'` matches the `*.node.test.ts` convention. ✓
- Endpoints (`/ready`, `/flush`, `/loki/api/v1/query_range`) and the `service_name` label name (OTLP `service.name` → Loki `service_name`) all mirror `backend/verify.sh`. ✓

### Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md`): dependency rules require `core/` → nothing outside itself and `node/` → `core/` only. The plan keeps every helper local to `test/smoke.loki.test.ts` with no new source modules. ✓ No violation.
- **Rules** (`.ai-factory/rules/base.md`): "no console output in production paths" — the `console.warn` is in test code, and the plan explicitly notes the rule does not apply there. Filename `smoke.loki.test.ts` is kebab-case. ✓ No violation.
- **Roadmap** (`.ai-factory/ROADMAP.md`): directly implements the Verification milestone and is named in the observe-js DoD ("live smoke against local Loki green"). ✓ Linkage present. No WARN.

---

## Findings

### 1. Poll budget (~10s) exceeds the default vitest test timeout (5s) — MEDIUM

`vitest.config.ts` sets only `environment` and `include`; there is **no `testTimeout` override**, so the default **5000 ms** per-test timeout applies. The plan's Task 1 step 5 budgets a poll-with-retry loop "up to ~10s" inside what reads as a single `it()` test body (steps 1–6). On any run where the record takes longer than ~5s to become queryable (cold ingester, flush latency), the test will be killed by vitest's timeout and report an opaque "test timed out in 5000ms" instead of a meaningful assertion failure — and on a healthy-but-slow local Loki this turns the test flaky in the *failing* direction.

**Recommendation:** Specify an explicit per-test timeout that comfortably exceeds the poll budget, e.g. `it('emits a record retrievable from Loki', async () => { … }, 20000)` (the third arg), or set `testTimeout` on the `describe`/suite. Make the timeout strictly greater than `pollMaxMs + flush/network slack`. State the exact number in the plan so the implementer doesn't fall back on the 5s default.

### 2. Silent export degradation hides POST failures behind a poll timeout — LOW

By contract the SDK degrades silently: a rejected or unreachable export never throws into `log()`/`flush()` (`src/core/sdk.ts`, `rules/base.md`). In a smoke test that is a double-edged sword — if Loki rejects the POST (e.g. a malformed OTLP envelope, a 4xx), `await flush()` resolves cleanly and the failure surfaces only as the query-back loop exhausting its retries with "record not found". The implementer then has to guess whether the bug is ingest, query, or label policy.

**Recommendation:** Pass an `onError` handler to `init` that captures export errors into a local array, and either fail the test with that captured error if the poll loop times out, or at least `console.warn` it. This makes a broken ingest path diagnosable instead of presenting as a generic timeout. `InitOptions.onError` already exists (`src/core/sdk.ts` lines 33–37) — no SDK change needed.

### 3. `Date.now() * 1e6` for the `end` bound loses ns precision — INFO

Task 1 step 6 builds `end` as `(Date.now() * 1e6)`. At current magnitudes (`~1.75e18`) this float multiply rounds to the nearest ~256 ns (it exceeds `Number.MAX_SAFE_INTEGER`). As an inclusive *upper* bound that slack is harmless (the record's timestamp sits comfortably below "now" after flush + poll), so this will not cause failures. But it is inconsistent with the SDK's own ns builder, which deliberately uses BigInt (`nowNanoString()` = `(BigInt(Date.now()) * 1_000_000n).toString()` in `sdk.ts`).

**Recommendation:** For cleanliness and to model the correct pattern that swift/dart will copy, use `(BigInt(Date.now()) * 1_000_000n).toString()` for both `start` and `end` rather than float arithmetic. Optional.

---

## Positive Notes

- The isolation rethink (stable low-cardinality `project` + `runId` body filter) is the right architectural call and now actively demonstrates the SDK's own attribute discipline rather than violating it.
- Framing as "assert what the SDK emitted is retrievable" (not a re-test of the backend) matches the spec note's "Watch" and keeps the test honest.
- Required-present + forbidden-absent label assertion is robust against Loki version drift while still enforcing the real policy intent; querying the returned stream's own `stream` object instead of the global `/loki/api/v1/labels` endpoint is more correct for an isolated test.
- The `| trace_id="<traceId>"` second query as a positive structured-metadata guard faithfully mirrors `verify.sh` step 5b.
- Self-skip via `describe.skip` keeps the default `npm test` green in CI without a backend, and `test:loki` correctly omits the `build` prefix because the suite imports from `src/` like the other `*.node.test.ts` suites (the new file matches the config's `test/**/*.test.ts` include glob).

---

Two of the three findings (timeout, onError) are small, additive edits to the test body; none change the plan's structure. Address finding #1 before implementation — it is the one item that will otherwise produce real failures.
