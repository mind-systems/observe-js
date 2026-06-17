# Plan: Live smoke vs local Loki (required for this SDK)

## Context
Prove the reference SDK reaches a running local Loki end-to-end: `init` + `log` → POST to `http://localhost:3100/otlp/v1/logs` → query the record back via LogQL, asserting the index label set (`project`/`service_name`/`level`) and that the emitted `trace_id` is queryable as structured metadata. This is part of the observe-js milestone DoD and the reference path swift/dart will copy.

## Settings
- Testing: yes (this milestone *is* a test)
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Loki smoke test

- [x] **Task 1: Add the live smoke test against local Loki**
  Files: `test/smoke.loki.test.ts`
  Create a new vitest suite that drives the real SDK against a running Loki and skips cleanly when the backend is down. Mirror `backend/verify.sh` (workspace root) in shape, but assert only what *the SDK emitted* is retrievable — this is the SDK's integration test, not a re-test of the backend.

  Start the file with a top-of-file doc comment: what the suite proves, that it requires the local backend (`make backend-up`, Loki at `http://localhost:3100`), and that it self-skips when Loki is unreachable. This comment plus the `test:loki` script name (Task 2) are the discoverability surface — there is no README in this repo and none is created.

  Reachability guard (top-level `await` — valid in vitest ESM; note that no existing suite uses top-level await, so this is a new pattern here, not a copy of `conformance.node.test.ts` which uses `beforeEach`):
  - Before defining tests, probe `GET http://localhost:3100/ready` with a short timeout (`AbortSignal.timeout(2000)`), `.catch(() => false)`.
  - Use `const suite = lokiUp ? describe : describe.skip` so CI without a backend skips instead of failing. Emit a `console.warn` when skipped explaining `make backend-up` is required. (This is test code, not a production path — the no-console rule does not apply.)

  Imports (follow `test/conformance.node.test.ts` conventions):
  - `import '../src/node/index.js';` (side effect: registers the Node ContextManager).
  - `init`, `log`, `flush` from `../src/core/index.js`.
  - `startSpan`, `withSpan` from `../src/node/index.js`.
  - `import { randomUUID } from 'node:crypto';` — **do not** use the global `crypto.randomUUID()`: `globalThis.crypto` can be undefined in the vitest VM on Node 18.x (documented in `conformance.node.test.ts` and guarded against in `src/core/resource.ts`/`span.ts`). The `node:crypto` import is always available and appropriate for this Node-only test.
  - Do **not** stub `fetch` or fake timers — this test must hit the network and use real time.

  Test timeout: the poll-with-retry loop budgets ~10s, which exceeds vitest's default 5000ms per-test timeout (`vitest.config.ts` sets no `testTimeout` override). Set an explicit per-test timeout strictly greater than the poll budget plus flush/network slack — use **`20000`** as the third arg to `it(name, fn, 20000)`. Without this, a healthy-but-slow Loki produces an opaque "test timed out in 5000ms" instead of a meaningful assertion.

  Capture export errors for diagnosability: the SDK degrades silently by contract — a rejected/4xx export never throws into `log()`/`flush()` (`src/core/sdk.ts`, `rules/base.md`), so a broken ingest path would otherwise surface only as the poll loop exhausting its retries with "record not found". Pass an `onError` handler to `init` (`InitOptions.onError` already exists — `src/core/sdk.ts`) that pushes errors into a local array. If the poll loop times out, fail the test with the captured export error(s) if any were recorded; otherwise `console.warn` them. This makes ingest failures diagnosable instead of presenting as a generic timeout.

  Test body:
  1. Generate a unique run id: `const runId = randomUUID();`. Keep a **stable** `project` of `observe-js-smoke` and a stable `service` (e.g. `smoke-service`); isolate this run from accumulated history by the `runId` (carried in the body and as a `run.id` attribute), **not** by a per-run project name. Rationale: `project` is a low-cardinality index label (see ARCHITECTURE.md "OTLP Wire Shape"); a per-run project would create a new persistent stream every run and inflate the local index. Isolation is done via a body line filter instead (below).
  2. `init({ project: 'observe-js-smoke', service: 'smoke-service', endpoint: 'http://localhost:3100/otlp/v1/logs', onError })`.
  3. Open a span and capture its trace id so it can be queried back: `const span = startSpan('smoke'); const traceId = span.traceId;` then `withSpan(span, () => log('info', 'smoke ' + runId, { 'run.id': runId }))`. (`Span.traceId` is a 32-char lowercase hex string — see `src/core/span.ts`.) Embedding `runId` in the message body makes the record uniquely findable via a LogQL line filter.
  4. `await flush()` to drain the batcher through the exporter.
  5. Force visibility exactly like `backend-verify`: `POST http://localhost:3100/flush` (cuts head chunks to the store), then poll for the record. Prefer a short poll-with-retry loop (e.g. up to ~10s, query every ~1s) over a single fixed `sleep` so the test is less flaky.
  6. Query back via `GET /loki/api/v1/query_range`, url-encoded params: `query={project="observe-js-smoke"} |= "<runId>"` (the body line filter isolates this run), `start` = a few minutes ago in ns, `end` = now in ns, `limit=10`. Build both ns bounds with BigInt to match the SDK's own `nowNanoString()` (`src/core/sdk.ts`) and avoid float rounding above `Number.MAX_SAFE_INTEGER`: `(BigInt(Date.now()) * 1_000_000n).toString()` for `end`, and subtract a few minutes for `start`.

  Assertions:
  - **Record retrievable:** the response has `data.result` with at least one stream whose `values` contains the emitted body (`smoke <runId>`).
  - **Label policy (positive containment + negative forbidden):** read the returned stream's `stream` object (the index labels Loki attached). Assert the three required labels are present with the expected values — `project = observe-js-smoke`, `service_name = smoke-service`, `level = info`. Then assert the known high-cardinality labels are **absent** from the index labels — `trace_id`, `span_id`, `service_instance_id` (mirrors the forbidden list in `verify.sh`). Do **not** do a brittle exact key-set `toEqual`: Loki may auto-attach internal labels (e.g. `detected_level`) that vary by version, so the policy intent is captured by required-present + forbidden-absent. Do not rely on the global `/loki/api/v1/labels` endpoint (it aggregates across all suites).
  - **`trace_id` queryable as structured metadata:** issue a second `query_range` with `query={project="observe-js-smoke"} |= "<runId>" | trace_id="<traceId>"` and assert it returns the same record. This is the positive guard that `trace_id` lives in structured metadata (not promoted to an index label).

  Keep helper functions (ns-timestamp builder, query_range caller returning parsed JSON, retry loop) local to this file — no new source modules; `core/`/`node/` stay free of test/backend concerns per the dependency rules in `.ai-factory/ARCHITECTURE.md`.

- [x] **Task 2: Add a dedicated npm script** (depends on Task 1)
  Files: `package.json`
  Add an npm script `test:loki` that runs only the smoke suite: `vitest run test/smoke.loki.test.ts` (no `build` prefix — it imports from `src/`, matching the other `*.node.test.ts` suites). The default `test` script keeps working because the suite self-skips when Loki is unreachable. No README is created — the suite's top-of-file doc comment and this script name are the discoverability surface.
