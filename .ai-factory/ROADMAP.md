# observe-js — Roadmap

> The isomorphic (Node + browser) JS/TS OTLP/HTTP logging SDK. **This is the reference SDK** of the family: `observe-swift` and `observe-dart` copy its public API ergonomics and its conformance harness, so getting the API surface and the test oracle right here matters more than raw feature breadth.

Decomposition of the root milestone **`observe-js` SDK** (see `../.ai-factory/ROADMAP.md`). Conforms to the frozen contract **`observe-contract@v0.1.2`**. Two-tier: each task below carries a `Spec:` pointer to a self-contained note under `.ai-factory/notes/`.

## Baseline decisions (fixed before tasks)

- **Runtime:** Node 18+ and modern browsers. Global `fetch` on both — isomorphic, **zero runtime dependencies** in the core.
- **Build:** TypeScript, **dual ESM + CJS** (NestJS/Winston consumers are CJS), via `tsup`. Conditional `package.json` `exports` with `node` / `browser` / `import` / `require` conditions. Tests: `vitest`.
- **Layout:** platform-neutral `core/` (record model, exporter, batching, span/correlation, propagation) + thin `node/` and `browser/` layers selected by `exports`.
- **Contract consumption:** `observe-contract` as a **git submodule pinned to tag `v0.1.2`**. The conformance test reads the golden fixtures and `levels.json` from the submodule.
- **Ambient context:** Node `AsyncLocalStorage`; browser a lightweight explicit context (no `zone.js`) — holds within the sync stack + immediate microtask, per the contract's browser caveat.
- **Propagation:** carrier-agnostic `inject`/`extract` over an abstract string get/set map. **No `@grpc/grpc-js` dependency** — gRPC metadata is just a carrier the host passes in at integration time.
- **Spans in v0 = correlation core only:** generate/propagate `trace_id`/`span_id`, active span in ambient context, logs inherit it, `startSpan`/`withSpan` API. **No** span export, durations, status, or hierarchy beyond what propagation needs (those arrive with Tempo).

## Tasks

### Foundation

- [x] **Package skeleton + build pipeline** — TS project; `tsup` dual ESM+CJS via **array of two config objects** (one per `platform` — single object cannot vary `platform` per entry); conditional `exports` (`node`/`browser`/`import`/`require`) with **`types` as the first key in every condition block** (TS walks keys in order under `Bundler`/`NodeNext`); `vitest` (`test` script = `npm run build && vitest run` — smoke test reads `dist/`); `core/`+`node/`+`browser/` layout; zero runtime deps; **`@types/node` in devDependencies** (`test/` is in the tsc include scope and uses `node:fs`/`node:path`/`process`); `build` script = `npm run clean && tsup` with `clean: false` on **both** tsup configs (prevents race between the two parallel tsup configs); `attw --pack .` must pass; `observe-contract` as git submodule pinned to `v0.1.2`. *Done when:* build emits ESM+CJS with correct `exports`, all three resolution conditions (CJS `require`, ESM `import`, bundler `--conditions=browser`) verified, `attw` clean, submodule at `v0.1.2`. **Spec:** `.ai-factory/notes/01-package-skeleton.md` [33m 21s]
- [x] **Record model + level mapping + resource builder** — typed `LogRecord`/`ExportLogsServiceRequest` matching the OTLP/JSON shape; import the canonical level table from the submodule's `levels.json`; resource builder setting `project`, `service.name`, fresh `service.instance.id` (UUIDv4). *Done when:* unit tests cover every level and the resource shape. **Spec:** `.ai-factory/notes/02-record-model-and-levels.md` [16m 18s]

### Core

