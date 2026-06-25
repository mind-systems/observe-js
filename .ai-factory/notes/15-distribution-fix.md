# observe-js distribution fix

**Date:** 2026-06-25
**Source:** conversation context

## Key Findings

- Root cause: `contract/` is a git submodule; `npm install git+https://…` does not run `git submodule update --init`, so `contract/levels.json` is absent and `prepare: "npm run build"` fails for any consumer installing via a git URL.
- Correct fix: remove the git submodule, copy `contract/levels.json` as a plain tracked file — no import path changes needed; `prepare` then works for any consumer without vendor workarounds.
- `dist/` stays gitignored and built fresh on install (do not commit it).
- Tag `v0.2.0` after the fix so consumers can pin to an immutable ref. No npm registry needed.
- After tagging, update `mind_api` and `mind_web` to drop `vendor/observe-js-0.0.0.tgz` and switch to `git+https://github.com/mind-systems/observe-js.git#v0.2.0`.

## Details

### Problem today

`src/core/levels.ts` imports `../../contract/levels.json`. `contract/` is a git submodule pointing to `https://github.com/mind-systems/observe-contract`. When npm clones the repo from a `git+https://` URL it does not recurse into submodules, so `contract/levels.json` is missing and the build fails.

Active workaround: `mind_api` and `mind_web` vendor a pre-built tgz (`vendor/observe-js-0.0.0.tgz`) with `prepare` stripped from its `package.json`. Every SDK update requires re-vendoring manually.

### Steps to fix in `observe-js`

```bash
# 1. Remove the submodule
git submodule deinit -f contract
git rm -f contract
rm -rf .git/modules/contract

# 2. Copy levels.json as a plain file
cp <path-to-observe-contract>/levels.json contract/levels.json
git add contract/levels.json

# 3. Verify .gitmodules is empty / deleted
# 4. Build locally
npm run build

# 5. Commit, tag, push
git commit -m "Inline contract/levels.json, remove git submodule"
git tag v0.2.0
git push origin main v0.2.0
```

Key files: `.gitmodules`, `src/core/levels.ts` (import path stays unchanged if file lands at `contract/levels.json`), `package.json` (`prepare` stays as-is).

Alternative: inline `levels.json` values directly as a TypeScript const in `src/core/levels.ts` — eliminates the JSON file dependency entirely. Slightly cleaner but diverges from the submodule-era pattern.

### Steps to update consumers

After `v0.2.0` is tagged — in both `mind_api` (`~/projects/mind/mind_api/`) and `mind_web` (`~/projects/mind/mind_web/`):

1. Change `"observe-js": "file:./vendor/observe-js-0.0.0.tgz"` → `"observe-js": "git+https://github.com/mind-systems/observe-js.git#v0.2.0"`
2. Delete `vendor/observe-js-0.0.0.tgz`; remove `vendor/` if empty
3. `npm install` and verify the app builds

### Versioning convention

Tag deliberately on each SDK update. Consumer upgrades by bumping the tag in `package.json` — no registry, no publish step.
