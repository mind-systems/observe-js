# Code Review: 01 — Package skeleton + build pipeline

**Plan:** `.ai-factory/plans/01-package-skeleton-build-pipeline.md`
**Scope reviewed:** `git diff HEAD` + `git status` — all new/changed files read in full. Gates were executed, not just read.
**Risk Level:** 🟢 Low — the milestone's functional Definition of Done is fully met; only two non-blocking quality nits remain.

## What was verified (executed, not assumed)

- **Build emits the full dual matrix.** `dist/` contains `core|node|browser|winston` × `.mjs` + `.cjs` + `.d.ts` + `.d.cts` (+ maps). The implementer applied the I2 per-format declaration split (`.d.cts` for `require`), which is correct and consistent with the `exports` map.
- **`exports` resolution is correct — `attw --pack .` is all green** for both `observe-js` and `observe-js/winston` across `node10`, `node16 (CJS)`, `node16 (ESM)`, and `bundler`. This is the milestone's crux and it passes cleanly. The map uses the modern nested form (`import`/`require` → `{ types, default }`, `types` first), which is more robust than the flat form the plan described and resolves the C1 concern definitively.
- **`tsc --noEmit` passes** (exit 0) on the current tree, including `test/` — confirming the I4 `@types/node` dev-dep is actually needed and present (`node:fs`, `node:path`, `process` in the smoke test).
- **`vitest run` passes** — 11/11 tests green. The smoke test correctly imports the built `dist/node.mjs` / `dist/browser.mjs` and asserts `__sdk`.
- **`npm run verify:exports` passes end-to-end** (exit 0): CJS `require`, ESM `import`, and `attw`.
- **Submodule pin is correct.** `git submodule status` → `c96fc714… contract (v0.1.2)`. The apparent mismatch with review-2's `6a32976…` is expected: `v0.1.2` is an **annotated tag** (`cat-file -t` → `tag`) whose object is `6a32976…` and which peels (`v0.1.2^{commit}`) to `c96fc714…` — the commit the gitlink stores. So the gitlink is right, and `git -C contract describe --tags` → `v0.1.2`. The three fixtures (`golden-record.json`, `fixtures/`, `levels.json`) are present in the checkout.
- **Dependency rules honored.** `core/` imports nothing; `node/`, `browser/`, and `node/winston.ts` re-export from `../core/index.js` only; node and browser never cross-import. `dist/` is gitignored and not tracked; `files: ["dist"]` governs publish — no conflict.

## Minor / non-blocking

### N1. `--conditions=browser` in `verify:exports` is a no-op as written
The script runs `node --input-type=module --conditions=browser -e "import('./dist/browser.mjs')…"`. Because it imports a **direct relative file path**, Node never consults the package `exports` map, so `--conditions=browser` has no effect — the check only proves `dist/browser.mjs` parses/imports, not that the `browser` condition *resolves through the map*. The condition-resolution coverage is actually provided by `attw`'s `bundler` row (which is green), so there's no correctness gap — but the flag is misleading. To genuinely exercise condition selection, resolve the package by name (self-reference), e.g. `node --conditions=browser --input-type=module -e "import('observe-js').then(m=>process.exit(m.__sdk?0:1))"` (works because the package has a `name` + `exports`). Optional hardening of the acceptance gate.

### N2. Smoke test `expectedPaths` omits the `.d.cts` declarations the map references
`test/exports.smoke.test.ts` comments "Every dist path referenced in the package.json exports map," but the list contains only `.d.ts` (not `browser.d.cts` / `node.d.cts` / `winston.d.cts`, which the `require` conditions point at). Not a bug — `attw` validates those — but the test's stated invariant is broader than what it checks. Either add the three `.d.cts` paths or narrow the comment.

### N3. `AGENTS.md` includes a directory tree (style only)
The new `AGENTS.md` section embeds a `src/`+`test/`+`contract/` tree. The user's global doc style disallows directory trees outside an ARCHITECTURE module template. Cosmetic, outside the code-correctness scope of this milestone — flagging only for consistency; safe to leave or trim.

## Conclusion

No correctness bugs, security issues, type mismatches, or runtime-breaking problems. Every gate the milestone defines (`build`, `attw`, `typecheck`, `vitest`, submodule pin at `v0.1.2`) passes when executed. N1–N3 are optional, non-blocking polish and do not affect the Definition of Done.

REVIEW_PASS
