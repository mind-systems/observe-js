# Plan: Carrier-agnostic propagation (`inject`/`extract`)

## Context
Add W3C `traceparent` read/write over an abstract `{ get, set }` carrier in `core/`, so HTTP headers and gRPC metadata are handled by identical, transport-free code.

## Settings
- Testing: yes (round-trip + malformed handling is the milestone's "Done when")
- Logging: minimal
- Docs: no

## v0 boundaries (deliberate, not bugs)
- **`tracestate` survives only a direct `extract`→`inject`.** `traceState` is added to `Context` only, **not** to `Span`; `startSpan`/`withSpan` build a `Context` from `{ traceId, spanId, traceFlags }` only (`span.ts:122-124`). So an inbound `extract` → `bindContext`/`withSpan` → child `startSpan` chain drops `tracestate` for downstream child spans. This matches the contract's "Optional in v0; at minimum don't corrupt it" — verbatim pass-through is guaranteed only for a direct carrier→carrier hand-off without an intervening span. Carrying `tracestate` through spans is deferred (arrives with Tempo span export). Do **not** add `traceState` to `Span` in this milestone.

## Tasks

### Phase 1: Propagation core

- [x] **Task 1: Propagation module — `Carrier`, `traceparent` format/parse, `inject`, `extract`**
  Files: `src/core/propagation.ts`, `src/core/context.ts`
  Create a new platform-neutral module (imports nothing outside `core/`, mirroring the header comment style of `span.ts`/`context.ts`).
  - Define `interface Carrier { get(key: string): string | undefined; set(key: string, value: string): void }`.
  - Internal `formatTraceparent(ctx: Context): string` → `00-<32hex traceId>-<16hex spanId>-<2hex flags>`, where flags = `ctx.traceFlags` rendered as 2-char zero-padded lowercase hex (mask to a byte).
  - Internal `parseTraceparent(value: string): Context | undefined` — validate strictly: exactly 4 dash-separated fields; version `00`; traceId 32 lowercase hex and **not** all-zero; spanId 16 lowercase hex and **not** all-zero; flags 2 hex. Reuse the all-zero/hex-shape logic already proven in `span.ts` (re-implement locally; do not export private helpers across modules). On any mismatch return `undefined`. Never throw. **On success, convert the validated 2-hex flags field to a number via `parseInt(flags, 16)` and place it on `Context.traceFlags`** — this hex→number step is what makes the round-trip `traceFlags` assertion hold; validating the field without parsing it would leave `traceFlags` unset.
  - `export function inject(carrier: Carrier, ctx?: Context): void` — when `ctx` is omitted, use `getActiveContext()` (imported from `./context.js`); if still `undefined`, no-op. Otherwise `carrier.set('traceparent', formatTraceparent(ctx))`.
  - `export function extract(carrier: Carrier): Context | undefined` — read `carrier.get('traceparent')`; if absent/junk → `undefined`; else return the parsed `Context`. Keep it **pure** — do not bind into ambient context (the caller decides via `runWithContext`/`bindContext`).
  - `tracestate` pass-through: add an optional `traceState?: string` field to the `Context` interface in `src/core/context.ts` (purely additive optional field — does not affect existing ambient logic, and leaves `toEqual(ctx)` assertions in `span.node.test.ts` intact since it stays undefined there). In `extract`, if `carrier.get('tracestate')` is present, set it on the returned `Context`. In `inject`, when `ctx.traceState` is present, also `carrier.set('tracestate', ctx.traceState)`. Never synthesize or mutate tracestate beyond verbatim copy. (See "v0 boundaries" — this does not propagate through spans in v0.)

- [x] **Task 2: Carrier adapters for plain objects and `Headers`** (depends on Task 1)
  Files: `src/core/propagation.ts`
  Ship trivial wrappers so hosts don't implement `Carrier` by hand:
  - `export function objectCarrier(obj: Record<string, string>): Carrier` — `get` does a **case-insensitive** lookup (scan keys lowercased) so HTTP-style header maps work regardless of casing; `set` writes the lowercase key (`traceparent`/`tracestate`).
  - `export function headersCarrier(headers: Headers): Carrier` — wrap the standard `Headers` object (`headers.get` is already case-insensitive; `set` via `headers.set`). `Headers` is a shared web/Node 18+ global, so this stays platform-neutral with no import.
  - gRPC metadata is intentionally **not** wrapped here — the host passes its own `Carrier` at integration time (out of scope per the spec).

### Phase 2: Wiring

- [x] **Task 3: Export the propagation API through core and platform entries** (depends on Task 2)
  Files: `src/core/index.ts`, `src/node/index.ts`, `src/browser/index.ts`
  - In `core/index.ts` add a "Trace-context propagation" section: `export type { Carrier } from './propagation.js';` and `export { inject, extract, objectCarrier, headersCarrier } from './propagation.js';`.
  - In `node/index.ts` re-export `inject`, `extract`, `objectCarrier`, `headersCarrier` and `type Carrier` from `../core/index.js` (matching the existing span re-export block) so Node consumers reach them from the package root.
  - In `browser/index.ts` add the same re-exports (browser layer currently only re-exports `__sdk`; propagation is platform-neutral and must be reachable from the browser entry too).
  - No `package.json`/`tsup.config.ts` changes: propagation lives in the existing `core`/`node`/`browser` entries, no new subpath export.

### Phase 3: Tests

- [x] **Task 4: Propagation unit tests** (depends on Task 3)
  Files: `test/propagation.test.ts`, `test/propagation.node.test.ts`
  Split by manager dependency, per the documented convention in `test/span.node.test.ts` (any suite that registers the Node `ContextManager` and mutates process-global module state **must** use the `.node.test.ts` suffix for vitest per-file isolation):
  - **`test/propagation.test.ts`** (pure source-level, no context manager): all paths that pass `ctx` explicitly or operate on carriers only —
    - **Round-trip:** `inject` an explicit `ctx` into a plain object via `objectCarrier`, then `extract` returns a `Context` equal to the source (`traceId`, `spanId`, `traceFlags`).
    - **W3C format:** the written `traceparent` matches `/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/` exactly; flags render as 2 hex (e.g. `01`).
    - **Malformed → `undefined`, never throws:** wrong version (`01-...`), all-zero traceId, all-zero spanId, short/long hex, missing field, empty string, uppercase hex, and a totally absent header — each yields `undefined` without throwing.
    - **Case-insensitive lookup:** an object carrier with key `Traceparent` is still extracted.
    - **tracestate pass-through:** a carrier carrying `tracestate` round-trips it verbatim onto/off the `Context`; absence leaves `traceState` undefined and writes no tracestate key.
    - **`headersCarrier`:** inject→extract round-trips over a real `Headers` instance.
  - **`test/propagation.node.test.ts`** (registers the Node manager — `import '../src/node/index.js'` first, mirroring `span.node.test.ts`): the **active-context default** path — inside `withSpan(...)`, `inject(carrier)` with no `ctx` writes the active span's ids; outside any span `inject` is a no-op (carrier stays empty).
  - **dist-level reachability** (optional but matches the established `span.node.test.ts` / `exports.smoke.test.ts` convention; put in `propagation.node.test.ts` or the smoke suite): assert `dist/node.mjs` and `dist/browser.mjs` expose `inject`/`extract`/`objectCarrier`/`headersCarrier` as functions, so a broken export wiring from Task 3 (notably the newly-extended browser entry) is caught beyond source-level tests.
