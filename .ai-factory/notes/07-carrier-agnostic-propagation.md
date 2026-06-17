# 07 — Carrier-agnostic propagation (`inject`/`extract`)

**Task:** ROADMAP → Core → "Carrier-agnostic propagation"
**Contract:** `observe-contract@v0.1.2` (Trace-context propagation — carrier-agnostic; Public API `inject`/`extract`)
**Depth:** full — the carrier abstraction is the contract's v0.1.2 refinement; getting it transport-free here is what keeps gRPC out of the core.

## Goal

Write/read the active trace context as W3C `traceparent` through an abstract carrier, so HTTP headers and gRPC metadata are handled by the same code with **zero transport dependency**.

## Design (recommended signatures)

```ts
interface Carrier {
  get(key: string): string | undefined
  set(key: string, value: string): void
}

function inject(carrier: Carrier, ctx?: Context): void   // ctx defaults to active()
function extract(carrier: Carrier): Context | undefined
```

- **`traceparent` format:** `00-<32hex traceId>-<16hex spanId>-<2hex flags>`. `inject` writes it; if `ctx` omitted, uses the active context; if none, no-op.
- **`extract`:** parse and **validate** — version must be `00`, traceId 32 hex (not all-zero), spanId 16 hex (not all-zero), flags 2 hex. On any mismatch → return `undefined` (ignore malformed; never throw).
- **`tracestate`:** pass through verbatim if present (read in `extract`, written in `inject` when carried on the context). Optional in v0; at minimum don't corrupt it.
- **Adapters:** ship trivial carrier wrappers so hosts don't implement the interface by hand — e.g. wrap a plain `Record<string,string>`, a `Headers` object, and (at integration time, by the host) a gRPC `Metadata` object. The core ships only the plain-object/`Headers` wrappers; gRPC stays host-side.

## Edge cases / watch

- `extract` returns a `Context`; **binding it into ambient is the caller's choice** (e.g. `ctxManager.with(extract(carrier)!, handler)` in a server interceptor). Keep extract pure — don't auto-bind.
- Header case-insensitivity: HTTP header carriers should look up `traceparent` case-insensitively; gRPC metadata keys are already lowercase.
- Never throw on a missing or junk header — that path runs on every inbound request.

## Out of scope

gRPC library wiring (`@grpc/grpc-js`) — done by the consumer at integration time; the core only sees a `Carrier`.

## Done when

inject→extract round-trips a context over a plain object; a malformed `traceparent` yields `undefined` without throwing; injected header matches the W3C format exactly.
