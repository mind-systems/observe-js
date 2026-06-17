# Plan: Node adapter — Winston transport

## Context
Replace the `src/node/winston.ts` stub with a real Winston transport that forwards each Winston log record through the SDK's `log(...)`, mapping Winston's levels to the contract's canonical tokens — so a NestJS/Winston host integrates by adding one entry to its `transports` array, with no call-site changes.

## Settings
- Testing: yes (the level map per the contract table, Symbol-key stripping, and never-throw are this task's correctness guarantees and are unit-testable without a live backend)
- Logging: minimal
- Docs: no

## Boundaries & assumptions (deliberate, not gaps)
- **Hard prerequisite gate — `log` must be exported before Task 2.** The transport calls the SDK's `log(level, msg, attrs?)`. This public API is delivered by the **notes-numbered** task `notes/08-public-api-init-log.md` ("Public API: `init` + `log`"), which is still `[ ]` on the ROADMAP and has **no plan file yet**. As of today `log`/`init` are **not** exported from `src/core/index.ts` (the export list ends at propagation). **Task 2 is blocked until `log` is importable from `../core/index.js`** — confirm that export exists before starting, and do **not** re-implement `log` here.
- **Plan vs. note numbering — read the note, not the plan.** This task's numbering follows the `.ai-factory/notes/` sequence (`notes/09-winston-transport.md`). The `.ai-factory/plans/` files are numbered differently: `plans/08-carrier-agnostic-propagation.md` is **propagation**, not `init`+`log`. For the prerequisite, read **`notes/08-public-api-init-log.md`** (the spec), not `plans/08-*.md`.
- **Packaging is already scaffolded (task 01).** The `./winston` subpath export in `package.json` and the `winston` entry in `tsup.config.ts` already exist and must **not** change. The only `package.json` change in this task is the dependency section (adding the Winston peer/dev deps below). The `exports`, `typesVersions`, and tsup entry/`outExtension` blocks stay byte-for-byte as they are.
- **The transport does not call `init`.** The host is responsible for `init(...)` at bootstrap. The transport only forwards records. Document this prerequisite in the file header.
- **Additive only.** Adding this transport must not disturb the host's existing console/file transports — it is one more entry in the `transports` array.
- **Level source.** Read the immutable level from `info[Symbol.for('level')]` (not `info.level`, which may be colorized by a host format), falling back to `info.level` if the symbol is absent.
- **Attribute contract — strip exactly two keys.** From the Winston `info` object, `attrs` is built from own-enumerable **string** keys (`Object.keys(info)`, which already excludes the `Symbol`-keyed internals), then dropping exactly `level` and `message`. Everything else is forwarded as-is — including any string-keyed fields a host *format* adds (e.g. `winston.format.timestamp()` → `timestamp`, `format.label()` → `label`, `format.ms()` → `ms`). This is intentional: format-added fields are user-configured meta. Tests must therefore use a **minimal logger format** (no timestamp/label/ms) so the "exactly `{userId, region}`" assertion is not made brittle by injected fields.

## Tasks

### Phase 1: Dependencies

- [x] **Task 1: Add Winston (and `winston-transport`) as peer + dev dependencies, externalized from the bundle**
  Files: `package.json`
  The transport's runtime base class is imported from `winston-transport` (`import Transport from 'winston-transport'`), **not** from `winston`. tsup with the current config (`external: []`, no `noExternal`) externalizes only packages listed in `dependencies`/`peerDependencies` and **bundles everything else** — so unless `winston-transport` is declared, it would be inlined into `dist/winston.{mjs,cjs}`, shipping our own copy of the transport base class and drifting from the host's Winston runtime. To bind to the host's copy:
  - Add a `peerDependencies` block with **both** `"winston"` (the host's logger) and `"winston-transport"` (the base class actually imported). Pin permissive ranges covering current Winston 3.x — e.g. `"winston": "^3.13.0"`, `"winston-transport": "^4.7.0"` (use the `winston-transport` version that the pinned `winston` resolves to in the lockfile). Declaring `winston-transport` as a peer is what makes tsup externalize it — no `dist`-bundled base class.
  - Add **both** `"winston"` and `"winston-transport"` to `devDependencies` (peer deps are not auto-installed in this project's setup) so the build, typecheck, and tests resolve them locally.
  - Do **not** touch `exports`, `typesVersions`, `main`/`module`/`types`, or `scripts`. Because both packages are declared as peers, tsup externalizes them automatically — **no `tsup.config.ts` change and no new `external` entry needed**. (If a future audit shows `winston-transport` is still bundled, the explicit fallback is to add it to the node tsup config's `external` array — but the peer-dependency declaration should make that unnecessary.)
  - Run `npm install` so the lockfile/`node_modules` pick up both packages for the build and tests.

### Phase 2: Implement the transport

- [x] **Task 2: Implement the Winston→canonical level map and the transport class** (depends on Task 1; gated on `log` being exported from `../core/index.js` — see Boundaries)
  Files: `src/node/winston.ts`
  Replace the stub (which currently only re-exports `__sdk`) with the real implementation. Keep the file's "node layer imports core only" discipline (import from `../core/index.js`; never from `../browser/`). Importing the third-party `winston-transport` is consistent with the layer rules — it is a host-supplied library, not a sibling layer.
  - **Level map** — a module-local function `winstonLevelToCanonical(level: string): Level` implementing the contract's Recommended host→canonical mapping (`contract/otlp-logging-contract.md`, Winston row), reused verbatim from spec note 09:
    `error → error`, `warn → warn`, `info → info`, `http → debug`, `verbose → debug`, `debug → debug`, `silly → trace`. Any unrecognized level maps to the nearest canonical token by meaning, defaulting to `info`. Type the return as the core `Level` union (`import type { Level } from '../core/index.js'`).
  - **Transport class** — `export class ObserveTransport extends Transport` where `Transport` is the default export of `winston-transport` (`import Transport from 'winston-transport'`). Accept the standard `Transport.TransportStreamOptions` in the constructor and pass them to `super(opts)` so `level`/`format`/`silent` work as Winston expects. The **primary, documented surface is the named export `ObserveTransport`** — host usage is `import { ObserveTransport } from 'observe-js/winston'` (ESM) / `const { ObserveTransport } = require('observe-js/winston')` (CJS). Do **not** advertise a `new (require('observe-js/winston'))(...)` form: with tsup's CJS interop a default export becomes `exports.default`, so a bare `require(...)` returns the namespace object, not a constructor. If a default export is added for convenience, the only correct call forms are `new (require('observe-js/winston').ObserveTransport)(...)` or `new (require('observe-js/winston').default)(...)` — document accordingly, or simply omit the default export.
  - **`log(info, callback)`** — implement Winston's transport contract:
    - Emit the `logged` event asynchronously per Winston convention: `setImmediate(() => this.emit('logged', info))`.
    - Resolve the raw level from `info[Symbol.for('level')] ?? info.level`, translate it via `winstonLevelToCanonical`.
    - Take the message from `info.message` (coerce to string; if it is a non-string object, `String(...)` it — never throw on a weird message).
    - Build `attrs` from `info`'s own **string-keyed** enumerable properties via `Object.keys(info)` (this already excludes the `Symbol`-keyed internals `Symbol.for('level')` / `Symbol.for('message')` / `Symbol.for('splat')`), then drop exactly the reserved string keys `level` and `message` so only user/format-supplied meta remains (see Attribute contract in Boundaries). Omit `attrs` (pass `undefined`) when the resulting object is empty.
    - Call the SDK `log(canonicalLevel, msg, attrs)` (imported from `../core/index.js`).
    - Wrap the forwarding body in `try/finally` so the Winston `callback()` is **always** called exactly once and no exception escapes into the host logger. The SDK `log` is already non-throwing; the guard covers level/attr-extraction edge cases.
  - Keep the existing `export { __sdk } from '../core/index.js';` only if still useful; otherwise drop it — the public surface of this entry is the transport. Add a header comment documenting the `init`-at-bootstrap prerequisite and the additive integration model.

### Phase 3: Tests & verification

- [x] **Task 3: Unit tests for level mapping, attribute extraction, and never-throw** (depends on Task 2)
  Files: `test/winston.node.test.ts`
  Use the `.node.test.ts` suffix per the repo convention for suites touching the Node entry / process-global state (matches `context.node.test.ts`, `span.node.test.ts`; vitest `include: test/**/*.test.ts`, `environment: node` picks it up). Drive the transport through a **real Winston logger** so the test exercises the actual `info` object shape Winston produces (including the `Symbol`-keyed fields), and stub/spy the SDK `log` to capture forwarded calls. Configure the test logger with a **minimal format** (no `timestamp`/`label`/`ms`) so attribute assertions stay exact (see Attribute contract).
  - **Level map:** for each Winston level (`error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`) assert the forwarded canonical token matches the contract table; assert an unknown level (e.g. `"weird"`) maps to `info`.
  - **Message + attrs:** logging `logger.info('hello', { userId: 7, region: 'eu' })` forwards `msg === 'hello'` and `attrs` equal to exactly `{ userId: 7, region: 'eu' }` — no `level`, no `message`, and no `Symbol`-keyed fields leak into `attrs`. A message with no meta forwards `attrs` as `undefined`.
  - **Additive:** adding `ObserveTransport` alongside another transport (e.g. a no-op/stream transport) still lets the other transport receive the record — the SDK transport does not consume or block it.
  - **Never throws / always calls back:** the host logger continues working even when the SDK `log` spy is made to throw — the transport's `try/finally` swallows it and Winston still emits `logged`/invokes the callback (no unhandled rejection, logger stays usable for the next call).
  - **Build & types gate:** after the suite, run `npm run build` then `npx attw --pack .` (or `npm run verify:exports`) to confirm the `./winston` subpath still resolves cleanly to `dist/winston.{mjs,cjs,d.ts}` with no FalseCJS/types issues, and that `winston-transport` is externalized (not inlined) in `dist/winston.mjs`/`dist/winston.cjs`.
