# 02 — Record model + level mapping + resource builder

**Task:** ROADMAP → Foundation → "Record model + level mapping + resource builder"
**Contract:** `observe-contract@v0.1.2` (Wire, Resource attributes, Level mapping; oracle = `golden-record.json`, `levels.json`)
**Depth:** short — the shape is pinned by the contract and its fixtures; this is mostly typing what already exists.

## Goal

TypeScript types for the OTLP/JSON log payload and the resource, plus the canonical level mapping imported from the contract — not re-declared.

## Design

- Types mirror the contract's Wire section: `ExportLogsServiceRequest → resourceLogs[] → { resource, scopeLogs[] → { scope, logRecords[] } }`. Field names camelCase. `AnyValue` union (`stringValue`/`intValue` as string/`boolValue`/`doubleValue`).
- **Levels:** import `contract/levels.json` as the source of `level → { severityNumber, severityText }`. Do **not** hardcode the table — the conformance test (task 11) will diff against this file anyway.
- **Resource builder:** sets exactly `project`, `service.name`, `service.instance.id` (UUIDv4, fresh per `init`). Nothing else (attribute discipline).
- `Level` type = the union of keys in `levels.json` (`'trace'|'debug'|'info'|'warn'|'error'|'fatal'`).

## Out of scope

Serialization details (exporter, task 03), ambient/trace stamping (tasks 05–06).

## Done when

Unit tests assert: every level maps to the contract's severityNumber/severityText; the resource carries exactly the three keys with a UUIDv4 instance id.
