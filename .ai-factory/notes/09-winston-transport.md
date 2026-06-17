# 09 — Node adapter: Winston transport

**Task:** ROADMAP → Adapters → "Node adapter — Winston transport"
**Contract:** `observe-contract@v0.1.2` (Recommended host → canonical mapping — Winston row)
**Depth:** medium — the level map is in the contract; the work is the transport glue and its packaging.

## Goal

A Winston transport that ships records through the SDK, so a NestJS/Winston host changes only its `transports` array — no call sites.

## Design

- Expose as a **subpath export** `observe-js/winston` (node-only). Implement Winston's `Transport` interface (`log(info, callback)`).
- Map Winston level → canonical token per the contract: `error→error`, `warn→warn`, `info→info`, `http→debug`, `verbose→debug`, `debug→debug`, `silly→trace`. Unknown levels → nearest by meaning (default `info`).
- In `log(info, cb)`: translate level, take `info.message` as `msg`, pass remaining Winston meta as `attrs`, call the SDK `log(...)`, then `cb()`. Must be additive — the host keeps its console/file transports.
- Assumes the host already called `init` at bootstrap (document this prerequisite; the transport does not call `init`).

## Edge cases / watch

- Winston meta can include `Symbol`-keyed fields (`level`, `message`, `splat`) — strip those from `attrs`, keep only user fields.
- Never throw out of the transport `log` (would surface in the host logger) — the SDK `log` is already non-throwing; keep the callback always called.

## Out of scope

Browser/framework adapters (task 10). The SDK core (`init`/`log`).

## Done when

A Winston logger with this transport added produces SDK records that pass conformance; Winston levels map per the contract table; host console/file transports still work.
