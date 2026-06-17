# Plan Review: Record model + level mapping + resource builder

**Plan:** `03-record-model-level-mapping-resource-builder.md`
**Files Reviewed:** plan + contract (`levels.json`, `golden-record.json`, `fixtures/service-start.json`, `otlp-logging-contract.md`), `tsconfig.json`, `package.json`, `tsup.config.ts`, `vitest.config.ts`, `src/core/index.ts`, `.ai-factory/ARCHITECTURE.md`, `.ai-factory/rules/base.md`, note 02.
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`ARCHITECTURE.md`)** — `WARN` (informational). Dependency rule: `core/` imports nothing outside itself and never imports Node/browser globals. The plan imports `../../contract/levels.json` and uses the global `crypto.randomUUID()`. Both are *sanctioned*: note 02 explicitly mandates importing `levels.json` rather than re-declaring it, the JSON is inlined at build time (data, not a cross-layer code dep), and `crypto` is an isomorphic Web standard global (the rule forbids only Node/browser-*specific* globals). Aligned with intent — no action required.
- **Rules (`rules/base.md`)** — `PASS`. File naming (`wire.ts`/`levels.ts`/`resource.ts`, kebab/lowercase), `UPPER_SNAKE_CASE` for `LEVELS`, "no console output / log returns synchronously" (this task has no log path) all hold. The resource builder being side-effect-free matches the error-handling rules.
- **Roadmap** — `PASS`. Plan links to ROADMAP → Foundation → "Record model + level mapping + resource builder" via note 02. Milestone linkage present.

## Verification against codebase & contract

Confirmed correct:
- Submodule **is** checked out at `contract/` and pinned to **v0.1.2** (`git submodule status` → `c96fc71 (v0.1.2)`); `.gitmodules` path matches.
- `levels.json` shape, the six level keys, and exact `severityNumber`/`severityText` values match the plan's recon precisely.
- Resource attribute order (`project`, `service.name`, `service.instance.id`) matches `golden-record.json` field-for-field.
- `LogRecord` type fields (incl. optional `eventName`) are vindicated by `fixtures/service-start.json`, which sets the top-level `eventName: "service.start"` — so including `eventName?: string` is correct, not speculative.
- OTLP/JSON encoding choices (`severityNumber` integer, hex `traceId`/`spanId`, decimal-string `intValue`/`timeUnixNano`, numeric `flags`) match the contract's "Wire" section.
- `tsconfig.json` currently lacks `resolveJsonModule` (plan correctly adds it) and `exclude` lists `contract` (plan correctly notes an explicit import still pulls the file into the program — this is standard TS behavior; `exclude` only filters the default include glob).
- `src/core/index.ts` is the `__sdk` stub; Task 4 correctly preserves it (smoke test `test/exports.smoke.test.ts` asserts `mod.__sdk === 'observe-js'`).
- tsup builds `core` via esbuild, whose default `.json` loader inlines imported JSON — so the "dist stays self-contained without the submodule" assumption holds.

## Critical Issues

None. The plan is implementable as written and faithful to the frozen contract.

## Advisory (non-blocking — fold into the relevant task)

1. **`verbatimModuleSyntax: true` forces `export type` on the Task 4 re-exports.** `tsconfig.json` enables `verbatimModuleSyntax`, so the barrel re-export in `core/index.ts` cannot re-export the pure wire types (`AnyValue`, `KeyValue`, `LogRecord`, `InstrumentationScope`, `ScopeLogs`, `Resource`, `ResourceLogs`, `ExportLogsServiceRequest`, `Level`) with a plain `export { ... }` — that fails the typecheck. Split them: `export type { ...types... }` for the types and `export { LEVELS, severityFor, buildResource, stringValue, kv }` for the values. Worth stating explicitly in Task 4 so `npm run typecheck` doesn't fail on first run.

2. **`crypto.randomUUID()` global is only unflagged by default since Node 19.0.0.** On Node 18 the Web Crypto global requires `--experimental-global-webcrypto`; without it `init → buildResource → crypto.randomUUID()` throws a `ReferenceError`, which would violate "never break the host" at startup. The dev environment here is Node 24 (fine), and `package.json` has no `engines` field. Recommend either adding `engines.node >= 19` (or `>= 20`) when this lands, or confirming the Node consumers (`tradeoxy_core`, `mind_api`) are not on Node 18. Pure data point for the implementer — does not change the code in this task.

3. **Module-load guard vs. tree-shaking (`sideEffects: false`).** Task 2's load-time key-match guard only runs when the `levels.ts` module is actually evaluated. With `sideEffects: false` + `treeshake: true`, a downstream consumer that never imports `LEVELS`/`severityFor` could shake the module away and skip the guard. This is acceptable (the exporter will import it, so it always evaluates in real use), but keep the guard co-located in the same module as `LEVELS` (as the plan already specifies) rather than in a standalone side-effect-only module, so it can't be shaken independently.

4. **Test import paths.** `vitest.config.ts` defines no `src` alias, so Tasks 5–6 will import via relative paths (`../src/core`, `../contract/levels.json`). vitest/esbuild resolves JSON natively regardless of `tsconfig.exclude`, so the "iterate the file as an independent oracle" approach works. Minor wording nit only — the plan says "from `src/core`" loosely.

## Positive Notes

- Sourcing the level table from `levels.json` rather than re-declaring it (plus the load-time invariant guard) is exactly right — it makes a contract bump that adds/removes a level fail fast, and keeps this SDK in lockstep with the cross-platform oracle.
- Attribute discipline is enforced concretely: "exactly three KeyValues, in this order," with tests asserting count, key set, and order against the golden record.
- The fallback (`levels.generated.ts` from a generate step) is correctly scoped out but documented, so a future build constraint has a known escape hatch.
- Scope (`{name:"observe",version:"0.1.0"}`) and full request assembly are correctly deferred to the exporter (note 03); this task defines only the `InstrumentationScope` type — clean boundary.
- UUIDv4 regex in the resource test and the two-calls-differ freshness assertion correctly capture the "fresh per start" contract requirement.

The plan is solid; the items above are forward-looking implementation cautions, not defects in the plan.

PLAN_REVIEW_PASS
