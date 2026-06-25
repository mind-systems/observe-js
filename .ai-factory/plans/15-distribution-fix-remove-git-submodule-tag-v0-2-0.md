# Plan: Distribution fix — remove git submodule, tag v0.2.0

## Context
`contract/` is a git submodule, so `npm install git+https://…` never fetches it and `prepare: "npm run build"` fails for every consumer — forcing the `vendor/observe-js-0.0.0.tgz` workaround. This milestone inlines the contract files as plain tracked files, cuts an immutable `v0.2.0` tag, and points `mind_api` and `mind_web` at it.

## Settings
- Testing: no
- Logging: minimal
- Docs: no

## Tasks

### Phase 1: Inline contract, remove submodule (in `observe-js`)

- [x] **Task 1: Back up the imported contract files, then remove the submodule**
  Files: `/tmp/contract-backup/` (temp), `.gitmodules`, `.git/modules/contract`, `contract/` (gitlink)
  ⚠️ Ordering matters: `git submodule deinit -f contract` **wipes the `contract/` working tree**, and `rm -rf .git/modules/contract` destroys the submodule's only other local copy. The three JSON files must be backed up **before** anything is destroyed, or Task 2 will have nothing to copy from.
  Run, from the `observe-js` repo root, **in this order**:
  1. Back up first, while the working tree still has the v0.1.2 content:
     `mkdir -p /tmp/contract-backup/fixtures`
     `cp contract/levels.json contract/golden-record.json /tmp/contract-backup/`
     `cp contract/fixtures/service-start.json /tmp/contract-backup/fixtures/`
     Confirm all three landed in `/tmp/contract-backup/` before proceeding.
  2. Now remove the submodule:
     `git submodule deinit -f contract` → `git rm -f contract` → `rm -rf .git/modules/contract`.
  `git rm -f contract` stages removal of the gitlink and strips the `[submodule "contract"]` section from `.gitmodules`. After this, verify `.gitmodules` is empty or gone (`git status` shows it staged for deletion) and that `git submodule status` lists nothing.
  Fallback if the backup was missed: `git clone --depth 1 -b v0.1.2 https://github.com/mind-systems/observe-contract /tmp/contract-backup` and copy the three files from there instead.

- [x] **Task 2: Re-add the imported contract files as plain tracked files** (depends on Task 1)
  Files: `contract/levels.json`, `contract/golden-record.json`, `contract/fixtures/service-start.json`
  Recreate ONLY the files actually imported by `src/` and `test/`, at their existing paths so no import path changes:
  - `src/core/levels.ts` imports `../../contract/levels.json` — **must** exist.
  - `test/conformance.node.test.ts` imports `../contract/golden-record.json` and `../contract/fixtures/service-start.json`.
  - `test/levels.test.ts` imports `../contract/levels.json`.
  Restore from the Task 1 backup:
  `mkdir -p contract/fixtures`
  `cp /tmp/contract-backup/levels.json /tmp/contract-backup/golden-record.json contract/`
  `cp /tmp/contract-backup/fixtures/service-start.json contract/fixtures/`
  Then ensure `contract/` contains **only** those three JSON files — no leftover `.git` gitlink file, no `.gitignore`, no markdown from the submodule (these are wiped by deinit, but verify with `ls -A contract contract/fixtures`). Finally `git add contract/levels.json contract/golden-record.json contract/fixtures/service-start.json`.
  Do NOT re-add submodule metadata that nothing imports (`CLAUDE.md`, `README.md`, `AGENTS.md`, `otlp-logging-contract.md`, `.gitignore`).
  Note: only `levels.json` is strictly required for `prepare`/build; `golden-record.json` and `fixtures/service-start.json` are added so `npm test` stays green at the tagged commit — without them the conformance suite fails to resolve its imports. The content is verbatim `observe-contract@v0.1.2`, so the conformance suite's `levelsData.version === '0.1.2'` pin and baked-in fixture values stay green.

