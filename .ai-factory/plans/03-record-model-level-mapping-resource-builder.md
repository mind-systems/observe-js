# Plan: Record model + level mapping + resource builder

## Context
Add the platform-neutral OTLP/JSON type model, the canonical level→severity table sourced from the contract submodule's `levels.json` (not re-declared), and a resource builder that emits exactly `project`, `service.name`, and a fresh UUIDv4 `service.instance.id`. These live in `src/core/` and are the foundation the exporter (task 03/note 03) and public API (note 08) build on.

## Settings
- Testing: yes (milestone "Done when" requires unit tests for every level and the resource shape)
- Logging: minimal
- Docs: no

## Key facts (from recon)
- Contract submodule is checked out at `contract/` (path per `.gitmodules`), pinned to `v0.1.2`. Source files: `contract/levels.json`, `contract/golden-record.json`, `contract/fixtures/service-start.json`.
- `levels.json` shape: `{ version, levels: { trace|debug|info|warn|error|fatal: { severityNumber, severityText } } }`. Has a `$comment` key at top level.
- Golden record uses camelCase OTLP/JSON: `resourceLogs[] → { resource:{attributes[]}, scopeLogs[] → { scope:{name,version}, logRecords[] } }`. Scope is `{ name: "observe", version: "0.1.0" }`. `AnyValue` seen: `{ stringValue }`; contract also defines `{ intValue: "<decimal string>" }`, `{ boolValue }`, `{ doubleValue }`. `severityNumber` is an integer, `traceId`/`spanId` lowercase hex strings, `flags` a JSON number, `timeUnixNano`/`observedTimeUnixNano` decimal strings.
- Core rules (`.ai-factory/ARCHITECTURE.md`): `core/` imports nothing outside itself, no Node/browser globals beyond what is isomorphic, zero runtime deps. UUID via the isomorphic Web global `crypto.randomUUID()` (Node 18+ and browsers) — no `node:crypto` import.
- `src/core/index.ts` is currently a stub exporting `__sdk`. `tsconfig.json` does **not** yet set `resolveJsonModule`. `exclude` lists `contract`, but an explicit JSON import from `src/` still pulls the file into the program — that is intended here.

## Assumptions
- **`levels.json` is consumed via a direct JSON import** in `src/core/levels.ts`. tsup/esbuild inlines imported JSON into the bundle at build time, so `dist/` stays self-contained even though `contract/` is a dev-time submodule excluded from the published `files`. This is the most literal reading of note 02 ("import the canonical level table from the submodule's `levels.json` — not re-declared"). If a later build constraint forbids importing across the project root, the fallback is a small generate step emitting a committed `src/core/levels.generated.ts` from `contract/levels.json` — out of scope unless the import approach fails the build.
- The fixed instrumentation scope (`{ name: "observe", version: "0.1.0" }`) and full request assembly belong to the exporter (note 03) and are **not** built here; this task only defines the `InstrumentationScope` type.

## Tasks

### Phase 1: Wire types + level table

- [x] **Task 1: OTLP/JSON wire type model**
  Files: `src/core/wire.ts`
  Declare the camelCase OTLP/JSON types mirroring the contract Wire section:
  - `AnyValue` = union of `{ stringValue: string }` | `{ intValue: string }` | `{ boolValue: boolean }` | `{ doubleValue: number }`.
  - `KeyValue` = `{ key: string; value: AnyValue }`.
  - `LogRecord` = `{ timeUnixNano: string; observedTimeUnixNano?: string; severityNumber: number; severityText: string; eventName?: string; body: AnyValue; attributes: KeyValue[]; traceId?: string; spanId?: string; flags?: number }`.
  - `InstrumentationScope` = `{ name: string; version?: string }`.
  - `ScopeLogs` = `{ scope: InstrumentationScope; logRecords: LogRecord[] }`.
  - `Resource` = `{ attributes: KeyValue[] }`.
  - `ResourceLogs` = `{ resource: Resource; scopeLogs: ScopeLogs[] }`.
  - `ExportLogsServiceRequest` = `{ resourceLogs: ResourceLogs[] }`.
  Also add small constructor helpers used by the resource builder (and later the exporter): `stringValue(v: string): AnyValue` and `kv(key: string, value: AnyValue): KeyValue`. Keep value names exactly as the contract spells them. No serialization logic here.

