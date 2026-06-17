# Plan: Package skeleton + build pipeline

## Context
Stand up a buildable, zero-runtime-dep TypeScript package that emits dual ESM+CJS, selects the right entry per runtime via conditional `exports`, wires up `vitest`, lays out the `core/` + `node/` + `browser/` structure, and pins `observe-contract` as a git submodule at `v0.1.2`. Scaffolding and packaging only — no record/exporter logic (those are later tasks).

This milestone is the **cross-platform reference** for the SDK family (swift/dart copy its `exports` shape and acceptance gates), so the `exports` map and dual-format build must be correct, not just functional. Plan reviews 1–3 are folded in: C1 (types-first ordering), C2 (per-config platform), I1 (build-before-test), I2 (nodenext CJS types via `attw`), I3 (deterministic clean), and I4 (`@types/node` in devDeps).

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Repo scaffolding & contract submodule

- [x] **Task 1: Pin `observe-contract` as a git submodule at `v0.1.2`**
  Files: `.gitmodules`, `contract/` (submodule)
  Add the contract repo as a submodule at the repo-root path `contract/`:
  `git submodule add https://github.com/mind-systems/observe-contract contract`, then check out the frozen tag inside it: `git -C contract checkout v0.1.2`. Stage the gitlink (`git add contract .gitmodules`) so the submodule resolves as a **detached HEAD at `v0.1.2`**, not a branch. Confirm with `git -C contract describe --tags` → `v0.1.2`. The fixtures consumed by later tasks are present at exactly these paths in the tag (verified against the `v0.1.2` tree in reviews 1–2; tag → `6a329765…` on the public remote — no path adjustment needed): `contract/golden-record.json`, `contract/fixtures/service-start.json`, `contract/levels.json`. Note in the commit that clones must use `--recurse-submodules`.

- [x] **Task 2: Author `package.json` with conditional `exports`** (depends on Task 1)
  Files: `package.json`
  Define package metadata: name `observe-js`, `"type": "module"`, `"version": "0.0.0"`, `"private": false`, `"sideEffects": false`, `"files": ["dist"]` (`dist/` is gitignored locally but `files` governs publish inclusion — no conflict). **Zero `dependencies`** — dev-deps only: `typescript`, `tsup`, `vitest`, `@arethetypeswrong/cli` (for the types-resolution check in Task 7), and **`@types/node`** (`test/` is in the tsc `include` scope and the smoke test uses `node:fs`, `node:path`, and `process`; excluding `@types/node` breaks `typecheck` on a clean checkout). Scripts:
  - `clean` — `rm -rf dist`.
  - `build` — `npm run clean && tsup` (I3: clean is wired into the build so the dual-config tsup run never races on `clean`; both tsup configs set `clean: false` — see Task 5).
  - `test` — `npm run build && vitest run` (I1: the smoke test reads `dist/`, so the build must run first).
  - `typecheck` — `tsc --noEmit`.
  - `verify:exports` — a **self-contained** script bundling the full Task 7 acceptance gate (the `node -e` CJS-require check, the `node --input-type=module` ESM-import check, the `--conditions=browser` browser-branch check, and `attw --pack .`), so the gate is reproducible in one command rather than run ad hoc. It assumes `dist/` exists, so document it as run after `build` (or chain `npm run build &&` first).

  Conditional `exports` map (the crux of this milestone — this is the family reference, so get it exact). **C1: `types` MUST be the first key in every condition block** — TS resolution (under `moduleResolution: Bundler`/`NodeNext`) walks keys in order and would otherwise match `import`/`require` to a JS path before reaching `types`:
  - `"."` →
    - `"browser"`: `{ "types": "./dist/browser.d.ts", "import": "./dist/browser.mjs", "require": "./dist/browser.cjs" }`
    - `"node"`: `{ "types": "./dist/node.d.ts", "import": "./dist/node.mjs", "require": "./dist/node.cjs" }`
    - then the bare fallthroughs, in order: `"import": "./dist/node.mjs"`, `"require": "./dist/node.cjs"` (so a CJS NestJS consumer hits `require`, an ESM consumer `import`, a bundler `browser`).
  - `"./winston"` → node-only subpath: `{ "types": "./dist/winston.d.ts", "import": "./dist/winston.mjs", "require": "./dist/winston.cjs" }` (the adapter body lands in task 09; this milestone only wires the export and a stub).
  Also set top-level `"main": "./dist/node.cjs"`, `"module": "./dist/node.mjs"`, `"types": "./dist/node.d.ts"` for legacy resolvers. Outer condition order: `browser`/`node` precede the bare `import`/`require` fallthroughs; inner key order: `types` first in each block.
  I2 note on declaration extensions: if Task 7's `attw` check flags a `nodenext` CJS "ESM declaration masquerading as CJS" error, switch the `require` `types` targets to per-format declarations (`.d.cts` for `require`, `.d.mts` for `import`) and have tsup emit them (Task 5). Default to single `.d.ts` and split only if `attw` fails — keeps the stub lean unless the reference build actually needs it.

