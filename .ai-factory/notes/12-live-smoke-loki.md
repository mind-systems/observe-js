# 12 — Live smoke vs local Loki

**Task:** ROADMAP → Verification → "Live smoke vs local Loki (required for this SDK)"
**Contract:** `observe-contract@v0.1.2`; mirrors the workspace `backend/verify.sh`
**Depth:** short — same shape as the backend verify, just driven through the SDK instead of curl.

## Goal

Prove the reference SDK actually reaches a running Loki end-to-end — de-risks the whole family before swift/dart copy the approach.

## Design

- Prerequisite: backend up (`make backend-up` in the workspace root). Loki at `http://localhost:3100`.
- `init({ project, service, endpoint: 'http://localhost:3100/otlp/v1/logs' })`; emit a `log` inside a `withSpan` so the record carries a `trace_id`; `flush()`.
- Force visibility like `backend-verify` does (`POST /flush`, brief wait), then query `/loki/api/v1/query_range` for the project.
- Assert: record returned; label set is exactly `project`/`service_name`/`level`; the emitted `trace_id` is queryable as **structured metadata** (`| trace_id="…"`).
- Mark this test as requiring a live backend (skip/guard when Loki isn't reachable in CI), but it is **part of DoD for observe-js** specifically.

## Watch

- Use a unique `project`/run id per run if assertions need isolation from accumulated data (the persistent store now keeps history across runs).
- This is the SDK's own integration test, not a re-test of the backend — keep assertions about *what the SDK emitted* being retrievable.

## Done when

A record emitted by observe-js is retrievable from running Loki with the correct label set and its `trace_id` queryable as structured metadata.
