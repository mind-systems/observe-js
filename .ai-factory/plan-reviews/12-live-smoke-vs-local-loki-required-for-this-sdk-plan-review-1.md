# Plan Review: Live smoke vs local Loki (required for this SDK)

**Plan:** `.ai-factory/plans/12-live-smoke-vs-local-loki-required-for-this-sdk.md`
**Risk Level:** 🟡 Medium (two concrete corrections; otherwise sound)

## Summary

The plan is well-researched and faithful to the spec note (`.ai-factory/notes/12-live-smoke-loki.md`) and the workspace `backend/verify.sh` oracle. The public API it relies on is correct as written:

- `init({ project, service, endpoint })`, `log('info', msg, attrs)`, `flush()` are all exported from `src/core/index.ts`. ✓
- `startSpan`, `withSpan` are re-exported from `src/node/index.ts`. ✓
- `span.traceId` exists and is a 32-char lowercase hex string (`src/core/span.ts`). ✓
- `withSpan(span, fn)` accepts a `Span` object and binds it via `runWithContext`, so `log()` inside it picks up `traceId`/`spanId` through `getActiveContext()` (`src/core/sdk.ts`). ✓
- The side-effect import `import '../src/node/index.js'` to register the Node ContextManager matches the established `*.node.test.ts` convention. ✓

Two improvements over `verify.sh` are correct and worth keeping:
- Using a **now-relative time window** (`start` = a few minutes ago, `end` = now) instead of the fixed `1700000000000000000` start — the SDK emits live `Date.now()` timestamps (`nowNanoString()` in `sdk.ts`), so the window must reach "now". The plan handles this correctly.
- Asserting the label set on **this record's stream** rather than the global `/loki/api/v1/labels` endpoint — more correct for an isolated SDK integration test.

### Context Gates

- **Architecture** (`.ai-factory/ARCHITECTURE.md`): Dependency rules require `core/` and `node/` to import nothing test/backend-related. The plan explicitly keeps all helpers local to `test/smoke.loki.test.ts` with no new source modules. ✓ Aligned, no gate violation.
- **Rules** (`.ai-factory/rules/base.md`): "no console output in production paths" — the planned `console.warn` is in test code, not a production path. File naming `smoke.loki.test.ts` is kebab-case. ✓ No violation.
- **Roadmap** (`.ai-factory/ROADMAP.md`): Directly implements the Verification milestone (line 41) and is named in the DoD (line 47, "live smoke against local Loki green"). ✓ Linkage present. WARN: none.

---

## Findings

### 1. `README.md` does not exist (wrong assumption about the codebase) — MEDIUM

Task 2 lists `Files: package.json, README.md` and says "Add a short README note". **There is no `README.md` in `observe-js/`** (no README at all, and no `docs/` directory). The plan reads as if it is editing an existing file.

Two problems follow:
- The task must explicitly **create** the file, or the path is wrong.
- Creating a whole `README.md` whose only content is a smoke-test backend prerequisite is awkward and conflicts with the documentation convention that a README is a landing page, not a place for test-ops notes. It also sits in mild tension with the plan's own `Settings: Docs: no`.

**Recommendation:** Either (a) drop the README edit and rely on a top-of-file doc comment in `smoke.loki.test.ts` plus the npm script name as the discoverability surface, or (b) if a note is wanted, state clearly that `README.md` is being created and give it minimal landing-page framing (what the package is + the one prerequisite line), not just an orphan note.

### 2. Bare `crypto.randomUUID()` for the run id may throw in the vitest VM — MEDIUM

Step 1 of Task 1 proposes `crypto.randomUUID()` (the global). The codebase explicitly documents that `globalThis.crypto` can be **undefined** in the vitest VM on Node 18.x — see `test/conformance.node.test.ts` lines 35–39 ("`globalThis.crypto` is undefined there") and the defensive fallback branches in `src/core/resource.ts` and `src/core/span.ts` (`globalThis.crypto?.getRandomValues`). A top-level `crypto.randomUUID()` in this suite would throw a `ReferenceError`/`TypeError` on exactly the environment the project is known to run in.

**Recommendation:** Import from `node:crypto` instead — `import { randomUUID } from 'node:crypto';` — which is always available in Node regardless of whether the Web Crypto global is exposed in the VM realm. (This is a Node-only test, so the `node:` import is appropriate.)

### 3. Exact label-set equality is underspecified against Loki auto-labels — LOW

The assertion "key set ... equals `{ project, service_name, level }` after removing any Loki-internal keys such as `detected_level` if present" uses "such as", which is non-exhaustive. Loki may attach additional automatic stream labels beyond `detected_level` depending on version/config. A strict `toEqual` on the raw key set could be brittle.

**Recommendation:** Specify the assertion as a **positive containment** check (`project`, `service_name`, `level` are all present with the expected values) plus a **negative** check that the known-forbidden high-cardinality labels are absent (`trace_id`, `span_id`, `service_instance_id` — mirroring the forbidden list in `verify.sh`), rather than a brittle exact key-set match. This preserves the policy intent while tolerating Loki-internal label additions.

### 4. Unique `project` per run inflates index cardinality in the persistent store — LOW

Deriving `project: observe-js-smoke-<runId>` gives clean isolation, but `project` is an **index label** (low-cardinality by design — see the OTLP Wire Shape section of ARCHITECTURE.md). Every run creates a brand-new persistent stream that never gets cleaned up, slowly growing the local index's stream count.

**Recommendation:** Consider keeping a **stable** `project` (e.g. `observe-js-smoke`) and isolating runs by the `run.id` attribute already in the body / structured metadata (line filter `|= runId` or `| run_id="<runId>"`). This keeps the low-cardinality label policy honest and matches what the SDK's attribute discipline preaches. If the unique-project approach is kept (the spec note's "Watch" does suggest a unique run id), at least note the accumulation as a known local-only tradeoff.

### 5. Minor: "top-level await ... same style as conformance.node.test.ts" is inaccurate — INFO

`test/conformance.node.test.ts` does **not** use top-level `await` (it uses `beforeEach`); no existing test in the suite does. Top-level await is valid in vitest ESM, so the technique is fine — but the cited precedent is wrong. Adjust the reference so the implementer doesn't go looking for a pattern that isn't there.

---

## Positive Notes

- Correctly identifies that the suite must self-skip (`describe.skip`) when Loki is unreachable so the default `npm test` stays green in CI — and that `test:loki` needs no `build` prefix because it imports from `src/` like the other `*.node.test.ts` suites.
- Correctly frames the test as "what the SDK emitted is retrievable", not a re-test of the backend — matches the spec note's "Watch".
- Poll-with-retry instead of a single fixed `sleep` is a genuine flakiness improvement over `verify.sh`.
- Trace-id-as-structured-metadata positive guard (`| trace_id="<traceId>"`) mirrors the proven `verify.sh` step 5b.
