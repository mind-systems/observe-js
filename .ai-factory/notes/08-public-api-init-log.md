# 08 — Public API: `init` + `log` (reference ergonomics)

**Task:** ROADMAP → Core → "Public API: `init` + `log`"
**Contract:** `observe-contract@v0.1.2` (Public API & semantics; Resource attributes; `service.start` marker; oracle = `service-start.json`)
**Depth:** full — this is the surface swift/dart will copy; the ergonomics matter more than anything else in the SDK.

## Goal

The two calls a host actually uses, wiring resource attributes, the restart marker, ambient trace stamping, batching, and silent degradation together behind a minimal API.

## Design (recommended signatures + semantics)

```ts
interface InitOptions {
  project: string
  service: string
  endpoint: string                 // full OTLP logs URL
  batch?: Partial<BatcherConfig>   // see task 04
  onError?: (err: unknown) => void
}
function init(opts: InitOptions): void
function log(level: Level, msg: string, attrs?: Record<string, unknown>): void
```

- **`init`:** generate `service.instance.id` (UUIDv4); build the resource (`project`, `service.name`, `service.instance.id`); construct exporter (task 03) + batcher (task 04); emit the **`service.start`** marker exactly per `service-start.json` — INFO, `eventName: "service.start"` **and** an `event.name` attribute, body `"service.start"`. Called once at startup.
  - **Idempotency:** second `init` is a no-op + diagnostic warning (first wins). Document this; do not silently re-init.
- **`log`:** build a `LogRecord` (severity from `level` via `levels.json`); `body.stringValue = msg`; merge `attrs` into record attributes; always add the canonical `level` attribute; if a span is active (task 06), stamp `traceId`/`spanId`; enqueue via the batcher. **Never throws** — if not initialized, drop + diagnostic (don't crash the host).
- **Reserved keys:** the SDK owns `level`; if a user `attrs` key collides with a reserved key, SDK value wins (warn). Document the reserved set.

## Edge cases / watch

- `log` before `init`: drop silently + `onError` — never throw.
- Casing: this is the canonical vocabulary; swift/dart adapt only casing (`init`/`log`/`startSpan`/`withSpan`/`inject`/`extract`), not names.
- Keep `init`'s option names clean — they become the de-facto cross-platform config vocabulary.

## Out of scope

`startSpan`/`withSpan` bodies (task 06), the Winston/browser entry points (tasks 09/10).

## Done when

`init` emits a `service.start` payload field-for-field equal to the fixture; `log` produces records that pass conformance and carry the active trace/span id; both never throw (including pre-`init` `log`).
