# Plan Review: 08 — Carrier-agnostic propagation (`inject`/`extract`)

## Plan Review Summary

**Plan Reviewed:** `08-carrier-agnostic-propagation.md`
**Files cross-checked:** `src/core/context.ts`, `src/core/span.ts`, `src/core/index.ts`, `src/node/index.ts`, `src/browser/index.ts`, `test/span.node.test.ts`, `test/exports.smoke.test.ts`, `.ai-factory/notes/07-carrier-agnostic-propagation.md`, `.ai-factory/ROADMAP.md`
**Risk Level:** 🟢 Low

The plan is well-aligned with the v0.1.2 contract note (`notes/07`) and the ROADMAP milestone. All referenced file paths exist and the described API usage (`getActiveContext` from `./context.js`, the `Context` interface shape, the `core → node/browser` re-export pattern) matches the actual codebase. The transport-free `Carrier` abstraction correctly keeps gRPC out of core, which is the stated point of the milestone. No architectural mistakes, no security concerns, no missing migrations.

### Context Gates
- **Architecture (`ARCHITECTURE.md`):** PASS — `propagation` is explicitly listed as belonging to platform-neutral `core/` (ROADMAP "Layout"); the plan keeps imports within `core/` and adds no transport dependency, honoring the boundary rule.
- **Rules:** No `RULES.md` present in `.ai-factory/` — gate skipped (WARN: optional file absent).
- **Roadmap (`ROADMAP.md`):** PASS — maps directly to the open milestone "Carrier-agnostic propagation"; the plan's "Done when" (round-trip + malformed-yields-undefined + W3C format match) is a superset of the roadmap's Done-when. Good linkage.
- **Skill-context (`aif-review/SKILL.md`):** Not present — no project-specific overrides to apply.

### Critical Issues
None.

### Minor Issues / Improvements

1. **Test filename is self-contradictory (Task 4).**
   The Files line names `test/propagation.test.ts`, but the "Active-context default" bullet says to `import '../src/node/index.js'` (to register the AsyncLocalStorage manager) and to "Use the `.node.test.ts` suffix if it relies on the registered manager." Per the documented convention in `test/span.node.test.ts` (header comment), any suite that registers the Node `ContextManager` and mutates process-global module state **must** use the `.node.test.ts` suffix for vitest per-file isolation. Since the active-context test depends on `withSpan`/the registered manager, the file should be named `test/propagation.node.test.ts` — or the active-context test should be split into a separate `.node.test.ts` file while pure format/parse tests stay in `propagation.test.ts`. Resolve this naming ambiguity before implementing so the suite doesn't leak manager state into other suites.

2. **`parseTraceparent` flags-to-number step is implied but not stated.**
   The round-trip test asserts `traceFlags` equality, and `formatTraceparent` renders `ctx.traceFlags` to 2-hex. For the round-trip to hold, `parseTraceparent` must convert the 2-hex flags field back to a number (`parseInt(flags, 16)`) and place it on the returned `Context.traceFlags`. The plan says "validate ... flags 2 hex" and "return the parsed `Context`" but never explicitly states the hex→number conversion. Make this explicit to avoid an implementer validating the field without parsing it into `traceFlags`.

3. **`tracestate` does not survive a child span (known v0 limitation — acceptable, worth noting).**
   `traceState` is added only to `Context`, not to `Span`, and `withSpan`/`startSpan` build a `Context` from `{ traceId, spanId, traceFlags }` only (see `span.ts:122-124`). So an inbound `extract` → `bindContext` → `startSpan` chain drops `tracestate` for any downstream child span; verbatim pass-through only holds for a direct `extract`→`inject` without an intervening span. This matches the contract's "Optional in v0; at minimum don't corrupt it," so it is acceptable — but the plan should acknowledge it as a deliberate v0 boundary so it isn't mistaken for a bug later.

4. **Consider a dist-level reachability test (optional, matches existing convention).**
   `test/span.node.test.ts` includes a `dist/node.mjs` block asserting the span API "survives bundling and is publicly reachable," and `exports.smoke.test.ts` verifies dist artifacts. The plan's Task 4 is source-level only. Since Task 3 newly exposes `inject`/`extract`/`objectCarrier`/`headersCarrier` through the public entries (including the browser entry, which previously exported only `__sdk`), a small dist-level smoke assertion (e.g. `typeof dist.inject === 'function'`) would catch a broken export wiring that source-level tests cannot. Not required by the milestone's "Done when," but consistent with the established pattern.

### Positive Notes
- Correctly instructs re-implementing the all-zero/hex-shape checks locally rather than exporting private helpers across modules — matches the existing `span.ts` style and keeps module boundaries clean.
- `extract` kept pure (no auto-bind) exactly as the contract note requires; binding left to the caller via `runWithContext`/`bindContext`.
- Case-insensitive `objectCarrier.get` and reliance on `Headers`' built-in case-insensitivity both directly address the contract's "Header case-insensitivity" watch item.
- `traceState?` added as a purely additive optional field — does not disturb existing `toEqual(ctx)` assertions in `span.node.test.ts` (optional/undefined), so no regression to the ambient-context suites.
- Adding the propagation exports to the browser entry is correct and necessary: propagation is platform-neutral, and `browser/index.ts` currently re-exports only `__sdk`.
- Dependency ordering between tasks (1→2→3→4) is correct.

The findings above are all non-blocking refinements; address items 1 and 2 during implementation to avoid rework.