- [x] **Task 2: Canonical level mapping from `levels.json`** (depends on Task 1)
  Files: `tsconfig.json`, `src/core/levels.ts`
  - In `tsconfig.json`, add `"resolveJsonModule": true` to `compilerOptions` so the JSON import type-checks. Leave `exclude` as-is.
  - In `src/core/levels.ts`, `import levelsData from '../../contract/levels.json'` and expose the table sourced from it — **do not** hardcode severity numbers/text.
  - Declare the `Level` union type explicitly: `'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'` (per note 02: union of the keys in `levels.json`).
  - Export a typed `LEVELS: Record<Level, { severityNumber: number; severityText: string }>` derived from `levelsData.levels` (ignore the top-level `$comment`/`version` keys), plus a `severityFor(level: Level)` accessor returning `{ severityNumber, severityText }`.
  - Add a module-load runtime guard that asserts the keys present in `levelsData.levels` match the `Level` union exactly (no missing/extra), so a contract bump that adds/removes a level fails fast. Keep the guard small and dependency-free.

### Phase 2: Resource builder + exports

- [x] **Task 3: Resource builder with fresh UUIDv4 instance id** (depends on Task 1)
  Files: `src/core/resource.ts`
  Implement `buildResource(project: string, service: string): Resource` that returns a `Resource` whose `attributes` are **exactly** three `KeyValue`s, in this order, using the `stringValue`/`kv` helpers:
  - `project` = `project`
  - `service.name` = `service`
  - `service.instance.id` = a fresh UUIDv4 generated via `crypto.randomUUID()` (isomorphic Web global; no `node:crypto` import).
  Each call generates a new instance id (per `init`/process start, per the contract). Nothing else is added — enforce attribute discipline. No logging, no side effects beyond the return value.

- [x] **Task 4: Re-export the core model from `core/index.ts`** (depends on Tasks 1-3)
  Files: `src/core/index.ts`
  Re-export the public-to-internal surface from the new modules (wire types, `Level`/`LEVELS`/`severityFor`, `buildResource`, and the `stringValue`/`kv` helpers) so later tasks (exporter note 03, public API note 08) import from `core/`. Keep the existing `__sdk` export intact (the smoke test depends on it). Do not change `package.json` exports — public API surfacing is note 08's job.

### Phase 3: Unit tests

- [x] **Task 5: Level mapping tests** (depends on Tasks 2, 4)
  Files: `test/levels.test.ts`
  Vitest suite importing from `src/core` and from `contract/levels.json`:
  - For **every** level key in `contract/levels.json`, assert `LEVELS`/`severityFor` returns the exact `severityNumber` and `severityText` from the file (iterate the file, don't hand-list).
  - Assert the `Level` union is covered exactly: the set of keys in `LEVELS` equals the set of keys in `contract/levels.json` (no missing/extra), confirming the load-time guard's invariant.

- [x] **Task 6: Resource builder tests** (depends on Tasks 3, 4)
  Files: `test/resource.test.ts`
  Vitest suite for `buildResource`:
  - Returns exactly 3 attributes with keys `project`, `service.name`, `service.instance.id` (assert count and key set/order).
  - `project` and `service.name` carry the passed-in values as `{ stringValue }`.
  - `service.instance.id` value matches a UUIDv4 regex (`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`).
  - Two separate calls produce different `service.instance.id` values (freshness per start).

## Commit Plan
- **Commit 1** (after tasks 1-4): "Add OTLP wire types, level mapping, and resource builder"
- **Commit 2** (after tasks 5-6): "Add unit tests for level mapping and resource builder"