- [x] **Task 3: Author `tsconfig.json`** (depends on Task 2)
  Files: `tsconfig.json`
  Strict TypeScript config targeting the isomorphic core. `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "Bundler"` (tsup owns emit, so `Bundler` is fine here), `"strict": true`, `"declaration": true` (harmless alongside `noEmit` — tsup emits declarations; M2), `"noEmit": true`, `"skipLibCheck": true`, `"esModuleInterop": true`, `"verbatimModuleSyntax": true`, `"lib": ["ES2022", "DOM"]`. `"include": ["src", "test"]`, exclude `dist` and `contract`. `@types/node` is a dev-dep (added in Task 2) because `test/` is in the `include` scope and the smoke test uses `node:fs`, `node:path`, and `process`. This only adds ambient Node globals — it does not force DOM-style leakage into `core/`.
  Watch (future): a single `include` with `DOM` in `lib` means accidental DOM-global usage inside `core/` would not be caught by `tsc` (DOM is only needed by the browser layer). Acceptable for this packaging-only milestone — recorded under "Watch items" alongside the eslint-import-boundaries item; not fixed here.

- [x] **Task 4: Create layer entry stubs** (depends on Task 3)
  Files: `src/core/index.ts`, `src/node/index.ts`, `src/browser/index.ts`, `src/node/winston.ts`
  Minimal placeholder entries that make the build emit the four bundles and satisfy the dependency rules from `.ai-factory/ARCHITECTURE.md` (core imports nothing outside itself; node/browser import core only; node and browser never import each other). Each file exports a tiny named symbol so the bundle is non-empty and `.d.ts` is generated, e.g. `export const __sdk = 'observe-js' as const` in core, with `node`/`browser` re-exporting from `../core/index.js` to prove the import path resolves. `src/node/winston.ts` is a node-only stub re-exporting from core (real Winston transport is task 09). No business logic — scaffolding placeholders. Filenames are `index.ts` per directory and `winston.ts`, consistent with the kebab-case rule in `.ai-factory/rules/base.md`.

### Phase 2: Build & test tooling

