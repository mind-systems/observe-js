# Code Review: Record model + level mapping + resource builder

**Reviewed:** `git diff HEAD` / `git status` — changed files:
`src/core/wire.ts`, `src/core/levels.ts`, `src/core/resource.ts`, `src/core/index.ts`, `tsconfig.json`, `test/levels.test.ts`, `test/resource.test.ts` (plus plan/json artifacts).
**Verification performed:** `npm run typecheck` (pass), `npm run build` (pass, JSON inlined & self-contained), `npx vitest run` (full suite + targeted runs), runtime probe of the `crypto` global.
**Environment:** Node **v18.15.0** (the installed/baseline runtime for this repo; roadmap baseline is "Node 18+").

---

## Critical

### C1 — Resource builder throws on the supported Node baseline; 6 unit tests fail (`npm test` is red)

`src/core/resource.ts:19` calls the bare global `crypto.randomUUID()`:

```ts
kv('service.instance.id', stringValue(crypto.randomUUID())),
```

Running the suite on this repo's installed Node (**18.15.0**) fails:

```
FAIL test/resource.test.ts (6 failed)
ReferenceError: crypto is not defined
 ❯ buildResource src/core/resource.ts:19:45
...
Test Files  1 failed | 2 passed (3)
Tests       6 failed | 18 passed (24)
```

Root cause: the Web Crypto **global** is not present inside vitest's VM/module execution context on Node 18. I probed it directly — inside a vitest test on this machine **both** the bare identifier and `globalThis.crypto` are `undefined`:

```
bare crypto:               undefined
globalThis.crypto:         undefined
globalThis.crypto?.randomUUID: undefined
```

(At a plain `node -e` top-level prompt `crypto.randomUUID()` *does* work on 18.15 — but that is the main realm, not the VM context the tests run in, and not a guarantee that holds across all Node 18.x patch levels, where the global was experimental/flagged.)

Why this is critical:
- **The milestone's "Done when" is not met.** The acceptance criterion is "unit tests cover every level and the resource shape." The resource tests do not pass on the project's own Node version, so `npm test` (which is `npm run build && vitest run`) fails.
- **"Never break the host" risk.** The contract requires that `init` never throw into the host. On any Node 18 consumer where the Web Crypto global isn't exposed in the relevant context (`tradeoxy_core`, `mind_api` both target the Node layer), `init → buildResource → crypto.randomUUID()` raises `ReferenceError` at startup — a hard crash on the happy path, not a silent degrade.
- The prior **plan-review's** claim that "the dev environment here is Node 24 (fine)" is **factually wrong** — the installed Node is 18.15.0 — so the advisory it filed (#2) was dismissed on a false premise. The risk is live, not theoretical.

The plan deliberately forbade a `node:crypto` import to keep `core/` isomorphic, so the fix is a real decision, not a one-liner. Options (reviewer does not mandate one):
1. Resolve the generator at runtime through a guarded accessor that prefers the global and falls back when absent — e.g. `(globalThis.crypto ?? webcrypto-from-node).randomUUID()`. This keeps the browser path on the global while making Node robust, but it reintroduces a Node-conditional and must be designed so the browser bundle never pulls Node code (the package already builds separate node/browser entries, so the platform-specific id source could live in the platform layers rather than in shared `core/`).
2. Provide the `crypto` global to the test environment (a vitest `setupFiles` polyfill / `globalThis.crypto = webcrypto`). This makes the tests green **without** proving the production path is safe on a bare Node 18 host — so on its own it papers over the runtime risk rather than resolving it.
3. Declare and enforce a higher floor: add `engines.node >= 20` (package.json currently has **no** `engines` field and there is **no** `.nvmrc`) and run/test on it. This contradicts the roadmap "Node 18+" baseline, so it is a baseline change that needs sign-off.

Whatever the choice: **the suite must pass on the declared supported baseline**, and `init` must not throw on it.

---

## Minor / Non-blocking

### M1 — `LEVELS` is mutable shared state aliasing the imported JSON
`src/core/levels.ts:10` assigns `LEVELS = levelsData.levels as Record<...>` — the exported table is the *same object reference* as the inlined JSON module, and `severityFor` returns the inner objects by reference. A caller could mutate `LEVELS.info.severityNumber` and corrupt the canonical table process-wide. For a frozen contract value, consider `Readonly<Record<Level, ...>>` plus `Object.freeze` (shallow+inner) or an `as const` snapshot. Low severity (internal surface today), but cheap to harden before the exporter/public API consume it.

### M2 — `it.each` title format string has more specifiers than values (cosmetic)
`test/levels.test.ts:16`: `'%s → severityNumber %i, severityText %s'` is applied to entries of shape `[key, {severityNumber, severityText}]` — only two positional values exist, so `%i`/the trailing `%s` don't bind to the severity values (they format the object/undefined). Test logic is correct and passes; only the generated test title is affected. Either drop to `'%s'` or spread the fields into the row to get accurate titles.

---

## Verified correct (no action)

- **Typecheck passes** under `verbatimModuleSyntax: true`. The Task 4 re-export split (`export type { … }` for the wire/`Level` types vs. `export { stringValue, kv, LEVELS, severityFor, buildResource }` for values) is done correctly in `src/core/index.ts`, and `resource.ts` uses the inline `import { type Resource, … }` form — both required by `verbatimModuleSyntax` and both correct.
- **`resolveJsonModule: true`** added to `tsconfig.json`; the cross-root JSON import (`../../contract/levels.json`) type-checks despite `contract` being in `exclude` (explicit imports still join the program), as the plan predicted.
- **Build is self-contained.** `npm run build` succeeds; the level data is inlined into `dist/core.cjs` (severity values present), and the only `contract/levels.json` occurrences in dist are a comment and the guard's error string — no runtime `require` of the submodule. The "dist stays self-contained without the submodule" assumption holds. dts generation succeeds for all entries.
- **Level mapping is faithful and guarded.** `test/levels.test.ts` passes: all six levels map to the exact `severityNumber`/`severityText` from `contract/levels.json`, and the key-set equality test passes. The module-load guard (sorted key comparison against the `Level` union) is correct and will fail fast on a contract level add/remove. The `LEVELS` cast is clean because `$comment`/`version` live on `levelsData`, not `levelsData.levels`.
- **Wire types** match the contract golden record field-for-field (camelCase, `severityNumber` integer, optional `eventName`/`traceId`/`spanId`, numeric `flags`, decimal-string `intValue`); `AnyValue` union and `stringValue`/`kv` helpers are correct.
- **Resource shape** (when crypto is available): exactly three attributes in the order `project`, `service.name`, `service.instance.id`; attribute discipline honored. The failing assertions are solely due to C1, not shape errors.

---

## Conclusion

One critical blocker (**C1**): the resource builder relies on a `crypto` global that is unavailable in the test (and potentially runtime) context on the project's Node 18 baseline, so the milestone's acceptance tests fail and `init` can throw into the host. Must be resolved — with the suite green on the declared baseline — before this milestone can be considered done. Two minor items (M1 hardening, M2 cosmetic) are optional.
