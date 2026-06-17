# 11 — Contract conformance test (offline)

**Task:** ROADMAP → Verification → "Contract conformance test (offline — required)"
**Contract:** `observe-contract@v0.1.2` (golden fixtures = the oracle)
**Depth:** short — the oracle already exists; this is the harness that diffs against it. (It is, however, a reference artifact swift/dart will copy, so keep it clean.)

## Goal

Prove observe-js serializes exactly what the frozen contract pins, with no live backend.

## Design

- Read fixtures from the submodule: `contract/golden-record.json`, `contract/fixtures/service-start.json`, `contract/levels.json`.
- Build the equivalent record(s) through the SDK using the fixtures' example values (same project/service/ids/timestamps) and assert **deep field-for-field equality** with the golden JSON.
- Assert the SDK's level table equals `contract/levels.json` (every token → severityNumber/severityText).
- Run under `vitest`; this suite gates the build.

## Watch

- Normalize nothing away — the point is byte/field exactness (camelCase, integer `severityNumber`, hex ids, decimal-string timestamps).
- Pin is `v0.1.2`; if the submodule is at another tag the test setup should fail loudly.

## Done when

`vitest` conformance suite is green against `observe-contract@v0.1.2`; a deliberate field-shape regression makes it fail.
