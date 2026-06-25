# Plan Review 2: Distribution fix — remove git submodule, tag v0.2.0

**Plan:** `15-distribution-fix-remove-git-submodule-tag-v0-2-0.md`
**Risk Level:** 🟢 Low

## What changed since review 1

Review 1 raised exactly one blocking issue: **Task 1 destroyed its own copy source before Task 2 could read it** (`git submodule deinit -f contract` wipes the working tree and `rm -rf .git/modules/contract` destroys the only other local copy, leaving Task 2 nothing to copy from).

This revision resolves it completely:
- Task 1 now backs up all three JSON files to `/tmp/contract-backup/` **before** any destructive command, with an explicit "confirm all three landed before proceeding" gate and a `⚠️ Ordering matters` callout.
- A re-clone fallback (`git clone --depth 1 -b v0.1.2 …`) is documented for the missed-backup case.
- Task 2 restores from the backup rather than from the (now-gone) submodule tree.
- The minor "guard against stray `.gitignore`/`.git`/markdown" note from review 1 is now baked into Task 2 (`ls -A contract contract/fixtures` verification + explicit "only those three JSON files").
- The Architecture-gate WARN about content-inline vs SHA-pin is now reflected in the Task 4 commit-body instruction.

## Verification performed (re-confirmed against the live codebase)

- `contract` is still a submodule pinned at `c96fc71` (v0.1.2); `.gitmodules` has the `[submodule "contract"]` section. ✅
- Imported contract files are **exactly three**, at the paths the plan recreates:
  - `src/core/levels.ts:4` → `../../contract/levels.json` ✅
  - `test/conformance.node.test.ts:18-20` → `../contract/golden-record.json`, `../contract/fixtures/service-start.json`, `../contract/levels.json` ✅
  - `test/levels.test.ts:3` → `../contract/levels.json` ✅
  - No source/test imports `CLAUDE.md`, `README.md`, `AGENTS.md`, `otlp-logging-contract.md`, or `.gitignore`. The "copy only three" scope is correct. ✅
- `package.json`: `version` `0.0.0`, `prepare: "npm run build"`, `build: "npm run clean && tsup"`, `test: "npm run build && vitest run"`, `files: ["dist"]`. All match the plan. ✅
- `contract/levels.json` has `"version": "0.1.2"`; `test/conformance.node.test.ts:96` asserts `levelsData.version === '0.1.2'` — verbatim copy keeps it green. ✅
- `levels.json` is the only contract file pulled into `src/` (build-time/`prepare`-relevant); the other two are test-only. The plan's build-vs-test distinction is accurate. ✅
- Both consumers pin `"observe-js": "file:./vendor/observe-js-0.0.0.tgz"` (`mind_api/package.json:49`, `mind_web/package.json:19`) and both carry `vendor/observe-js-0.0.0.tgz` + unpacked `vendor/observe-js/`. Phase 2 paths/strings are accurate. ✅
- Roadmap entry is at line 49, matching Task 5's "line ~49". ✅

## Critical Issues

None. The one blocking flaw from review 1 is resolved, and no new blocking issues were found.

## Minor Notes / Suggestions (non-blocking)

- **Roadmap entry text is narrower than the plan.** The line-49 roadmap entry describes copying only `contract/levels.json`, while the plan correctly copies three files (the two extra are needed to keep `npm test` green at the tagged commit). The plan is the more correct artifact; no action needed, but if Task 5 touches that line it could optionally align the wording. Informational only.
- **`git rm -f contract` and `.gitmodules`.** The plan relies on `git rm` stripping the `[submodule "contract"]` section from `.gitmodules` and staging it. Modern git does this, but the plan already adds a `git status` / `git submodule status` verification afterward, so a partial result would be caught. Good defensive framing.
- **npm `prepare` on git installs.** The fix's premise — npm runs `prepare` (hence `build`, hence resolves `contract/levels.json`) on `git+https` installs while skipping submodule init — is correct, and inlining the JSON as a tracked file is the right and minimal fix. No packaging change to `files`/`dist` is needed because consumers build from source on install. ✅

## Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md` present): No boundary violation. Inlining the frozen contract as plain tracked files keeps the OTLP-contract source of truth and the v0.1.2 conformance pin intact; `levels.json` content is unchanged, so the cross-platform contract is not mutated. **WARN (informational, now acknowledged in-plan):** the contract moves from SHA-pinned submodule to content-inlined at v0.1.2 — drift is caught by the soft `levelsData.version === '0.1.2'` check plus baked-in fixtures rather than a gitlink. Task 4's commit-body instruction now records this. Acceptable for a distribution fix.
- **Rules** (`.ai-factory/RULES.md`): not present — nothing to enforce (WARN: optional file absent).
- **Roadmap** (`.ai-factory/ROADMAP.md`): present; this is a `fix` and Task 5 ticks its line-49 entry, preserving linkage. ✅
- **skill-context** (`.ai-factory/skill-context/aif-review/SKILL.md`): not present — no project-specific review overrides to apply.

## Summary

The revision cleanly closes the only blocking issue from review 1 and folds in both minor notes. Every codebase assumption — the three-file import set, the build-time vs test-time split, the `prepare` failure mode, the conformance version pin, and both consumers' dependency strings — re-verifies against the live tree. The plan is correct, well-sequenced (backup → destroy → restore → verify → tag → switch consumers), and ready to implement.

PLAN_REVIEW_PASS
