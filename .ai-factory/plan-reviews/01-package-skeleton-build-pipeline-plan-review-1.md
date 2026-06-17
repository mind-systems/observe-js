# Plan Review: 01 — Package skeleton + build pipeline

**Plan:** `.ai-factory/plans/01-package-skeleton-build-pipeline.md`
**Risk Level:** 🟢 Low — no blocking issues. Well-scoped, internally consistent, and aligned with ROADMAP + ARCHITECTURE. A few technical risks worth pinning down during implementation.

## Verification performed
- Repo is greenfield (no `src/`, `package.json`, `tsconfig.json`, `tsup.config.ts`, `contract/`, `.gitmodules` yet) — plan correctly assumes a from-scratch scaffold.
- `observe-contract` remote tag `v0.1.2` **exists** → annotated tag object `6a329765…`, peeled commit `c96fc714…`.
- Contract file paths **confirmed present at `v0.1.2`**: `golden-record.json`, `fixtures/service-start.json`, `levels.json` — so `contract/golden-record.json`, `contract/fixtures/service-start.json`, `contract/levels.json` are correct. `git -C <clone> describe --tags` → `v0.1.2` confirmed.
- `.gitignore` already excludes `dist/` and `node_modules/` — plan's `files: ["dist"]` publish-inclusion reasoning is correct, no conflict.

## Context Gates
- **Architecture (ARCHITECTURE.md):** PASS. Task 4 stubs honor the dependency rules verbatim — `core/` imports nothing outside itself; `node/`, `browser/`, and `node/winston.ts` re-export from `core/` only; node and browser never reference each other.
- **Rules (rules/base.md):** PASS. All planned filenames (`index.ts`, `winston.ts`, `tsup.config.ts`, `vitest.config.ts`, `exports.smoke.test.ts`) satisfy the kebab-case/lowercase convention. Error-handling/logging rules are not in scope for this packaging-only milestone.
- **Roadmap (ROADMAP.md):** PASS. Maps directly to Foundation → "Package skeleton + build pipeline"; `Spec:` note `notes/01-package-skeleton.md` matches; done-when criteria are consistent across plan, note, and roadmap.

## Critical Issues
None.

## Important (non-blocking — surfaced by the plan's own gates, but pin down during implementation)

1. **tsup `.d.ts` extension under custom `outExtension` is version-dependent — the plan hardcodes `.d.ts` as the default.**
   The `exports.types` targets and the Task 7 existence check both assume tsup emits a single `dist/<entry>.d.ts`. In recent tsup versions, when `outExtension` returns `.mjs`/`.cjs` for a dual `['esm','cjs']` build, the declaration extension is **derived from the js extension**, so tsup may emit `dist/<entry>.d.mts` + `dist/<entry>.d.cts` instead of a single `.d.ts`. If that happens, every `"types": "./dist/<entry>.d.ts"` points at a non-existent file.
   - This is self-correcting: Task 6's smoke test asserts each `exports`-referenced path exists on disk, so it would fail loudly. But the plan frames the per-format `.d.cts`/`.d.mts` split as contingent **only on attw's masquerading error**, when in fact the correct types paths depend on what tsup actually emits regardless of attw.
   - Recommendation: make "inspect the actual emitted `dist/` declaration filenames, then align `exports.types` (and the Task 7 existence assertions) to them" an explicit first step of Task 7, and pin a known tsup major version so the emit behavior is reproducible for the swift/dart reference.

2. **attw FalseCJS is the likely path, not a rare contingency.**
   With `"type": "module"`, a single `node.d.ts` reached via the `require` condition is an ESM declaration serving a CJS consumer — `attw --pack .` will almost certainly report "ESM declaration masquerading as CJS". The plan's `.d.cts`/`.d.mts` fallback is correct, but treat it as the expected outcome rather than an edge case, so the implementer isn't surprised when the "default" single-`.d.ts` branch fails the gate on the first run.

## Minor / Nits

3. **Submodule commit-hash note is slightly inaccurate.** The plan says "tag → `6a329765…` on the public remote." `6a329765…` is the **annotated-tag object** hash; the **gitlink the superproject stages** will be the peeled commit `c96fc714…`. Operationally the instructions are correct (`checkout v0.1.2` + `describe --tags` → `v0.1.2`), but the parenthetical hash is misleading — either drop it or cite the commit `c96fc714…`.

4. **No explicit `npm install` step.** Task 7 runs `npm run build`, which needs `tsup` (and the smoke test needs `vitest`) installed. Obvious, but unstated between Task 2 (declare devDeps) and Task 7 (run them).

5. **Browser verification leans on Node self-reference.** `notes/01` resolves the browser branch via `node --conditions=browser -e "import('observe-js')…"`, which depends on package self-referencing working from a `-e` script's cwd package scope. This generally works, but keep the direct `dist/browser.mjs` path-import (which the plan also includes) as the primary browser-branch proof so the gate doesn't hinge on the self-reference quirk.

6. **devDependency versions unpinned.** For a build that is explicitly the cross-platform reference, pin at least major versions of `tsup`, `typescript`, `@arethetypeswrong/cli`, and `vitest` — tsup's dts/outExtension behavior (issue #1) is exactly the kind of thing that drifts across majors.

## Positive Notes
- The `exports` ordering rationale is correct: `types`-first per block (TS walks keys in order), and outer `browser` → `node` → bare `import`/`require` correctly routes bundlers to `browser`, CJS NestJS to `require`, ESM to `import`, while Node never selects `browser` without `--conditions=browser`.
- Clean/race strategy is sound: `clean` owned solely by the `build` script with `clean: false` on both tsup configs removes any dependence on tsup array ordering.
- Build-before-test ordering (`test` = `npm run build && vitest run`) correctly matches the smoke test reading `dist/`.
- The two-config-array approach for per-`platform` emit is the right call and is justified accurately (one config object cannot vary `platform` per entry).
- Prior review concerns (C1, C2, I1–I4, M1–M5) are explicitly folded in and traceable.
- Contract paths and tag were independently verified to exist — no path adjustment needed, as the plan claims.

PLAN_REVIEW_PASS
