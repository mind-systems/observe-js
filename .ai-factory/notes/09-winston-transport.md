# 09 — Node adapter: Winston transport

**Task:** ROADMAP → Adapters → "Node adapter — Winston transport"
**Contract:** `observe-contract@v0.1.2` (Recommended host → canonical mapping — Winston row)
**Depth:** medium — the level map is in the contract; the work is the transport glue and its packaging.

## Goal

A Winston transport that ships records through the SDK, so a NestJS/Winston host changes only its `transports` array — no call sites.

## Packaging note (from task 01)

The `./winston` subpath export and its tsup entry (`src/node/winston.ts` in the **node** platform config) are **already scaffolded in task 01** — `package.json` and `tsup.config.ts` do not change in this task. The exports condition block was written with `types` first per the C1 constraint: `{ "types": …/winston.d.ts, "import": …/winston.mjs, "require": …/winston.cjs }`. This task replaces the stub body with the real implementation only. Run `attw --pack .` after building to confirm the subpath's types resolution is still clean.

## Design

- The subpath export `observe-js/winston` (node-only) and its tsup entry already exist. Implement Winston's `Transport` interface (`log(info, callback)`) inside `src/node/winston.ts`.
- Map Winston level → canonical token per the contract: `error→error`, `warn→warn`, `info→info`, `http→debug`, `verbose→debug`, `debug→debug`, `silly→trace`. Unknown levels → nearest by meaning (default `info`).
- In `log(info, cb)`: translate level, take `info.message` as `msg`, pass remaining Winston meta as `attrs`, call the SDK `log(...)`, then `cb()`. Must be additive — the host keeps its console/file transports.
- Assumes the host already called `init` at bootstrap (document this prerequisite; the transport does not call `init`).

## Edge cases / watch

- Winston meta can include `Symbol`-keyed fields (`level`, `message`, `splat`) — strip those from `attrs`, keep only user fields.
- Never throw out of the transport `log` (would surface in the host logger) — the SDK `log` is already non-throwing; keep the callback always called.

## Out of scope

Browser/framework adapters (task 10). The SDK core (`init`/`log`).

## Done when

A Winston logger with this transport added produces SDK records that pass conformance; Winston levels map per the contract table; host console/file transports still work; `attw --pack .` passes with the `./winston` subpath clean.
