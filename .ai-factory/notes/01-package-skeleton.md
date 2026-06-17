# 01 — Package skeleton + build pipeline

**Task:** ROADMAP → Foundation → "Package skeleton + build pipeline"
**Contract:** `observe-contract@v0.1.2` (consumed as a git submodule)
**Depth:** medium

## Goal

A buildable TypeScript package that emits dual ESM+CJS, resolves the right entry per runtime via conditional `exports`, and has the frozen contract available to tests.

## Design

- **Layout:** `src/core/` (neutral), `src/node/`, `src/browser/`, `test/`. Contract submodule at repo root path `contract/`.
- **`exports` map** (the crux — swift/dart copy this shape, so get it exact):
  - Every condition block must have **`types` as the first key** — TypeScript (under `moduleResolution: Bundler`/`NodeNext`) walks keys in order and matches `import`/`require` before reaching `types` if it comes later.
  - `"."` → outer order: `browser` → `node` → bare `import` → bare `require` (bundler hits `browser`, CJS NestJS hits `require`, ESM hits `import`):
    - `"browser"`: `{ "types": …/browser.d.ts, "import": …/browser.mjs, "require": …/browser.cjs }`
    - `"node"`: `{ "types": …/node.d.ts, "import": …/node.mjs, "require": …/node.cjs }`
    - then bare fallthroughs: `"import": …/node.mjs`, `"require": …/node.cjs`
  - `"./winston"` → node-only subpath for the Winston adapter (task 09).
  - Legacy top-level: `"main"`, `"module"`, `"types"` pointing at node CJS/ESM/d.ts.
- **Build:** `tsup` dual `format: ['esm', 'cjs']`, `dts: true`, `outExtension` mapping `.mjs`/`.cjs`. **Two separate config objects in an array** — `platform` is a single top-level tsup option and one object cannot vary it per entry; browser config sets `platform: 'browser'`, node/core/winston config sets `platform: 'node'`.
- **Clean strategy:** `build` script = `npm run clean && tsup`; **both** tsup configs set `clean: false`. Cleaning is owned by the build script so neither tsup config can race and wipe the other's freshly written `dist/` output.
- **Test:** `test` script = `npm run build && vitest run` — the smoke test asserts `dist/` artifacts exist and dynamically imports them; `dist/` must be present before vitest runs.
- **Types for test:** `@types/node` in devDependencies — `test/` is in the tsc `include` scope and the smoke test uses `node:fs`, `node:path`, and `process`. Excluding `@types/node` breaks `typecheck` on a clean checkout.
- **Types verification:** `@arethetypeswrong/cli` in devDependencies; `attw --pack .` must pass before the milestone is done. With `"type": "module"`, a bare `.d.ts` is interpreted as ESM — the `require` condition's `types` target may need to be `.d.cts` (and `import`'s `.d.mts`). Default to single `.d.ts`; switch to per-format extensions only if `attw` flags "masquerading as CJS".
- **Submodule:** `git submodule add <observe-contract url> contract`, then `git -C contract checkout v0.1.2` (detached HEAD). Stage the gitlink (`git add contract .gitmodules`). Confirm with `git -C contract describe --tags` → `v0.1.2`. Tests read `contract/golden-record.json`, `contract/fixtures/service-start.json`, `contract/levels.json`.
- **Zero runtime deps**; dev-deps: `typescript`, `tsup`, `vitest`, `@arethetypeswrong/cli`, `@types/node`.

## Edge cases / watch

- All three resolution conditions must be verified before done: CJS (`node -e "require('./dist/node.cjs')"`), ESM (`node --input-type=module -e "import('./dist/node.mjs').then(()=>process.exit(0))"`), and browser (`node --conditions=browser --input-type=module -e "import('observe-js').then(...)"` — uses package self-reference, works because `name` + `exports` are both set).
- Submodule pinned to a **tag**, not a branch — clones must `--recurse-submodules`.
- `core` entry is emitted by tsup but has no `exports` subpath — it's in `dist/` as a standalone build check, not a consumed entry.
- `DOM` in `lib` with a single `include: ["src","test"]` means DOM-global misuse inside `core/` is not caught by `tsc`. Acceptable here; a future task adds eslint import boundaries.

## Out of scope

Actual record/exporter code (later tasks). This is scaffolding + packaging only.

## Done when

`npm run build` emits 4 entries × `.mjs` + `.cjs` + `.d.ts`; all three resolution conditions pass; `attw --pack .` is clean; `contract/` is present at `v0.1.2` (detached HEAD).