- [x] **Task 3: Verify build, tests, and packaging locally** (depends on Task 2)
  Files: none (verification only)
  Confirm the fix end-to-end before tagging:
  - `npm run build` succeeds (this is what `prepare` runs for consumers; proves `contract/levels.json` resolves). `npm test` re-runs the build (`test` = `npm run build && vitest run`), but keep this build-only step — it isolates the exact failure mode consumers hit.
  - `npm test` is green (proves the conformance + levels suites still resolve their fixtures).
  - `git status` shows `dist/` is NOT staged (it stays gitignored — do not commit build output).
  - Optionally `npm pack --dry-run` to confirm the packed file list is sane.
  `prepare` and the `prepare: "npm run build"` script stay exactly as-is — do not modify `package.json` scripts. The `version` field in `package.json` may remain `0.0.0`; consumers pin by git tag, not by registry version.

- [ ] **Task 4: Commit, tag `v0.2.0`, push** (depends on Task 3)
  Files: none (git operations)
  Commit the staged changes (submodule removal + inlined files) with a message such as `Inline contract files, remove git submodule`. The commit body should note the contract is now **content-inlined at v0.1.2** rather than submodule-pinned by SHA — version drift is henceforth caught by the soft `levelsData.version === '0.1.2'` check plus the baked-in conformance fixtures, not a submodule gitlink. Then `git tag v0.2.0` on that commit and `git push origin main v0.2.0`. Run all git commands from inside the `observe-js` sub-repo (per root coordination rules). Confirm the tag is visible on the remote so consumers can pin `#v0.2.0`.

- [ ] **Task 5: Mark the milestone done in the roadmap** (depends on Task 4)
  Files: `observe-js/.ai-factory/ROADMAP.md`
  Tick the `[ ] Distribution fix — remove git submodule, tag v0.2.0` entry (line ~49) to `[x]`. This keeps roadmap linkage for the fix. Commit this in the `observe-js` repo (may fold into the Commit 1 set if done before the tag, or a small follow-up commit — but do not retag).

### Phase 2: Switch consumers off the vendored tgz

- [ ] **Task 6: Update `mind_api` to install from the tag** (depends on Task 4)
  Files: `~/projects/mind/mind_api/package.json`, `~/projects/mind/mind_api/vendor/`
  In `package.json`, change the dependency `"observe-js": "file:./vendor/observe-js-0.0.0.tgz"` → `"observe-js": "git+https://github.com/mind-systems/observe-js.git#v0.2.0"`.
  Delete `vendor/observe-js-0.0.0.tgz` and the unpacked `vendor/observe-js/` directory; remove `vendor/` entirely if it becomes empty.
  Run `npm install` (or `rm -rf node_modules package-lock.json && npm install` if the lockfile still pins the tgz — npm otherwise keeps resolving the stale `file:` entry) and verify the app builds and `observe-js` resolves with `init`/`log` available. Run git operations inside the `mind_api` repo; commit the `package.json`/lockfile/vendor changes there.

- [ ] **Task 7: Update `mind_web` to install from the tag** (depends on Task 4)
  Files: `~/projects/mind/mind_web/package.json`, `~/projects/mind/mind_web/vendor/`
  Same change as Task 6, in the `mind_web` repo: swap the `file:./vendor/...` dependency for `git+https://github.com/mind-systems/observe-js.git#v0.2.0`, delete `vendor/observe-js-0.0.0.tgz` and `vendor/observe-js/` (remove `vendor/` if empty), `npm install` (with the same lockfile-reset caveat), and verify the web app builds with the browser entry resolving correctly. Commit inside the `mind_web` repo.

## Commit Plan
Work spans three independent git repositories — commit inside each, never from the root.
- **Commit 1** — `observe-js` (Tasks 1–3, 5): single commit `Inline contract files, remove git submodule` (body notes the v0.1.2 content-inline), then tag `v0.2.0` and push (Task 4). `dist/` stays out of the commit. The roadmap tick (Task 5) can ride in this commit or a small follow-up — do not retag.
- **Commit 2** — `mind_api` (Task 6): commit the dependency switch and vendor removal (e.g. `Install observe-js from v0.2.0 tag, drop vendored tgz`).
- **Commit 3** — `mind_web` (Task 7): same dependency switch and vendor removal, committed in its own repo.
