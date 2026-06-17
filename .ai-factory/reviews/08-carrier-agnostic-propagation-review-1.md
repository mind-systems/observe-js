# Code Review: 08 — Carrier-agnostic propagation (`inject`/`extract`)

## Scope
Reviewed the code changes for the milestone against the plan and the v0.1.2 contract.

**Changed source/test files cross-checked in full:**
- `src/core/propagation.ts` (new)
- `src/core/context.ts` (added optional `traceState`)
- `src/core/index.ts` (exports)
- `src/node/index.ts` (re-exports)
- `src/browser/index.ts` (re-exports)
- `test/propagation.test.ts` (new)
- `test/propagation.node.test.ts` (new)

**Verification run:**
- `npm test` → build success, **101 tests passed (9 files)**, incl. `propagation.test.ts` (26) and `propagation.node.test.ts` (4).
- `npm run typecheck` (`tsc --noEmit`) → clean.

## Correctness assessment

The implementation matches the plan and contract precisely:

- **`formatTraceparent`** emits `00-<traceId>-<spanId>-<flags>`, flags masked to a byte (`& 0xff`) and zero-padded to 2 hex. ✓
- **`parseTraceparent`** validates strictly (exactly 4 fields, version `00`, 32/16 lowercase-hex non-all-zero ids, 2-hex flags) and converts flags via `parseInt(flagsHex, 16)` onto `Context.traceFlags`. Returns `undefined` on any failure; never throws. ✓ — addresses review-1 item 2.
- **`inject`** falls back to `getActiveContext()` when `ctx` omitted; no-ops when none. tracestate written only when present. ✓
- **`extract`** is pure (no ambient bind); copies tracestate verbatim when present. ✓
- **`objectCarrier`** get is case-insensitive; set writes lowercase. **`headersCarrier`** delegates to the case-insensitive `Headers`. ✓
- **Module boundary preserved:** `propagation.ts` imports only from `./context.js`; no Node/browser globals (`Headers` is a shared web/Node 18+ global). Honors the `core/` dependency rule. ✓
- **Wiring:** exported from `core/index.ts` and re-exported through both `node/` and `browser/` entries; dist-level reachability tests assert both `dist/node.mjs` and `dist/browser.mjs` expose all four functions. ✓ — addresses review-1 items 1, 3, 4 (test split into `.test.ts` / `.node.test.ts`, v0 boundary documented, dist smoke added).

**Milestone "Done when" satisfied:** inject→extract round-trips over a plain object (and a real `Headers`); malformed `traceparent` yields `undefined` without throwing; injected header matches the exact W3C pattern.

No bugs, security issues, or correctness problems found. The notes below are non-blocking observations only.

## Non-blocking observations (optional, no action required for this milestone)

1. **`objectCarrier` duplicate-key risk under mixed casing (edge case).**
   `get` scans keys case-insensitively but `set` always writes the lowercase key. If a caller passes an object that already contains a differently-cased key (e.g. `{ Traceparent: '...' }`) and then `inject`s into it, the object ends up with **both** `Traceparent` and `traceparent`. A subsequent `extract` returns whichever `Object.keys` order yields first (insertion order → the stale original), so inject would not visibly override the prior value. This does not affect any real path in this milestone (injection targets are fresh/controlled carriers, and the round-trip tests use `{}`), and `Headers` is unaffected since it normalizes keys. Could be hardened later by having `set` overwrite any existing case-variant key. Severity: low.

2. **`formatTraceparent` trusts `ctx` field shape.**
   It serializes `ctx.traceId`/`ctx.spanId` verbatim without re-validating length/charset. In practice `Context` originates from `span.ts` id generation (always well-formed lowercase hex), so a malformed emission would require a host hand-building an invalid `Context`. Contract does not require defensive validation on the inject side. Severity: negligible.

3. **No whitespace trimming on parse.**
   `parseTraceparent` does not trim surrounding whitespace from the header value. This mirrors typical OTel propagator behavior and is not required by the contract; carriers deliver values already split per header semantics. Severity: negligible.

REVIEW_PASS