- [x] **OTLP/HTTP JSON exporter** — assemble request JSON by hand per contract (camelCase, `severityNumber` int, `traceId`/`spanId` lowercase hex, `timeUnixNano` decimal string, `AnyValue` shapes); `POST` via global `fetch`; accept 200/204; failures **degrade silently, never throw**. *Done when:* posts a valid payload Loki accepts; never throws on network error. **Spec:** `.ai-factory/notes/03-otlp-http-exporter.md` [8m 47s]
- [x] **Bounded batching buffer** — wrap the exporter: queue records, flush on size + interval, **bounded buffer with drop-oldest** under pressure, single in-flight export, explicit `flush()`/`shutdown()`. *Done when:* buffer caps and drops oldest; timed + size flush verified; shutdown drains. **Spec:** `.ai-factory/notes/04-bounded-batching.md` [15m 52s]
- [x] **Ambient context — Node (`AsyncLocalStorage`)** — the unified internal context interface (`getActiveContext` / `runWithContext`) plus the Node implementation. *Done when:* context propagates across `await` in Node; logs read the active context. **Spec:** `.ai-factory/notes/05-ambient-context-node.md` [13m 4s]
- [x] **Correlation core — trace/span ids + `startSpan`/`withSpan`** — generate `trace_id` (16-byte) / `span_id` (8-byte) hex; active span in ambient context; logs stamp `traceId`/`spanId`; `withSpan` restores the parent on exit. No export/timing/status. *Done when:* logs inside `withSpan` carry the span ids; nested spans restore correctly. **Spec:** `.ai-factory/notes/06-correlation-core.md` [13m 50s]
- [x] **Carrier-agnostic propagation** — `inject(carrier)` / `extract(carrier)` over an abstract `{ get, set }` string map; W3C `traceparent`; identical for HTTP headers and gRPC metadata; no transport dependency. *Done when:* inject→extract round-trips over a plain object; malformed `traceparent` ignored safely. **Spec:** `.ai-factory/notes/07-carrier-agnostic-propagation.md` [11m 42s]
- [x] **Public API: `init` + `log`** *(reference ergonomics — vet carefully)* — `init(project, service, …)` sets resource attributes and emits the `service.start` marker (`eventName` **and** `event.name` attr, per contract); `log(level, msg, attrs?)` builds a record, stamps the active trace/span, adds the canonical `level` attribute, enqueues. *Done when:* the public surface matches the contract vocabulary exactly; `service.start` matches the fixture. **Spec:** `.ai-factory/notes/08-public-api-init-log.md`

### Adapters

- [x] **Node adapter — Winston transport** — subpath export (e.g. `observe-js/winston`) plugging into a Winston `transports` array; maps Winston levels → canonical tokens per the contract host map; additive, no call-site changes. *Done when:* a Winston logger with the transport ships records that pass conformance. **Spec:** `.ai-factory/notes/09-winston-transport.md` [24m 8s]
- [x] **Browser layer (incl. browser ambient context)** — framework-agnostic entry (no React/Angular code); the lightweight explicit ambient context (no `zone.js`); trace origination on user action; `traceparent` injection on outgoing `fetch`. *Done when:* a plain browser app can `init`, `log`, open a span on a click, and have the next `fetch` carry `traceparent`. **Spec:** `.ai-factory/notes/10-browser-layer.md` [27m 33s]

### Verification

- [x] **Contract conformance test (offline — required)** — serialize records and assert **field-for-field** equality against the submodule's `golden-record.json` and `fixtures/service-start.json`; assert the level table matches `levels.json`. This harness is itself a reference artifact for swift/dart. *Done when:* `vitest` conformance suite green against `observe-contract@v0.1.2`. **Spec:** `.ai-factory/notes/11-conformance-test.md` [27m 55s]
- [ ] **Live smoke vs local Loki (required for this SDK)** — `init` + `log` → POST to `http://localhost:3100/otlp/v1/logs` → query back via LogQL; assert labels `project`/`service_name`/`level` and `trace_id` queryable as structured metadata (mirrors `backend-verify`). *Done when:* a record emitted by observe-js is retrievable from running Loki with the correct label set. **Spec:** `.ai-factory/notes/12-live-smoke-loki.md`

## Definition of done (milestone)

- One isomorphic package builds to dual ESM+CJS with correct conditional `exports`; zero runtime deps in core.
- Public API (`init`, `log`, `startSpan`, `withSpan`, `inject`, `extract`) matches `observe-contract@v0.1.2` vocabulary and semantics.
- Offline conformance suite green against the pinned contract fixtures; **live smoke against local Loki green** (this SDK is the reference, so the live path is part of DoD).
- Node (AsyncLocalStorage + Winston adapter) and browser (explicit context + `fetch` propagation) layers both work; no `zone.js`, no gRPC dependency in core.
- The package is consumable by git URL pinned to a tag; first SDK tag cut when DoD met.
