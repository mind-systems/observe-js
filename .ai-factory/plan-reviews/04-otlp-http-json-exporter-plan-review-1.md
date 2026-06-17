# Plan Review: 04 — OTLP/HTTP JSON exporter

**Plan file:** `.ai-factory/plans/04-otlp-http-json-exporter.md`
**Risk Level:** 🟢 Low — solid, implementable as written. Findings below are non-blocking nits.

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** ✅ PASS. New code lands in `src/core/` (`encode.ts`, `exporter.ts`) and the core barrel — respects the `core/ → nothing outside itself` rule. The only globals used (`fetch`, `AbortSignal.timeout`) are isomorphic Web standards, not Node- or browser-specific, so the "core never imports Node or browser globals" rule is honored (ROADMAP baseline explicitly says "Global `fetch` on both — isomorphic").
- **Rules (`.ai-factory/rules/base.md`):** ✅ PASS. File names are kebab/lowercase, error handling matches "export failures degrade silently — never throw into the host's log path", and "no console output" is honored (diagnostics go to `onError` only).
- **Roadmap (`.ai-factory/ROADMAP.md`):** ✅ PASS. Maps directly to Core → "OTLP/HTTP JSON exporter" (accept 200/204, degrade silently). Correctly defers batching to the next task and conformance to task 11. Spec note `03-otlp-http-exporter.md` is followed faithfully (signatures, defaults, success codes, edge cases).

## Critical Issues

None. The plan is internally consistent, file paths are correct, and the API usage (`fetch`, `AbortSignal.timeout`, `.js` import specifiers under `verbatimModuleSyntax` + Bundler resolution) matches the existing codebase conventions.

## Findings (non-blocking)

### 1. WARN — "200 or 204" vs "non-2xx" wording is internally inconsistent
Task 2 says *"Treat HTTP 200 or 204 as success; everything else (non-2xx, network rejection, `AbortError`) is a failure."* "non-2xx" implies all `2xx` succeed, but a strict `200 || 204` check would treat `201/202/206` as failures. This matches the contract's deliberate choice (Loki=204, OTLP spec=200), so it's not wrong — but the implementer should pick one rule explicitly. Recommend either keying off `response.ok` (any 2xx) or keeping the strict `status === 200 || status === 204` and dropping the misleading "non-2xx" phrasing. Low impact in practice (Loki only ever returns 204).

### 2. WARN — "record builder from task 02" assumption is inaccurate
Existing-groundwork line states encodings are fixed "by the record/resource builders from task 02." There is **no record builder** in the codebase — task 02 delivered the `LogRecord` *type* (`src/core/wire.ts`), the level table, and the *resource* builder only (`src/core/resource.ts`). A record builder arrives later (Public API `init`+`log`, ROADMAP task 08). This does not affect this task — `encodeLogs` only restructures records it is given — but the encode unit test (Task 4) must **hand-author `LogRecord` literals**, not call a builder. Worth correcting the wording so the implementer doesn't search for a non-existent helper.

### 3. INFO — Empty-batch behavior unspecified
`export([])` would POST an envelope with `logRecords: []`. The batcher (task 04) likely won't call with an empty array, but a one-line short-circuit (`if (records.length === 0) return;` before building/POSTing) avoids pointless requests and is cheap. Consider adding it to Task 2's behavior, or explicitly note it as the batcher's responsibility.

### 4. INFO — `verbatimModuleSyntax` requires type-only imports in `encode.ts`
`encode.ts` imports only types (`Resource`, `LogRecord`, `InstrumentationScope`, `ExportLogsServiceRequest`). With `verbatimModuleSyntax: true` (see `tsconfig.json`) these must be `import type { … } from './wire.js'` (or inline `type` modifiers, as `resource.ts` does). `exporter.ts` imports the value `encodeLogs` plus types, so it needs a mixed/inline-`type` import. Pure implementation detail, but flagging since the build will error otherwise.

### 5. INFO — `encodeLogs` scope param is unused by the exporter
Task 1 gives `encodeLogs` an optional `scope` argument, but Task 2 always calls `encodeLogs(config.resource, records)` (DEFAULT_SCOPE only). That's fine — the param is exercised by the encode unit test and is reasonable forward-extensibility — just confirming it's intentional that the exporter offers no scope override in v0.

## Positive Notes

- Scope discipline is excellent: assembles the envelope + transport only, explicitly defers field-level conformance (task 11), batching (task 04), and trace stamping (upstream `log`).
- Failure semantics are precisely specified and testable: single try/catch wrapping the whole body, `onError` invoked exactly once, resolves normally, `AbortError`/network/non-2xx all covered. The test matrix (success 200 + 204, three distinct failure modes, and a no-`onError` failure) is thorough and directly verifies the never-break-the-host invariant.
- `DEFAULT_SCOPE = { name: 'observe', version: '0.1.0' }` correctly matches both `golden-record.json` and `fixtures/service-start.json`.
- Endpoint handling (full logs URL, no Loki path appending) and `content-type: application/json` match the frozen contract (`otlp-logging-contract.md` line 14) and spec note 03.
- Barrel re-export step (Task 3) is not forgotten and follows the existing `export` / `export type` split in `src/core/index.ts`.

PLAN_REVIEW_PASS
