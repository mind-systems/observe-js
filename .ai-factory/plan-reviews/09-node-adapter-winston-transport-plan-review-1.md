# Plan Review: 09 — Node adapter, Winston transport

**Plan:** `.ai-factory/plans/09-node-adapter-winston-transport.md`
**Files Reviewed:** plan + targeted codebase (`src/node/winston.ts`, `src/core/index.ts`, `src/core/levels.ts`, `package.json`, `tsup.config.ts`, `tsconfig.json`, `vitest.config.ts`, `contract/otlp-logging-contract.md`, `contract/levels.json`, notes 08/09, ROADMAP, ARCHITECTURE)
**Risk Level:** 🟡 Medium

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** WARN→OK. The dependency rule `node/ → core/ only`, and `node/ never imports browser/` is explicitly honored by the plan (line 33: "import from `../core/index.js`; never from `../browser/`"). Importing the third-party `winston-transport` from the node layer is consistent with the boundary rules (it is a host-supplied library, not a sibling layer). No boundary violation.
- **Rules (`.ai-factory/rules/`):** Present directory; no explicit rule conflicts detected with the plan. OK.
- **Roadmap (`.ai-factory/ROADMAP.md`):** OK — the plan maps directly to "Adapters → Node adapter — Winston transport" and matches its "Done when" (conformance-passing records, contract level map, host transports still work, `attw` clean). Linkage is clear.

## Critical Issues

None that block the build outright. See Important Issues — one item materially contradicts a stated design goal of the plan.

## Important Issues

### 1. `winston-transport` will be **bundled**, not externalized — contradicting the plan's own "bind to host's copy, don't bundle" rationale (Task 1, line 24–26)

The code actually imports `winston-transport` (`import Transport from 'winston-transport'`), **not** `winston`. The plan's externalization reasoning is built around `winston`:

> "Because Winston is declared as a peer dependency, tsup externalizes it automatically — no `tsup.config.ts` change and no new `external` entry is needed."

That is true for `winston`, but `winston` is never imported by `src/node/winston.ts`. The base class comes from the separate package `winston-transport`. tsup (current config: `external: []`, no `noExternal`) externalizes only what is in `dependencies` / `peerDependencies`; it **bundles** everything else, including transitive deps and `devDependencies`. The plan's fallback — "if the typecheck cannot resolve `winston-transport` directly, add it to `devDependencies`" — fixes type resolution but does **not** externalize it: a `devDependency` gets bundled into `dist/winston.{mjs,cjs}`.

Consequences:
- The package no longer "binds to the host's copy" of the transport base class — it ships its own, which is exactly the outcome the plan argues against for Winston.
- Silent version drift between the bundled `winston-transport` and the host's Winston runtime.

Recommended fix: declare `winston-transport` explicitly so tsup externalizes it — add it to `peerDependencies` (alongside `winston`) **or** to `dependencies`, and/or add it to the node tsup config's `external` array. Functionally the bundled output will likely still work (it still extends Node's `stream.Writable`, and the level/message symbols are global-registry symbols via `Symbol.for(...)`, so they survive bundling), so this is quality/packaging correctness rather than a hard build break — but the plan's claim that no externalization work is needed is incorrect for the package actually imported.

## Minor Issues / Notes

### 2. Default-export ergonomic example is wrong for tsup CJS output (Task 2, line 36)

> "consider a default export too for ergonomic `new (require('observe-js/winston'))(...)`."

With tsup's CJS interop, a default export is emitted as `exports.default = ObserveTransport`, so `require('observe-js/winston')` returns a namespace object, not a constructor. The shown call would throw ("not a constructor"); the working form would be `new (require('observe-js/winston').default)(...)` or `new (require('observe-js/winston').ObserveTransport)(...)`. Keep the named export `ObserveTransport` as the primary, documented surface; if a default export is added, fix the example or drop the rationale. Low impact.

### 3. Prerequisite (`init` + `log`) is genuinely not yet present — confirm sequencing before implementing (Boundaries, line 12)

Verified: `log` / `init` are **not** exported from `src/core/index.ts` today (the export list ends at propagation; no `log`/`init`). The ROADMAP item "Public API: `init` + `log`" is still `[ ]`, and there is **no plan file** for it in `.ai-factory/plans/` (plans jump 07 → 08-propagation → 09-winston). The plan correctly flags this as a hard prerequisite and tells the implementer not to re-implement `log` — good. Two coordination cautions worth surfacing:
- **Plan/note numbering divergence:** the plan references "task 08 (`init` + `log`)" and "spec note 09", which match the *notes* numbering (`notes/08-public-api-init-log.md`, `notes/09-winston-transport.md`), but the *plan* files are numbered differently (`plans/08-*` is carrier-agnostic propagation). An implementer reading `plans/08-*.md` expecting `init`+`log` will find propagation. Consider a one-line pointer to `notes/08-public-api-init-log.md` to avoid confusion.
- Implementation of this task is blocked until `log` is actually exported from `../core/index.js`. The plan acknowledges this; just make it an explicit gate before starting Task 2.

### 4. Attribute extraction may pass through host-format-added fields (Task 2, line 41)

`Object.keys(info)` then dropping `level`/`message` correctly excludes Symbol-keyed internals and the two reserved string keys. Be aware that if the host configures a format that injects string-keyed fields (e.g. `winston.format.timestamp()` adds `timestamp`, `format.label()` adds `label`, `format.ms()` adds `ms`), those land in `attrs`. This is arguably acceptable (it is user-configured meta), but the plan/test should state the contract explicitly: only `level` and `message` are stripped; all other own-enumerable string keys are forwarded. A test asserting "exactly `{userId, region}`" (line 52) will pass only when no timestamp/label format is attached to that logger — keep the test logger format minimal, or the assertion will be brittle.

## Positive Notes

- **Level map is verified correct** against `contract/otlp-logging-contract.md` (Winston row) and `contract/levels.json`: `error/warn/info` direct, `http/verbose/debug → debug`, `silly → trace`, unknown → `info`. `Level` is correctly the core union (`'trace'|'debug'|'info'|'warn'|'error'|'fatal'`) and is exported from `../core/index.js` as the plan assumes.
- **Immutable level source** via `info[Symbol.for('level')] ?? info.level` is the right call — robust against host colorizing formats; `Symbol.for(...)` global-registry symbols match Winston's `triple-beam` symbols across module realms.
- **Never-throw / always-callback** discipline (`try/finally`, `setImmediate('logged')`) follows Winston's transport contract precisely and matches the contract's "never break the host" mandate.
- **Test conventions are accurate:** `.node.test.ts` suffix matches existing node-suite convention (`context.node.test.ts`, `span.node.test.ts`); vitest `include: test/**/*.test.ts` and `environment: node` will pick it up. Driving through a real Winston logger to exercise the real `info` shape is the right approach.
- **Packaging restraint is correct:** the `./winston` subpath export (types-first ordering) and the tsup `winston` entry already exist and the plan correctly forbids touching them. The `verify:exports` / `attw --pack .` gate is real and present in `package.json`.
- Boundaries section is unusually disciplined — explicit assumptions, no scope creep, additive-only integration model documented.

## Verdict

The plan is well-structured, contract-accurate, and architecturally sound. It is **not** a clean pass because Issue #1 makes a packaging claim that is incorrect for the package actually imported (`winston-transport` would be bundled, not externalized, undermining the plan's own peer-dependency rationale). Address Issue #1 (declare/externalize `winston-transport`), correct the default-export example (#2), and add the prerequisite gate + numbering pointer (#3) before implementation.
