# Plan Review 2: 09 — Node adapter, Winston transport

**Plan:** `.ai-factory/plans/09-node-adapter-winston-transport.md`
**Files Reviewed:** plan + targeted codebase (`src/node/winston.ts`, `src/core/index.ts`, `src/core/levels.ts`, `package.json`, `tsup.config.ts`, `tsconfig.json`, `vitest.config.ts`, `contract/otlp-logging-contract.md`, `contract/levels.json`, notes 08/09, prior review `09-...-plan-review-1.md`)
**Risk Level:** 🟢 Low

## Context Gates

- **Architecture (`.ai-factory/ARCHITECTURE.md`):** OK. The `node/ → core/ only`, `node/ never imports browser/` boundary is explicitly honored (plan line 36: "import from `../core/index.js`; never from `../browser/`"). Importing third-party `winston-transport` from the node layer is consistent with boundary rules — a host-supplied library, not a sibling layer. The plan states this rationale explicitly (line 36).
- **Rules (`.ai-factory/rules/`):** Present; no rule conflicts. English-only output respected. OK.
- **Roadmap (`.ai-factory/ROADMAP.md`):** OK — maps directly to "Adapters → Node adapter — Winston transport" and matches note 09's "Done when" (conformance-passing records, contract level map, host transports still work, `attw` clean). Linkage is clear.

## Resolution of Plan-Review-1 Findings

All four prior findings are addressed:

1. **`winston-transport` bundled vs. externalized (was Important):** ✅ Resolved. Task 1 now declares **both** `winston` and `winston-transport` as `peerDependencies` *and* `devDependencies`, and the rationale (line 26–29) correctly explains that declaring `winston-transport` as a peer is what makes tsup externalize the package actually imported (`import Transport from 'winston-transport'`), with the explicit `external`-array fallback noted. Task 3's gate (line 58) adds verification that `winston-transport` is externalized (not inlined) in `dist/winston.{mjs,cjs}`. This fully closes the prior gap.

2. **Default-export ergonomic example (was Minor):** ✅ Resolved. Line 39 now documents the named export `ObserveTransport` as the primary surface, explicitly warns that bare `require('observe-js/winston')` returns the namespace (not a constructor) under tsup CJS interop, and gives the correct `.ObserveTransport` / `.default` call forms.

3. **Prerequisite gate + plan/note numbering divergence (was Minor):** ✅ Resolved. The Boundaries section (lines 12–13) now states the hard `log`-export gate before Task 2, points the implementer to `notes/08-public-api-init-log.md` for the spec (vs. the differently-numbered `plans/08-*`), and instructs not to re-implement `log`.

4. **Attribute extraction passes through format-added fields (was Minor):** ✅ Resolved. The "Attribute contract" boundary (line 18) and Task 2 (line 44) now state precisely that only `level` and `message` are stripped, that other string keys (incl. format-added `timestamp`/`label`/`ms`) are forwarded as intentional user meta, and that tests must use a minimal logger format so the "exactly `{userId, region}`" assertion is not brittle (line 53).

## Independent Verification

- **Level map is contract-accurate.** `contract/otlp-logging-contract.md` line 58 reads exactly `error → error, warn → warn, info → info, http → debug, verbose → debug, debug → debug, silly → trace`, matching the plan verbatim. Unknown → `info` is a sound default. `Level` is the core union (`'trace'|'debug'|'info'|'warn'|'error'|'fatal'`) and is exported from `../core/index.js` (line 20 of `src/core/index.ts`), so `import type { Level }` resolves.
- **Prerequisite genuinely absent.** `src/core/index.ts` exports end at propagation (line 47); `log`/`init` are not exported. The plan's gate is real and correctly flagged — Task 2 is legitimately blocked until note-08's work ships.
- **Immutable level source.** `info[Symbol.for('level')] ?? info.level` is correct — `Symbol.for(...)` returns global-registry symbols matching Winston's `triple-beam` symbols across module realms; robust against host colorizing formats.
- **`Object.keys(info)`** excludes Symbol-keyed internals (`level`/`message`/`splat`) by definition, so the "no Symbol fields leak into attrs" guarantee holds with just the two string-key drops.
- **Toolchain compatibility.** `tsconfig.json` has `esModuleInterop: true`, so `import Transport from 'winston-transport'` (CJS `export =`) resolves, and `Transport.TransportStreamOptions` is a valid namespace reference under winston-transport's own typings. `verbatimModuleSyntax: true` is satisfied (value default import, not an elided type import).
- **Test harness.** `vitest.config.ts` uses `environment: 'node'`, `include: ['test/**/*.test.ts']` — the `.node.test.ts` suffix is picked up and matches existing suites (`context.node.test.ts`, `span.node.test.ts`).
- **Packaging restraint.** The `./winston` subpath export (types-first ordering) and the tsup `winston` node entry already exist in `package.json`/`tsup.config.ts`; the plan correctly forbids touching `exports`/`typesVersions`/`outExtension`. The `verify:exports` + `attw --pack .` gate is present in `package.json` scripts.

## Critical Issues

None.

## Minor Issues / Notes

- **Optional, non-blocking:** Task 1 says to "use the `winston-transport` version that the pinned `winston` resolves to in the lockfile." Winston 3.13.x resolves `winston-transport@^4.7.x`, so `"^4.7.0"` is a fine permissive floor; just confirm the installed version is ≥ the declared floor after `npm install` so the peer range isn't narrower than what's actually present. This is a build-time check the plan already implies, not a defect.

## Positive Notes

- The Boundaries section is exemplary: explicit, enumerated assumptions; the externalization mechanism is now correctly tied to the *imported* package; no scope creep; additive-only integration model documented.
- Never-throw / always-callback discipline (`try/finally`, `setImmediate(() => this.emit('logged', info))`) follows Winston's transport contract precisely and honors the "never break the host" mandate.
- Test plan covers all correctness guarantees: full level table incl. unknown→info, exact attr extraction, Symbol-field exclusion, additive coexistence with another transport, and never-throw-when-`log`-throws — driven through a real Winston logger to exercise the genuine `info` shape.

## Verdict

The revision resolves every finding from plan-review-1 and survives independent re-verification against the contract, codebase, and toolchain config. The plan is contract-accurate, architecturally sound, packaging-correct, and properly gated on its one real prerequisite.

PLAN_REVIEW_PASS
