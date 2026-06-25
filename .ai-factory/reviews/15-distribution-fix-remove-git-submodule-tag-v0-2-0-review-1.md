# Code Review: Distribution fix — remove git submodule, tag v0.2.0

**Review 1** · Risk: 🟢 Low · Verdict: functionally correct and verified; only minor non-blocking nits.

## Scope reviewed
The change is git-surgery + data files, not logic. Implementation landed in two commits:
- `6833e4f Inline contract files, remove git submodule` (tagged `v0.2.0`, pushed to remote)
- `3dff265 Mark plan complete, update description for inlined contract`

Plus the consumer-side edits in `mind_api` and `mind_web` (separate repos).

## What I verified (not just read — ran)

- **Submodule removal is clean.** `git show 6833e4f` shows the `contract` gitlink (`mode 160000`, `Subproject commit c96fc71`) deleted and the `[submodule "contract"]` section removed from `.gitmodules`. No stray `.git` gitlink or `.gitignore`/markdown left in `contract/` — `ls -A contract contract/fixtures` shows exactly the three JSON files.
- **The three inlined files are the imported set and nothing more.** `contract/levels.json`, `contract/golden-record.json`, `contract/fixtures/service-start.json` — matching the imports in `src/core/levels.ts`, `test/conformance.node.test.ts`, `test/levels.test.ts`. `levels.json` carries `"version": "0.1.2"`, so the conformance pin and the `levels.ts` module-load guard (6-key union) both stay satisfied.
- **Build + full test suite pass.** `npm test` (= `npm run build && vitest run`): build success, **16 files / 148 tests passed**, including `conformance.node.test.ts` (9) and `levels.test.ts` (7). The inlined JSON resolves at build and test time.
- **`dist/` was not committed.** It is absent from `6833e4f`'s file list and remains gitignored.
- **The actual goal works end-to-end.** In `mind_api/node_modules/observe-js/` a built `dist/` is present — i.e. `prepare: "npm run build"` ran during the `git+https://…#v0.2.0` install, which is exactly what the submodule was breaking. `contract/` is correctly NOT shipped in the installed package (`files: ["dist"]`), confirming `levels.json` is purely a build-time input inlined into `dist`.
- **Both consumers switched correctly.** `mind_api/package.json:49` and `mind_web/package.json:19` now read `git+https://github.com/mind-systems/observe-js.git#v0.2.0`; both `vendor/` directories are gone; both lockfiles resolve `observe-js` to commit `6833e4f` (the `v0.2.0` tag target).
- **Tag integrity.** `git ls-remote --tags origin` shows `v0.2.0 → 6833e4f`, the inline commit. Consumers pin an immutable ref.

## Findings (all non-blocking)

### 1. [Low] Stale comment in `src/core/levels.ts` still says "submodule"
`src/core/levels.ts:1-2` reads:
```
// Canonical level → OTLP severity mapping sourced from the contract submodule.
// Do not redeclare severity numbers here — they come from contract/levels.json.
```
The contract is no longer a submodule — it's an inlined tracked file. The comment is now inaccurate. Functionally harmless (the import path `../../contract/levels.json` is unchanged and correct), but the wording should drop "submodule". Not worth a retag on its own; fold into the next commit that touches this file.

### 2. [Low] `.gitmodules` left as an empty tracked file
`git rm -f contract` emptied `.gitmodules` (now 0 bytes) but left it tracked rather than deleting it. An empty `.gitmodules` is inert — git ignores it and no submodule machinery triggers — so this is cosmetic. If you want it tidy, `git rm .gitmodules` in a follow-up. No behavior impact.

### 3. [Info] Lockfiles normalize the resolved URL to `git+ssh://`
Both consumer lockfiles record `resolved: git+ssh://git@github.com/mind-systems/observe-js.git#6833e4f…` even though `package.json` declares `git+https://`. This is npm's standard host normalization, and it installed fine locally. Flagging only as a CI/operational gotcha: an environment that lacks SSH access to GitHub (HTTPS-only, no deploy key) may fail to resolve from the lockfile. If `mind_api`/`mind_web` CI installs over HTTPS without SSH creds, confirm the install there before relying on it. Not a defect in this change — inherent to npm git deps.

## Correctness / runtime risk assessment
- No type mismatches: `levels.json` shape is unchanged from the submodule version; `severityFor`/`LEVELS` consumers unaffected.
- No migration/race concerns — pure packaging change.
- The one real failure mode this could have introduced (consumer `prepare` build failing because `levels.json` is missing post-install) is empirically disproven: the built `dist/` exists in the installed consumer package.

## Conclusion
The fix does what the plan specified and what the milestone requires: submodule removed, three contract files inlined verbatim at v0.1.2, build/tests green, `dist/` uncommitted, `v0.2.0` tagged and pushed, both consumers off the vendored tgz and installing (and building) from the tag. The three findings above are minor and do not block the milestone; address #1 and #2 opportunistically in a later commit (no retag needed).
