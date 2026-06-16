# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A thin, generic **isomorphic JavaScript/TypeScript logging SDK that speaks OpenTelemetry OTLP/HTTP** — one package that runs both server-side (Node) and in the browser. It is one target in a multi-platform SDK family; every target exposes the same minimal API and emits the same OTLP shape, so a backend sees a uniform stream regardless of which platform produced it.

The SDK is an integration surface, not an application. A host wires it in at a single point — the place its existing logger flushes output — and nothing else in the host changes. The SDK owns transport (OTLP/HTTP), the record shape, ambient trace correlation, and graceful degradation; it owns no business logic and no backend knowledge.

## One package, two runtimes

The package is isomorphic. A **platform-neutral core** holds everything identical across runtimes — the record model, level mapping, the `fetch`-based OTLP/HTTP exporter, batching, and resource attributes. Two thin platform layers differ and are selected automatically through `package.json` conditional `exports` (`node` / `browser` / `import` conditions), so Node and bundlers each resolve the right entry and the browser bundle never pulls in Node-only code:

- **Node layer** — ambient context via `AsyncLocalStorage`, plus an adapter that plugs into a host's logging library (e.g. a Winston transport).
- **Browser layer** — ambient context via `Zone`, plus a framework-agnostic wrapper usable from any web UI framework.

Keeping the contract in one package is the point: there is a single source of truth for the record shape and public API, with only context and adapters varying by runtime.

## The contract (OTLP boundary)

The SDK's only knowledge of the outside world is **one OTLP endpoint URL**, supplied by configuration. It posts OTLP log records over HTTP to that URL. It never encodes anything backend-specific — no storage engine, no query language, no vendor API. The backend behind the endpoint is swappable without touching this SDK.

This contract is shared verbatim across all platform targets in the family. Changing the public API, the resource attributes, or the wire format here means changing it everywhere — treat those three as frozen and cross-platform.

## Public API

A uniform, minimal surface (identical between the Node and browser entries):

- `init(project, service)` — sets the resource attributes (`project`, `service.name`, a fresh `service.instance.id`) and emits the `service.start` restart marker.
- `log(level, msg, attrs?)` — the one call the host's logging sink makes. Accepts a level, a message, and optional structured attributes.
- `startSpan` / `withSpan` — open trace spans. Logs carry `trace_id` from the active span today; span export over the same OTLP endpoint is additive later.
- context `inject` / `extract` — write/read trace context for outbound and inbound calls: HTTP `traceparent` header and gRPC metadata.

## Resource attributes & restart marker

Every record carries `project`, `service.name`, and `service.instance.id`. The instance id is generated fresh on each `init` (each process / page load), and `init` emits a `service.start` event. "Everything since the last restart" is then a query for records after the latest `service.start` for that service — so make the marker reliable and the instance id genuinely per-start.

## Ambient trace context

`trace_id` is never threaded through call-site arguments. It flows through ambient storage — **`AsyncLocalStorage`** in Node, **`Zone`** in the browser — so call sites stay untouched. `withSpan` binds the ambient context for the duration of the enclosed work. In the browser, a trace typically originates on a user action and propagates outward from there.

## Trace propagation

Outbound: `inject` writes `traceparent` into HTTP headers and trace context into gRPC metadata. Inbound: `extract` reconstructs the context from the same carriers and binds it ambiently so downstream logs share the `trace_id`. Propagation is the SDK's job; the host's request code does not handle correlation ids.

## Never break the host

A failed, slow, or unreachable export must **degrade silently** — drop or buffer — and never throw back into the caller's `log` path. Export runs off the caller's path; `log` returns promptly. Bound the buffer and drop oldest under pressure rather than growing without limit or blocking.

## Attribute discipline

The SDK always sets exactly the small fixed set of primary identifying attributes (`project`, `service`, `level`). Everything else — `trace_id`, entity ids, free text — goes into the record body / attributes, never added as further top-level identifying dimensions. This keeps the identifying set low-cardinality for any backend that indexes it.

## Distribution

Consumers add the SDK as a **git dependency, pinned to a tag** (e.g. `git+https://…#v0.1.0` in `package.json`). There is no npm registry release. Tag releases deliberately; pinned consumers upgrade by bumping the tag.

## Language

All files — code, docs, config — are written in **English**, regardless of the conversation language.
