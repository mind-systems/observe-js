# Code Review: 09 — Node adapter, Winston transport

**Plan:** `.ai-factory/plans/09-node-adapter-winston-transport.md`
**Scope of changes reviewed:** `src/node/winston.ts` (new transport), `test/winston.node.test.ts` (new tests), `package.json` (deps), `src/core/sdk.ts` + `src/core/index.ts` (the `init`/`log` prerequisite, which landed in the same diff), `package-lock.json`, plan/roadmap docs.
**Risk Level:** 🟢 Low — builds, typechecks, tests, `attw`, and externalization all verified green.

## Verification performed (not just read — executed)

| Gate | Result |
|---|---|
| `npx vitest run test/winston.node.test.ts` | ✅ 13/13 pass |
| `npx tsc --noEmit` | ✅ clean (exit 0) |
| `npm run build` | ✅ exit 0 |
| `npx attw --pack .` | ✅ "No problems found" — both `observe-js` and `observe-js/winston` green across node10 / node16 CJS+ESM / bundler |
| `winston-transport` externalized | ✅ `import Transport from 'winston-transport'` preserved in `dist/winston.mjs`/`.cjs`; **not** inlined (`TransportStream` base class count = 0 in the bundle) |

The plan's central packaging concern from plan-review-1 (Issue #1: `winston-transport` must be externalized, not bundled) is **resolved and verified**: both `winston` and `winston-transport` are declared in `peerDependencies` and `devDependencies`, and the built artifact keeps the import external.

The level map matches the contract (`otlp-logging-contract.md` Winston row) exactly, and the `service.start` marker emitted by `sdk.ts` matches `contract/fixtures/service-start.json` field-for-field (severityNumber 9 / INFO / `eventName` + `event.name` attr / body `service.start`).

## Findings

### 1. (Minor / robustness) `callback` is coupled to `emit('logged')` in the same `setImmediate` — a throwing `logged` listener stalls the transport

`src/node/winston.ts:86-94`:

```js
} finally {
  setImmediate(() => {
    this.emit('logged', info);
    callback();   // <-- skipped if a 'logged' listener throws
  });
}
```

`winston-transport`'s `_write` (`node_modules/winston-transport/modern.js:82`) passes the **writable stream's own `_write` callback** into `this.log(info, callback)`. The stream cannot advance until that callback fires. Here `callback()` runs *after* `this.emit('logged', info)` inside the same `setImmediate`. If any user-attached `logged` listener throws, the exception propagates out of the `setImmediate` tick, `callback()` is never reached, and that transport's writable stream stalls (backpressure builds, `drain` never fires) — defeating the "never break the host" guarantee for that one edge.

This does **not** trigger under normal operation or in any current test (no app attaches a throwing `logged` listener), which is why all 13 tests pass. It is a one-line hardening, and it aligns with Winston's documented custom-transport pattern, which decouples the two:

```js
log(info, callback) {
  setImmediate(() => this.emit('logged', info));
  // ... forward ...
  callback();
}
```

**Recommended fix:** emit and call back independently so a misbehaving listener can never swallow the stream callback — e.g. schedule the emit on its own `setImmediate(() => this.emit('logged', info))` and call `callback()` directly (still inside the `finally`), or wrap the `emit` in its own try/catch. Non-blocking.

## Notes (informational, not defects in this task's scope)

- **Object-valued meta is stringified, not structured.** `logger.info('x', { obj: { a: 1 } })` forwards `{ obj: { a: 1 } }` as `attrs`; the core encoder `anyValueOf` (`src/core/sdk.ts:52-59`) coerces any non-primitive via `String(v)` → `"[object Object]"`. That is the `init`/`log` task's (notes/08) encoder behavior, not the Winston adapter's, and is consistent with the current `AnyValue` union (no `kvlistValue`/`arrayValue`). Flagging only so it is a conscious contract decision, not a surprise — no change requested here.
- **Symbol-level resolution is robust.** `info[Symbol.for('level')] ?? info['level']` correctly reads the immutable global-registry (triple-beam) level before any colorize format mutates `info.level`. The fallback chain ending in `''` → `winstonLevelToCanonical('')` → `info` is a safe default.
- **`attrs` stripping is correct.** `Object.keys(info)` excludes the Symbol-keyed `level`/`message`/`splat`; dropping the two reserved string keys leaves only user/format meta, and `hasAttrs` correctly yields `undefined` (not `{}`) when empty. Tests cover all three.
- **Never-throw + always-callback** is covered by a test that makes the SDK `log` spy throw and asserts the logger stays usable — passes. (The finding above is the one residual gap that test does not cover.)
- **`sdk.ts` quality** (prerequisite task, landed in this diff): idempotent `init` (first wins + `onError`), pre-init `log` drops silently with diagnostic, `log` wrapped in try/catch, active trace/span stamped only when a context exists. No bugs found.

## Verdict

The Winston transport is correct, contract-accurate, and fully verified (build/typecheck/tests/attw/externalization all green). The single finding is a **minor, non-blocking** robustness hardening: decouple `callback()` from the `logged` emission so a throwing listener cannot stall the transport's stream.
