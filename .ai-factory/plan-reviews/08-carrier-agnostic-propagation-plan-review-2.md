# Plan Review: 08 — Carrier-agnostic propagation (`inject`/`extract`) — round 2

## Plan Review Summary

**Plan Reviewed:** `08-carrier-agnostic-propagation.md`
**Files cross-checked:** `src/core/context.ts`, `src/core/span.ts`, `src/core/index.ts`, `src/node/index.ts`, `src/browser/index.ts`, `test/span.node.test.ts`, `test/exports.smoke.test.ts`, `tsup.config.ts`, `.ai-factory/ARCHITECTURE.md` (via ROADMAP "Layout"), `.ai-factory/rules/base.md`, `.ai-factory/ROADMAP.md`, `observe-contract/otlp-logging-contract.md`, prior review `08-...-plan-review-1.md`
**Risk Level:** 🟢 Low

This revision resolves every point raised in review-1 and remains accurate against the codebase and the frozen `observe-contract@v0.1.2`. All referenced file paths exist; all API claims verified:
- `getActiveContext()` is exported from `src/core/context.ts` (line 55) — import path `./context.js` is correct.
- `Context` is `{ traceId, spanId, traceFlags }` (context.ts:5–9); adding an optional `traceState?: string` is purely additive.
- `span.ts:122–124` does build the `Context` from `{ traceId, spanId, traceFlags }` only — the cited v0 `tracestate`-through-span limitation is real and correctly characterized.
- The `core → node/browser` re-export pattern matches the existing span block (`core/index.ts:42–43`, `node/index.ts:14–16`); `browser/index.ts` currently re-exports only `__sdk`, exactly as the plan states.
- `Headers` is a Node 18+ / browser shared global, so `headersCarrier` needs no import and stays platform-neutral.
- `dist/browser.mjs` and `dist/node.mjs` are real build artifacts (tsup config + `exports.smoke.test.ts`), so the dist-level reachability assertion is well-founded.

### Resolution of review-1 findings
1. **Test-filename ambiguity** — resolved: the plan now cleanly splits pure carrier/format tests into `test/propagation.test.ts` and the manager-dependent active-context path into `test/propagation.node.test.ts`, citing the `.node.test.ts` isolation convention verbatim.
2. **flags hex→number step** — resolved: Task 1 now states explicitly that `parseTraceparent` must `parseInt(flags, 16)` onto `Context.traceFlags`, and explains why the round-trip assertion depends on it.
3. **`tracestate`-through-span v0 limitation** — resolved: promoted to a dedicated "v0 boundaries" section with an explicit "Do not add `traceState` to `Span` in this milestone" instruction.
4. **dist-level reachability test** — resolved: added to Task 4, covering both the node and the newly-extended browser entry.

### Context Gates
- **Architecture (`ARCHITECTURE.md` / ROADMAP "Layout"):** PASS — `propagation` is explicitly listed under platform-neutral `core/`; the plan keeps imports within `core/` and adds no transport dependency (no `@grpc/grpc-js`), honoring the boundary rule and ROADMAP guarantee line 48.
- **Rules (`rules/base.md`):** PASS — kebab-case file names (`propagation.ts`), `camelCase` functions, platform-neutral core (no Node/browser globals beyond the shared `Headers`/`fetch`-era globals), no console output. `extract` stays pure and `inject` is a no-op when no context — consistent with "never break the host."
- **Roadmap (`ROADMAP.md`):** PASS — maps directly to the open "Carrier-agnostic propagation" milestone; the plan's "Done when" (round-trip + malformed→undefined + W3C format match) is a superset of the roadmap's Done-when. Good linkage.
- **Skill-context (`aif-review/SKILL.md`):** Not present (`.ai-factory/skill-context/` empty) — no project-specific overrides to apply.

### Critical Issues
None.

### Minor Issues / Improvements (non-blocking)

1. **Strict version-`00` rejection is intentional but diverges from lenient W3C parsing.**
   The plan validates `version === '00'` and rejects `01-...`, which the milestone's own "Done when" test requires. The W3C spec technically recommends forward-compatible parsing of higher versions (read the first four fields, ignore extra). For v0 this strict behavior is correct and consistent with the contract example (`00-...`) and the tests — flagged only so a future maintainer adding tracing-backend interop knows the leniency was a deliberate v0 choice, not an oversight.

2. **`tracestate` is copied verbatim without format validation.**
   The plan correctly says "never synthesize or mutate tracestate beyond verbatim copy." It does not validate the `tracestate` string shape. This is acceptable per the contract ("Optional in v0; at minimum don't corrupt it") — verbatim pass-through cannot corrupt a value it doesn't parse. No change needed; noted for completeness.

3. **`objectCarrier.get` duplicate-case-key behavior is unspecified.**
   Case-insensitive scan returns the first lowercased-key match; if a host object somehow holds both `Traceparent` and `traceparent`, which wins is implementation-defined. Practically irrelevant for HTTP-style maps, but a one-line "first match wins" note in the implementation would remove any ambiguity.

### Positive Notes
- Re-implements the all-zero/hex-shape checks locally rather than exporting private helpers across modules — matches `span.ts` style and keeps module boundaries clean.
- `extract` kept pure (no auto-bind); binding is left to the caller via `runWithContext`/`bindContext`, exactly as the contract requires.
- Case-insensitive `objectCarrier.get` plus reliance on `Headers`' built-in case-insensitivity directly address the contract's header-case watch item.
- `traceState?` added as an additive optional field — leaves `toEqual(ctx)` assertions in `span.node.test.ts` intact (stays undefined there), so no regression to the ambient-context suites.
- The dist-level reachability test specifically guards the new browser-entry wiring, which source-level tests cannot catch.
- Task dependency ordering (1→2→3→4) is correct and each task lists accurate file targets.

This plan is solid and ready to implement; the three minor notes are optional refinements, none blocking.

PLAN_REVIEW_PASS
