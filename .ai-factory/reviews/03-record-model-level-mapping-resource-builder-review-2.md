# Code Review (2): Record model + level mapping + resource builder

**Reviewed:** `git diff HEAD` / `git status` — source changes:
`src/core/wire.ts`, `src/core/levels.ts`, `src/core/resource.ts`, `src/core/index.ts`, `tsconfig.json`, `test/levels.test.ts`, `test/resource.test.ts`.
**Verification performed:** `npm run typecheck` (pass), `npm run build` (pass, JSON inlined & self-contained), `npx vitest run` (24/24 pass), direct exercise of the UUID fallback path (200k samples).
**Environment this run:** Node **v24.13.1** (review-1 ran on Node 18.15.0).

This is a re-review. All findings from review-1 were addressed. Details below.

---

## Status of review-1 findings

### C1 (critical) — Resource builder threw on the Node 18 baseline → **Resolved & verified**
`src/core/resource.ts` no longer calls the bare `crypto` global. It now uses a guarded accessor:

```ts
function newInstanceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
```

- The `typeof globalThis.crypto?.randomUUID === 'function'` guard correctly falls through to the fallback in the exact context that failed before (vitest VM context / older Node 18.x where the Web Crypto global is absent), instead of throwing `ReferenceError`. This satisfies "never break the host" — `init → buildResource` can no longer throw on a missing global.
- The fallback emits a syntactically valid UUIDv4: hardcoded version nibble `4`, and `(r & 0x3) | 0x8` yields the `[89ab]` variant nibble — matching the test regex. I exercised it directly over 200,000 iterations: **0 format violations, 0 collisions**.
- Still isomorphic and zero-dependency: no `node:crypto` import; both `globalThis.crypto` and `Math.random` are Web-standard globals. Architecture rule (`core/` imports nothing non-isomorphic) is honored.
- The weaker randomness of the fallback is acceptable and correctly documented in-code: `service.instance.id` is a per-start uniqueness token, not a secret, and the primary (crypto) path is taken on every supported production runtime (Node 18+ main realm and browsers). The fallback only covers degenerate VM/test contexts.
- Full suite is now green: `Test Files 3 passed (3) / Tests 24 passed (24)`.

### M1 (minor) — `LEVELS` was mutable shared state → **Resolved**
`src/core/levels.ts` now freezes each inner severity record and the table itself, and types it `Readonly<Record<Level, Readonly<{…}>>>`. Callers can no longer corrupt the canonical table; under ESM strict mode a mutation attempt throws. `severityFor`'s declared mutable return type remains assignable from the frozen object (TS readonly is structurally assignable), and typecheck passes.

### M2 (minor, cosmetic) — `it.each` title had extra format specifiers → **Resolved**
`test/levels.test.ts` now maps each entry to a `[key, severityNumber, severityText]` tuple, so `'%s → severityNumber %i, severityText %s'` binds to real values. Titles render correctly; assertions unchanged and passing.

---

## Re-verification of the rest (unchanged, re-confirmed)

- **Typecheck** clean under `verbatimModuleSyntax`; the `export type { … }` / `export { … }` split in `index.ts` and the inline `import { type Resource, … }` in `resource.ts` are correct.
- **Build** self-contained: level data is inlined into `dist/core.cjs`; the only `contract/levels.json` strings in dist are a comment and the guard's error message — no runtime submodule dependency. dts generates for all entries.
- **Wire types** match the contract golden record field-for-field; `AnyValue` union and `stringValue`/`kv` helpers correct.
- **Level mapping** faithful to `contract/levels.json` for all six levels; the load-time key-set guard correctly fails fast on a contract add/remove; tests assert exact key-set parity and per-level severity values by iterating the file.
- **Resource shape**: exactly three attributes in contract order (`project`, `service.name`, `service.instance.id`); attribute discipline honored; freshness-per-call verified.

---

## Non-blocking observation (no action required)

- The UUID **fallback branch is not covered by the test suite in this environment** (Node 24 always takes the `crypto.randomUUID` path). This is environment-dependent rather than a defect — under the Node 18 VM context that motivated it, the same tests exercise the fallback, and I verified the branch's output independently here. If desired, a future test could force the fallback (e.g. stub `globalThis.crypto`) to pin coverage, but it is not necessary for this milestone.

---

## Conclusion

Both the critical and the two minor findings from review-1 are fixed and verified. Typecheck, build, and the full 24-test suite pass; the milestone's "Done when" (unit tests cover every level and the resource shape) is met, and the implementation is faithful to the frozen contract. No bugs, security issues, or correctness problems remain.

REVIEW_PASS