- [x] **Task 5: Author `tsup.config.ts`** (depends on Task 4)
  Files: `tsup.config.ts`
  C2: `platform` is a single top-level tsup option — one config object applies one platform to all its entries. Export an **array of two config objects** (`export default defineConfig([ … ])`) so platform can differ:
  - **Browser config:** `entry: { browser: 'src/browser/index.ts' }`, `platform: 'browser'`.
  - **Node config:** `entry: { core: 'src/core/index.ts', node: 'src/node/index.ts', winston: 'src/node/winston.ts' }`, `platform: 'node'`.
  Both configs share: `format: ['esm', 'cjs']`, `dts: true`, `sourcemap: true`, `treeshake: true`, `external: []` (zero runtime deps), `clean: false` (I3: cleaning is owned by the `build` script's `npm run clean &&` prefix, so neither config wipes the other's output — no dependence on tsup's array-build ordering), and `outExtension({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' })` so emit is `dist/<entry>.mjs` / `dist/<entry>.cjs` / `dist/<entry>.d.ts`, exactly matching the paths declared in `package.json`. For these stubs `platform` has near-zero functional effect (no deps to shim), but the reference build's structure should be correct from the start. I2 follow-up: only if `attw` fails in Task 7, add per-format `.d.cts`/`.d.mts` emission here.

- [x] **Task 6: Author `vitest.config.ts` and a resolution smoke test** (depends on Task 5)
  Files: `vitest.config.ts`, `test/exports.smoke.test.ts`
  `vitest.config.ts`: Node environment, `include: ['test/**/*.test.ts']`. Add `test/exports.smoke.test.ts` that asserts the built artifacts exist and the entry stubs are importable — read `package.json` `exports`, assert each referenced `dist/*.mjs|cjs|d.ts` path exists on disk, and dynamically `import()` the built `dist/node.mjs` and `dist/browser.mjs` to confirm the placeholder symbol is exported. The `test` script runs `npm run build` first (Task 2, I1), so `dist/` is present; the test must not assume it can build itself. Add a comment that importing `dist/browser.mjs` under the Node vitest env covers **stub resolution only** — it will need an env change once the browser layer references **DOM/browser globals** (task 10; the browser context is an explicit lightweight context, no `zone.js`, per the ROADMAP baseline and `notes/10`). Packaging smoke check, not feature tests.

- [x] **Task 7: Build and verify all resolution conditions + types** (depends on Task 6)
  Files: (verification only — driven by the `verify:exports` script from Task 2)
  Run `npm run build` and confirm `dist/` contains `core|node|browser|winston` × `.mjs` + `.cjs` + `.d.ts`. Then run `npm run verify:exports`, which bundles:
  - **CJS (require):** `node -e "require('./dist/node.cjs')"` succeeds.
  - **ESM (import):** `node --input-type=module -e "import('./dist/node.mjs').then(()=>process.exit(0))"` succeeds.
  - **Bundler (browser):** `dist/browser.mjs` imports cleanly; resolve with Node `--conditions=browser` to prove the map selects the browser branch (Task 6's smoke test also covers stub resolution).
  - **Types (I2):** `npx attw --pack .` (`@arethetypeswrong/cli`) confirms both ESM and CJS+`nodenext` consumers resolve the declarations. If it reports "masquerading"/false-CJS errors, apply the per-format `.d.cts`/`.d.mts` fix noted in Tasks 2 and 5, rebuild, and re-run until clean.
  Confirm the submodule pin (M1): `git -C contract describe --tags` → `v0.1.2` (detached HEAD) and `git status` shows the gitlink staged at that commit. Milestone is done when build emits ESM+CJS with `.d.ts`, all resolution conditions pass, `attw` is clean (or the per-format types fix is applied), and `contract/` is pinned at `v0.1.2`.

## Watch items / future tasks
- **M3 (intentional):** the `clean` npm script and the `build` script's `npm run clean &&` prefix are the single cleaning mechanism; both tsup configs set `clean: false` (I3). No overlap, no race.
- **M5 + DOM-scope (future):** no automated enforcement of the ARCHITECTURE dependency rules (e.g. eslint import boundaries), and `DOM` sits in the core typecheck scope so DOM-global misuse inside `core/` is not caught by `tsc`. Both are acceptable for this packaging-only milestone (Testing: no) but worth a future task, since those boundaries are load-bearing for the family.

## Commit Plan
- **Commit 1** (after tasks 1-2): "Scaffold package manifest and pin contract submodule at v0.1.2"
- **Commit 2** (after tasks 3-4): "Add tsconfig and core/node/browser layer entry stubs"
- **Commit 3** (after tasks 5-7): "Wire tsup dual ESM+CJS build, vitest, and exports resolution check"
