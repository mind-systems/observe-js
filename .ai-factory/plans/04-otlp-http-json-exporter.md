# Plan: OTLP/HTTP JSON exporter

## Context
Add the core transport: assemble a batch of `LogRecord`s into a contract-exact OTLP/JSON `ExportLogsServiceRequest` and POST it over global `fetch`, degrading silently on any failure so the host is never affected.

## Settings
- Testing: yes
- Logging: minimal
- Docs: no

## Existing groundwork (do not rebuild)
- `src/core/wire.ts` already defines all OTLP/JSON types (`AnyValue`, `KeyValue`, `LogRecord`, `ScopeLogs`, `Resource`, `ResourceLogs`, `ExportLogsServiceRequest`) plus `stringValue`/`kv` helpers. Field-level encoding (camelCase, `severityNumber` int, decimal-string `timeUnixNano`, lowercase-hex `traceId`/`spanId`, `AnyValue` shapes) is fixed by these types and by the record/resource builders from task 02 — **this task assembles the request envelope and posts it; it does not redefine field encodings.**
- `src/core/resource.ts` exports `buildResource(project, service)` → `Resource`.
- `src/core/index.ts` is the single re-export barrel for the core; new core modules must be surfaced here.
- Golden oracle: `contract/golden-record.json` and `contract/fixtures/service-start.json`. Both nest records under a fixed scope `{ name: "observe", version: "0.1.0" }`. Full field-for-field conformance is a separate task (11) — keep that out of scope here.
- Contract endpoint shape: a full logs URL such as `http://localhost:3100/otlp/v1/logs` (SDK never appends Loki paths).
- Tests live in `test/**/*.test.ts` (vitest, `environment: node`).

## Tasks

### Phase 1: Envelope encoder

- [x] **Task 1: OTLP/JSON envelope encoder**
  Files: `src/core/encode.ts`
  Add a pure function `encodeLogs(resource: Resource, records: LogRecord[], scope?: InstrumentationScope): ExportLogsServiceRequest` that wraps the given resource and records into the nested `resourceLogs[] → { resource, scopeLogs[] → { scope, logRecords } }` envelope. Export a `DEFAULT_SCOPE` constant equal to `{ name: 'observe', version: '0.1.0' }` (matches the golden fixtures) and use it when `scope` is omitted. The function must be deterministic and side-effect free: it only restructures values it is given (no clock, no id generation, no mutation of inputs). Import types from `./wire.js`. The result must be `JSON.stringify`-able into exactly the golden envelope shape.

### Phase 2: Transport

- [x] **Task 2: `fetch`-based exporter with silent failure** (depends on Task 1)
  Files: `src/core/exporter.ts`
  Define `interface Exporter { export(records: LogRecord[]): Promise<void> }` (resolves after the attempt regardless of outcome; never rejects) and `interface ExporterConfig { endpoint: string; resource: Resource; timeoutMs?: number; onError?: (err: unknown) => void }`. Note: `resource` is bound at construction (extends the note's config) so `export(records)` keeps the contract's signature — the resource is created once at `init` and reused. Add `createExporter(config: ExporterConfig): Exporter`.
  Behavior of `export(records)`:
  - Build the body via `encodeLogs(config.resource, records)`; `JSON.stringify` it.
  - `POST` with global `fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(config.timeoutMs ?? 5000) })`.
  - Treat HTTP **200 or 204** as success; everything else (non-2xx, network rejection, `AbortError` from timeout) is a failure.
  - On any failure: **swallow it**, call `config.onError?.(err)` if present, drop the batch (no retry in v0), and resolve normally. Never rethrow. Wrap the whole body in try/catch so a thrown/rejected `fetch` cannot escape.
  - Do not route diagnostics through any host logger (would loop) — only `onError`.
  - Add a short comment noting retry/backoff and a pluggable transport (browser `sendBeacon` on unload) are deferred future knobs.

### Phase 3: Surface + tests

- [x] **Task 3: Re-export from core barrel** (depends on Task 1, Task 2)
  Files: `src/core/index.ts`
  Export `encodeLogs` and `DEFAULT_SCOPE` from `./encode.js`, and `createExporter` plus the `Exporter`/`ExporterConfig` types from `./exporter.js`, following the existing `export` / `export type` style in the file.

- [x] **Task 4: Unit tests — encode shape + exporter semantics** (depends on Task 3)
  Files: `test/exporter.test.ts`
  Cover with vitest (stub global `fetch` via `vi.stubGlobal` / `vi.fn`; restore in `afterEach`):
  - `encodeLogs` produces the correct nested envelope for a sample resource + record, with `DEFAULT_SCOPE` applied and a custom scope honored when passed.
  - Success path: a fake `fetch` resolving `{ ok: true, status: 200 }` (and a second case `204`) — `export` resolves, and the request was made to the configured `endpoint` with `method: 'POST'` and `content-type: application/json`; assert the posted body parses back to the expected `ExportLogsServiceRequest`.
  - Failure paths, each asserting `export` resolves (no throw) and `onError` is invoked exactly once: (a) `fetch` rejects with a network error, (b) `fetch` resolves non-2xx (e.g. `500`), (c) timeout — `fetch` rejects with an `AbortError`.
  - A case with no `onError` provided where `fetch` rejects, asserting `export` still resolves without throwing.
