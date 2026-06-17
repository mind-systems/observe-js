See [CLAUDE.md](CLAUDE.md).

## Project Structure

```
src/
├── core/index.ts       # Platform-neutral layer (imports nothing outside itself)
├── node/index.ts       # Node entry (imports core only)
├── node/winston.ts     # Winston transport adapter stub (task 09)
└── browser/index.ts    # Browser entry (imports core only)

test/
└── exports.smoke.test.ts  # Verifies all dist artifacts exist and are importable

contract/               # git submodule — observe-contract@v0.1.2 (frozen fixtures)
```

## Key Entry Points

| File | Purpose |
|---|---|
| `package.json` | Conditional `exports` map (browser/node/import/require); `typesVersions`; build/test scripts |
| `tsup.config.ts` | Dual ESM+CJS build — array of two configs: browser (`platform: 'browser'`) + node (`platform: 'node'`) |
| `vitest.config.ts` | Test runner config — Node environment, `test/**/*.test.ts` |
| `tsconfig.json` | TypeScript config — `Bundler` resolution, `noEmit: true` (tsup owns emit) |
| `contract/` | Submodule at `v0.1.2`; fixtures: `golden-record.json`, `fixtures/service-start.json`, `levels.json` |

## Commands

```
npm run build          # clean + tsup (dual ESM+CJS)
npm test               # build + vitest run
npm run typecheck      # tsc --noEmit
npm run verify:exports # CJS require + ESM import + browser conditions + attw --pack .
```
