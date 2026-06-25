# Plan Review: Distribution fix — remove git submodule, tag v0.2.0

**Plan:** `15-distribution-fix-remove-git-submodule-tag-v0-2-0.md`
**Risk Level:** 🟡 Medium

## Verification performed

I verified every codebase assumption the plan makes:

- `contract` **is** a git submodule — `.gitmodules` has `[submodule "contract"]`, `git submodule status` shows it pinned at `c96fc71` (v0.1.2). ✅
- The exact set of imported contract files is **exactly three** — grep over `src/` and `test/` confirms only:
  - `src/core/levels.ts` → `../../contract/levels.json` ✅
  - `test/conformance.node.test.ts` → `../contract/golden-record.json`, `../contract/fixtures/service-start.json`, `../contract/levels.json` ✅
  - `test/levels.test.ts` → `../contract/levels.json` ✅
  - No other contract file (`CLAUDE.md`, `README.md`, `otlp-logging-contract.md`, `AGENTS.md`, `.gitignore`) is imported by code. The plan's "copy only these three" scope is correct.
- `package.json`: `version` is `0.0.0`, `prepare: "npm run build"`, `build: "npm run clean && tsup"`, `files: ["dist"]`, `dist/` is gitignored. All match the plan's claims. ✅
- The conformance version pin reads `levelsData.version` (`contract/levels.json` has `"version": "0.1.2"`), so copying `levels.json` verbatim keeps `test/conformance.node.test.ts:96` green. ✅
- `levels.json` is consumed at **build** time (esbuild/tsup inlines the JSON), so it is genuinely required for `prepare` to succeed on the consumer — the plan's central diagnosis is correct. `golden-record.json` + `fixtures/service-start.json` are test-only; `prepare` does not run tests, so they are not needed by consumers but are correctly added to keep the tagged commit's `npm test` green. ✅
- Both consumers currently pin `"observe-js": "file:./vendor/observe-js-0.0.0.tgz"` (`mind_api/package.json:49`, `mind_web/package.json:19`) and both have `vendor/observe-js-0.0.0.tgz` + unpacked `vendor/observe-js/`. The plan's Phase 2 file paths and dependency strings are accurate. ✅
- Submodule working tree is clean against v0.1.2 (`git -C contract status` empty), so "copy the content currently present" yields the correct v0.1.2 bytes. ✅

## Critical Issues

### 1. Task 2 destroys its own source before copying — ordering bug

Task 1 runs, in order:
```
git submodule deinit -f contract   # empties the contract/ working tree
git rm -f contract                 # removes the gitlink
rm -rf .git/modules/contract       # destroys the submodule's git store
```

`git submodule deinit -f contract` **removes the submodule's working-tree contents** (that is its documented behavior — it wipes the checked-out files). By the time Task 1 finishes, `contract/levels.json`, `contract/golden-record.json`, and `contract/fixtures/service-start.json` are **gone from the working tree**, and `rm -rf .git/modules/contract` destroys the only other local copy.

Task 2 then instructs: *"Copy these three from the previously-checked-out submodule working tree (the same content that is currently present)."* That source no longer exists once Task 1 has run — the implementer would have nothing to copy from and would have to re-clone the contract repo (which the plan never mentions).

**Fix (pick one):**
- **Back up before destroying** — add a step at the very start of Task 1: copy the three files to a temp location (e.g. `/tmp/contract-backup/`) *before* `git submodule deinit`, then have Task 2 restore from there. This is the simplest and most robust.
- **Or** reorder so the files are read out of git first: `git -C contract show HEAD:levels.json > ...` etc., captured before `rm -rf .git/modules/contract`.
- **Or** explicitly state Task 2's fallback is `git clone --depth 1 -b v0.1.2 https://github.com/mind-systems/observe-contract` and copy from there.

As written, the happy path described in Task 2 cannot execute. This is the one blocking flaw.

## Minor Notes / Suggestions

- **Task 2 — guard against a stray `contract/.gitignore`.** The submodule ships a `contract/.gitignore`. After deinit it disappears with the rest of the tree, so in practice this is fine — but if the implementer instead chooses to *keep* leftover files rather than recreate from clean, that `.gitignore` (and the `.git` gitlink file) must not survive. A one-line "ensure `contract/` contains only the three JSON files, no `.git`/`.gitignore`/markdown" check would make Task 2 unambiguous. (I confirmed `contract/.gitignore` does not match `*.json`, so it would not block `git add` even if present — low severity.)

- **Task 3 — `npm test` already builds.** The `test` script is `npm run build && vitest run`, so running `npm test` re-runs the build. The separate `npm run build` step in Task 3 is still worth keeping (it isolates the build-only failure mode that consumers hit), just noting the two overlap — no change required.

- **Phase 2 ordering is sound.** Tasks 5/6 correctly depend on Task 4 (tag pushed to remote) because `git+https://…#v0.2.0` resolves against the pushed tag. The note about `rm -rf node_modules package-lock.json` when the lockfile still pins the tgz is the right call — npm will otherwise keep resolving the `file:` entry from the lock.

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md` present at root and in observe-js): No boundary violation. Inlining the frozen contract as plain tracked files keeps the OTLP-contract source of truth intact; the imported `levels.json` content is unchanged, so the cross-platform contract is not mutated. The conformance suite still pins v0.1.2. **WARN (informational):** the contract is no longer a submodule pinned by SHA — version drift is now caught only by the soft `levelsData.version === '0.1.2'` check plus the baked-in fixture values. Acceptable for a distribution fix, but worth a one-line note in the commit/roadmap that the v0.1.2 pin is now content-inlined rather than submodule-pinned.
- **Rules** (`.ai-factory/RULES.md`): not present — no rule violations to check (WARN: optional file absent).
- **Roadmap** (`.ai-factory/ROADMAP.md`): present and modified in the working tree; this milestone is a `fix` (distribution). Ensure the milestone is linked there. **WARN:** confirm roadmap linkage for this fix.
- **skill-context** (`.ai-factory/skill-context/aif-review/SKILL.md`): not present — no project-specific review overrides to apply.

## Summary

The plan's diagnosis and scope are correct and well-researched — the three-file set, the build-time vs test-time distinction, the `prepare` failure mode, and both consumers' dependency strings all check out against the actual codebase. The single blocking problem is the **Task 1→Task 2 ordering**: Task 1 deletes the contract working tree and submodule git store, leaving Task 2 with no source to copy from. Add a backup-before-destroy step (or a re-clone fallback) and the plan is ready to implement.
