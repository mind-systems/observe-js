# Code Review: OTLP/HTTP JSON exporter (task 04)

## Scope
Reviewed all staged/working changes from `git diff HEAD` / `git status`:
- `src/core/encode.ts` (new) — OTLP/JSON envelope encoder
- `src/core/exporter.ts` (new) — `fetch`-based exporter with silent failure
- `src/core/index.ts` (modified) — barrel re-exports
- `test/exporter.test.ts` (new) — unit tests

Each file was read in full and against its surroundings (`wire.ts`, `resource.ts`, existing tests, `tsconfig.json`, `package.json`, `vitest.config.ts`, contract fixtures).

## Verification performed
- `npx vitest run test/exporter.test.ts` → **10/10 pass**.
- `npx tsc --noEmit` → **exit 0** (no type errors).
- Confirmed the `../src/core/index.js` import specifier resolves under vitest — identical style is already used by the passing `resource.test.ts` / `levels.test.ts`, so the `.js`→`.ts` resolution is established precedent, not a risk.

## Correctness assessment
- **Envelope shape** matches the golden oracle (`contract/golden-record.json`): `resourceLogs[] → { resource, scopeLogs[] → { scope, logRecords } }`, with `DEFAULT_SCOPE = { name: 'observe', version: '0.1.0' }` matching the fixtures.
- **Field encodings** (camelCase, `severityNumber` int, decimal-string nanos, lowercase-hex ids, `AnyValue` shapes) are correctly left to `wire.ts`/the record builder — this task only assembles the envelope, as the plan specifies. No re-definition or drift.
- **Silent failure** is correctly total: the `try/catch` wraps `JSON.stringify`, the `fetch` call, and the status check. A network rejection, a non-2xx response (fetch does not reject on HTTP errors — explicitly handled via the `throw` on `status !== 200 && !== 204`), and an abort/timeout all funnel into the same `catch`, which calls `onError?.()` and resolves `void`. `export` cannot reject. Verified by tests (a)/(b)/(c) and the no-`onError` case.
- **Success codes** 200/204 handled per the spec note; other 2xx (e.g. 202) intentionally treated as failure, consistent with the contract.
- **Timeout** via `AbortSignal.timeout(timeoutMs ?? 5000)`; `AbortSignal.timeout` and global `fetch` are both available on the Node 18+ / modern-browser baseline. No runtime-availability gap.
- **Purity** of `encodeLogs`: no clock, no id generation, no input mutation — returns a fresh envelope referencing the passed `resource`/`records`. Reference sharing is safe because `JSON.stringify` runs synchronously in the same tick inside `export`.
- **No security concerns**: local OTLP POST, `content-type: application/json`, body is `JSON.stringify` output (no injection vector), errors go only to `onError` (no host-logger loop, per the contract's never-break-the-host rule).
- **Barrel exports** correctly surface `encodeLogs`, `DEFAULT_SCOPE`, `createExporter`, and the `Exporter`/`ExporterConfig` types, following the existing `export` / `export type` split.

## Non-blocking notes (no change required)
- Test (c) labels the simulated timeout error `AbortError`, whereas a real `AbortSignal.timeout()` abort rejects with a `DOMException` named `TimeoutError`. This does not affect correctness: the exporter's `catch` is name-agnostic and swallows any rejection, so the test still validates the intended behavior (timeout → resolved + `onError`). Purely cosmetic; the spec note itself referenced "AbortError," so the implementer followed it faithfully.

No correctness, security, or runtime defects found.

REVIEW_PASS
