# 01 — Package skeleton + build pipeline

**Task:** ROADMAP → Foundation → "Package skeleton + build pipeline"
**Contract:** `observe-contract@v0.1.2` (consumed as a git submodule)
**Depth:** medium

## Goal

A buildable TypeScript package that emits dual ESM+CJS, resolves the right entry per runtime via conditional `exports`, and has the frozen contract available to tests.

## Design

- **Layout:** `src/core/` (neutral), `src/node/`, `src/browser/`, `test/`. The contract submodule at repo root (e.g. `contract/` → `observe-contract`).
- **`exports` map** (the crux — swift/dart don't have this, so get it right as the reference):
  - `"."` → `{ browser: ./dist/browser.*, node: ./dist/node.*, import: ./dist/node.mjs, require: ./dist/node.cjs, types: … }`
  - `"./winston"` → node-only subpath for the Winston adapter (task 09).
- **Build:** `tsup` with `format: ['esm','cjs']`, `dts: true`, three entry points (core/node/browser). `sideEffects: false`.
- **Submodule:** `git submodule add <observe-contract url> contract` then check out tag `v0.1.2` (`git -C contract checkout v0.1.2`); record the pin. Tests read `contract/golden-record.json`, `contract/fixtures/service-start.json`, `contract/levels.json`.
- **Zero runtime deps**; dev-deps only (`typescript`, `tsup`, `vitest`).

## Edge cases / watch

- A CJS NestJS consumer must get the `require` condition; an ESM consumer the `import`; a bundler the `browser` condition — verify all three resolve before calling this done.
- Submodule is pinned to a **tag**, not a branch — CI/clone must `--recurse-submodules`.

## Out of scope

Actual record/exporter code (later tasks). This is scaffolding + packaging only.

## Done when

`npm run build` emits ESM+CJS with `.d.ts`; a smoke import resolves the correct entry under Node (both CJS and ESM) and under a bundler; `contract/` is present at `v0.1.2`.
