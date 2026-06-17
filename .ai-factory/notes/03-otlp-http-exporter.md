# 03 — OTLP/HTTP JSON exporter

**Task:** ROADMAP → Core → "OTLP/HTTP JSON exporter"
**Contract:** `observe-contract@v0.1.2` (Wire + OTLP/JSON encoding rules; oracle = `golden-record.json`)
**Depth:** full — content-type, success codes, and error semantics are not in the contract and must be decided here once for the family.

## Goal

Take a batch of records, serialize to OTLP/JSON exactly per contract, POST to the configured endpoint, and **never throw into the caller**.

## Design (recommended signatures + defaults)

```ts
interface Exporter {
  // never rejects; resolves after the attempt regardless of outcome
  export(records: LogRecord[]): Promise<void>
}
interface ExporterConfig {
  endpoint: string          // FULL logs URL, e.g. http://localhost:3100/otlp/v1/logs
  timeoutMs?: number        // default 5000
  onError?: (err: unknown) => void  // internal diagnostics hook (NOT the host logger)
}
```

- **Endpoint:** a full logs URL (not a base). Keeps the SDK backend-agnostic — it never appends Loki-specific paths.
- **Serialization:** by hand per contract — camelCase fields, `severityNumber` **integer**, `traceId`/`spanId` **lowercase hex**, `timeUnixNano`/`observedTimeUnixNano` **decimal strings**, `AnyValue` shapes, `flags` as a number. Field-for-field equal to `golden-record.json`.
- **Request:** `fetch(endpoint, { method:'POST', headers:{'content-type':'application/json'}, body, signal: AbortSignal.timeout(timeoutMs) })`.
- **Success:** HTTP **200 or 204** (Loki returns 204; OTLP spec says 200). Both OK.
- **Failure semantics (never break host):** any non-2xx, network error, or timeout → swallow, call `onError` if present, **drop the batch** (no retry in v0). Never rethrow. A retry/backoff policy is deferred; note it as a future knob.

## Edge cases / watch

- `fetch` timeout via `AbortSignal.timeout` — handle the resulting `AbortError` as a normal failure.
- Browser unload: a normal `fetch` may be cancelled on navigation. The browser layer (task 10) may prefer `navigator.sendBeacon` for flush-on-unload — keep the exporter pluggable so that path can swap the transport.
- Do not log the export failure through any host logger (would loop). Diagnostics go only to `onError`.

## Out of scope

Buffering/flush scheduling (task 04 wraps this), trace stamping (handled upstream in `log`).

## Done when

Posts a payload Loki accepts (200/204); a unit test with a stubbed failing `fetch` proves `export` resolves without throwing and invokes `onError`.
