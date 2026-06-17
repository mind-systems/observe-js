# Plan Review 3: Live smoke vs local Loki (required for this SDK)

**Plan:** `.ai-factory/plans/12-live-smoke-vs-local-loki-required-for-this-sdk.md`
**Files Reviewed:** 1 plan + 7 source/config files cross-checked
**Risk Level:** 🟢 Low — all prior findings incorporated; implementation-ready

## Summary

This third revision folds in **all** findings from reviews 1 and 2. Every API fact, endpoint, label name, and helper convention the plan relies on was re-verified against the actual source and holds.

Carried forward from review 1 (all present):
- README edit dropped; discoverability is the top-of-file doc comment + the `test:loki` script name. ✓
- `import { randomUUID } from 'node:crypto'` instead of the bare global (which can be `undefined` in the Node 18.x vitest VM — confirmed by `conformance.node.test.ts` lines 35–39 and the `globalThis.crypto?.getRandomValues` fallback in `span.ts`/`resource.ts`). ✓
- Label assertion is positive-containment + negative-forbidden (no brittle `toEqual`). ✓
- Stable low-cardinality `project` (`observe-js-smoke`) isolated by a `runId` body filter, not a per-run project name. ✓
- Top-level-await precedent correction (explicitly a new pattern, not a copy of `conformance.node.test.ts`). ✓

Carried forward from review 2 (all present):
- **Explicit `20000` per-test timeout** (line 32) — comfortably exceeds the ~10s poll budget; avoids the opaque "timed out in 5000ms" default. `vitest.config.ts` confirmed to set no `testTimeout`. ✓
- **`onError` capture** (line 34) — `InitOptions.onError` exists (`sdk.ts` lines 33–37, threaded into `createExporter`); captured errors surface a broken ingest path instead of a generic poll timeout. ✓
- **BigInt ns bounds** for both `start` and `end` (line 42) — matches the SDK's own `nowNanoString()` (`sdk.ts` line 56–59) and avoids float rounding above `Number.MAX_SAFE_INTEGER`. ✓

API verification against source:
- `init({ project, service, endpoint, onError })`, `log('info', msg, attrs)`, `flush()` exported from `src/core/index.ts`; `InitOptions` shape confirmed in `sdk.ts`. ✓
- `startSpan`/`withSpan` re-exported from `src/node/index.ts`; `Span.traceId` is a 32-char lowercase hex string (`span.ts` `newTraceId` = `randomHex(16)`). ✓
- `withSpan(span, fn)` binds context via `runWithContext`; `log()` inside stamps `record.traceId = ctx.traceId` (`sdk.ts` lines 161–167). ✓
- Side-effect import `import '../src/node/index.js'` matches the `*.node.test.ts` convention (`conformance.node.test.ts` line 12). ✓
- Endpoints (`/ready`, `/flush`, `/loki/api/v1/query_range`), the `service_name` label name, the forbidden-label list, and the `| trace_id="…"` structured-metadata query all mirror `backend/verify.sh` (steps 1, 4, 5, 5b). ✓
- New file `test/smoke.loki.test.ts` matches the `test/**/*.test.ts` include glob; `test:loki` correctly omits the `build` prefix since it imports from `src/`. ✓

### Context Gates

- **Architecture** (`ARCHITECTURE.md`): dependency rules require `core/` to import nothing outside itself and `node/` → `core/` only. The plan keeps every helper local to the test file with no new source modules. ✓ No violation.
- **Rules** (`rules/base.md`): "no console output in production paths" — the `console.warn` is in test code, explicitly noted as exempt; filename is kebab-case. ✓ No violation.
- **Roadmap** (`ROADMAP.md`): directly implements the still-unchecked Verification milestone "Live smoke vs local Loki" and is named in the milestone DoD ("live smoke against local Loki green"). ✓ Linkage present. No WARN.

---

## Findings

### 1. `/ready` probe treats a reachable-but-not-ready Loki (HTTP 503) as "up" — LOW (optional)

The reachability guard does `GET /ready … .catch(() => false)`. `fetch` only rejects on a network/transport failure — a reachable Loki that is still warming up returns an HTTP **503** as a *resolved* Response, so `lokiUp` becomes truthy and the suite runs instead of skipping. This is slightly looser than `verify.sh`, which uses `curl -sf` (the `-f` flag fails on 5xx). In practice the poll-with-retry loop gives a warming Loki time to become ready, so the realistic worst case is a failure rather than a clean skip in the narrow window where Loki is reachable but never becomes ready.

**Recommendation (optional):** Gate on `res.ok` as well — e.g. `.then(r => r.ok).catch(() => false)` — so a 503 is treated as "not up" and the suite skips, matching `verify.sh`'s `-f` semantics. Not blocking.

---

## Positive Notes

- The isolation model (stable low-cardinality `project` + `runId` body line filter, with `run.id` carried as an attribute but never relied on as a queryable label) actively demonstrates the SDK's own attribute discipline rather than violating it.
- Framing as "assert what the SDK emitted is retrievable" (not a re-test of the backend) keeps the test honest and matches the spec note's intent.
- The `onError` + captured-error-on-timeout pattern turns a silent-degradation contract (which would otherwise mask a 4xx ingest failure as "record not found") into a diagnosable failure — a genuinely thoughtful addition for a reference test that swift/dart will copy.
- Required-present + forbidden-absent label assertion read off the record's own `stream` object (not the global `/labels` endpoint) is robust against Loki version drift while still enforcing the real policy intent.
- The `| trace_id="<traceId>"` second query faithfully mirrors `verify.sh` step 5b as a positive structured-metadata guard.

---

The single finding is an optional LOW-severity robustness nit on the skip guard; it does not block implementation and the plan is otherwise correct, complete, and faithful to the codebase and the `backend/verify.sh` oracle.

PLAN_REVIEW_PASS
