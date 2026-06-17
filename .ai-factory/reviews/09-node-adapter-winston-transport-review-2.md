# Code Review: 09 — Node adapter, Winston transport (review 2)

**Plan:** `.ai-factory/plans/09-node-adapter-winston-transport.md`
**Scope reviewed:** `src/node/winston.ts` (transport), `test/winston.node.test.ts` (tests), `package.json` + `package-lock.json` (deps), `src/core/sdk.ts` + `src/core/index.ts` (the `init`/`log` prerequisite that landed in the same diff), and the integration points it touches (`batcher.ts`, `exporter.ts`, `resource.ts`, `wire.ts`).
**Risk Level:** 🟢 Low — all gates verified green by execution, and the one finding from review-1 has been fixed.

## Review-1 finding is resolved

Review-1 flagged that `callback()` was coupled to `emit('logged', info)` inside a single `setImmediate`, so a throwing `logged` listener could skip the stream callback and stall backpressure. The current code (`src/node/winston.ts:86-93`) decouples them exactly as recommended:

```js
} finally {
  setImmediate(() => this.emit('logged', info));
  callback();
}
```

`callback()` now always runs synchronously in `finally` (exactly once, whether the forwarding body throws or not), and the `logged` emit is isolated on its own tick. The "never break the host" guarantee now holds even against a misbehaving listener. ✅

## Verification performed (executed, not just read)

| Gate | Result |
|---|---|
| `npx vitest run` (full suite) | ✅ 114/114 pass across 10 files |
| `npx vitest run test/winston.node.test.ts` | ✅ 13/13 pass |
| `npx tsc --noEmit` | ✅ clean |
| `npm run build` | ✅ exit 0 |
| `npx attw --pack .` | ✅ "No problems found" (both `observe-js` and `observe-js/winston`, all conditions) |
| `winston-transport` externalized | ✅ `from 'winston-transport'` preserved in `dist/winston.mjs`; base class not inlined |
| **CJS consumer runtime path** (NestJS/Winston is CJS) | ✅ `require('./dist/winston.cjs').ObserveTransport` is a constructor; `new` instance is `instanceof winston-transport`; `log()` forwards and fires its callback without throwing |

The CJS runtime check is the meaningful one for the stated primary consumer (`tradeoxy_core`/`mind_api` Winston is CJS): the default-interop on `import Transport from 'winston-transport'` survives tsup's CJS output, the instance genuinely extends the host's `winston-transport` (externalized, not a bundled copy), and a full `log(info, cb)` round-trip completes cleanly.

## Correctness spot-checks (no issues)

- **Level map** matches `contract/otlp-logging-contract.md` (Winston row) verbatim; unknown/empty level falls through to `info`. Robust to non-string `level` values (switch simply misses → default).
- **Level source** reads `info[Symbol.for('level')] ?? info['level'] ?? ''` — immutable triple-beam symbol first, so a `colorize()` format on `info.level` cannot corrupt the canonical mapping.
- **Attribute extraction** uses `Object.keys(info)` (string keys only → Symbol-keyed `level`/`message`/`splat` excluded) and drops the two reserved string keys; `hasAttrs` correctly yields `undefined` rather than `{}` when empty. Covered by tests.
- **Message coercion** handles falsy/non-string/object/`null`/`undefined` without throwing.
- **Graceful when uninitialized:** if a host attaches the transport but never calls `init`, `sdk.log` hits its `!_initialized` branch (drop + `onError`), the transport's `try/catch/finally` still calls `callback()`, and the stream never stalls — verified by reading `sdk.ts:120-124`.
- **`sdk.ts` integration** lines up with the modules it calls: `createExporter({ endpoint, resource, onError })` and `createBatcher({ exporter, ...batch })` match `ExporterConfig`/`BatcherConfig`; the `service.start` marker matches `contract/fixtures/service-start.json` field-for-field; `init` is idempotent (first wins + `onError`); `log` is fully `try/catch`-guarded and stamps trace/span only when a context is active.
- **Dependencies:** `winston` + `winston-transport` declared in both `peerDependencies` and `devDependencies`; `exports`/`typesVersions`/scripts untouched per the plan.

## Notes (informational, not defects)

- Object-/array-valued meta is stringified to `"[object Object]"` by the core `anyValueOf` encoder (`sdk.ts:52-59`), since the `AnyValue` union has no list/kvlist variant. This is the `init`/`log` (notes/08) encoder's contract, not the Winston adapter's, and is consistent with the frozen wire shape — flagged only for awareness, no change requested.

## Verdict

The Winston transport is correct, contract-accurate, additive, and never breaks the host. All build/typecheck/test/`attw`/externalization gates pass, the CJS consumer path is verified at runtime, and review-1's robustness finding has been applied. No outstanding issues.

REVIEW_PASS
