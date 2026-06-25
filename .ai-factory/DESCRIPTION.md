# observe-js

## Overview

A thin, isomorphic TypeScript/JavaScript logging SDK that emits OpenTelemetry OTLP/HTTP. One package runs both server-side (Node) and in the browser. Part of a multi-platform SDK family — every target in the family exposes the same minimal API and emits the same OTLP wire format, so the backend sees a uniform stream regardless of platform.

## Core Features

- Isomorphic package with a platform-neutral core (record model, OTLP/HTTP exporter, batching, resource attributes) and two thin platform layers selected automatically via `package.json` conditional `exports`
- Node layer: ambient trace context via `AsyncLocalStorage`; Winston transport adapter
- Browser layer: ambient trace context via `Zone`; framework-agnostic wrapper
- Graceful degradation — export failures never throw into the caller's log path
- Bounded buffer with drop-oldest-under-pressure policy
- Trace propagation: `inject` / `extract` for HTTP `traceparent` and gRPC metadata

## Tech Stack

- **Language:** TypeScript
- **Runtime targets:** Node.js 18+, Browser (framework-agnostic)
- **Wire protocol:** OTLP/HTTP (JSON)
- **Build:** `tsup` — dual ESM+CJS via array of two config objects (one per `platform`); `clean: false` on both configs (cleaning owned by `npm run clean`)
- **Tests:** `vitest` — `npm test` runs `build` first (smoke test reads `dist/`)
- **Types validation:** `@arethetypeswrong/cli` — `attw --pack .` must pass; per-format `.d.cts` declarations for `require` conditions
- **Contract:** `observe-contract` v0.1.2 content-inlined as plain tracked files at `contract/` (not a submodule)
- **Distribution:** git dependency pinned to a tag (no npm registry)

## Public API

- `init(project, service)` — resource attributes + `service.start` marker
- `log(level, msg, attrs?)` — the one call the host sink makes
- `startSpan` / `withSpan` — span lifecycle; logs carry `trace_id` from the active span
- `inject` / `extract` — trace context propagation for HTTP headers and gRPC metadata

## Architecture

See `.ai-factory/ARCHITECTURE.md` for module boundaries and dependency rules.
Pattern: Structured Modules (Technical Layers)
