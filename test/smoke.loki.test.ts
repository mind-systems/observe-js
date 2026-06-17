/**
 * Live Loki smoke test.
 *
 * Proves the observe-js SDK delivers logs end-to-end to a running local Loki:
 *   init + log → POST http://localhost:3100/otlp/v1/logs → record retrievable
 *   via LogQL with correct index labels (project / service_name / level), high-
 *   cardinality fields (trace_id, span_id, service_instance_id) absent from the
 *   index, and trace_id queryable as structured metadata.
 *
 * Requires the local backend to be running:
 *   make backend-up   (Loki must be reachable at http://localhost:3100)
 *
 * Self-skips when Loki is unreachable — safe to include in the default test run.
 * Run it directly against a live backend with: npm run test:loki
 */

// Side effect: registers the Node ContextManager via setContextManager().
import '../src/node/index.js';

import { describe, expect, it } from 'vitest';
import { init, log, flush } from '../src/core/index.js';
import { startSpan, withSpan } from '../src/node/index.js';
// Use node:crypto rather than globalThis.crypto.randomUUID() — globalThis.crypto
// can be undefined in the vitest VM on Node 18.x (same guard as conformance.node.test.ts).
import { randomUUID } from 'node:crypto';

const LOKI = 'http://localhost:3100';

// ── Reachability guard ─────────────────────────────────────────────────────────
// Top-level await is valid in vitest ESM. Probe /ready before defining tests so
// the whole suite skips when the backend is down rather than failing.

const lokiUp = await fetch(`${LOKI}/ready`, { signal: AbortSignal.timeout(2000) })
  .then((r) => r.ok)
  .catch(() => false);

if (!lokiUp) {
  console.warn(
    '[smoke.loki] Loki not reachable at http://localhost:3100 — suite skipped.\n' +
      'Run `make backend-up` to start the local backend.',
  );
}

const suite = lokiUp ? describe : describe.skip;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Current time as nanosecond string, matching sdk.ts's nowNanoString(). */
function nowNs(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

/** Time `minutes` ago as a nanosecond string. */
function minutesAgoNs(minutes: number): string {
  return (BigInt(Date.now() - minutes * 60_000) * 1_000_000n).toString();
}

interface LokiStream {
  stream: Record<string, string>;
  values: [string, string][];
}

/** Issue a single query_range call and return the parsed JSON body. */
async function queryRange(logql: string): Promise<{ data: { result: LokiStream[] } }> {
  const params = new URLSearchParams({
    query: logql,
    start: minutesAgoNs(5),
    end: nowNs(),
    limit: '10',
  });
  const res = await fetch(`${LOKI}/loki/api/v1/query_range?${params.toString()}`);
  if (!res.ok) throw new Error(`Loki query_range HTTP ${res.status}`);
  return res.json() as Promise<{ data: { result: LokiStream[] } }>;
}

/**
 * Poll until a stream whose values contain `needle` appears, or return null
 * on timeout. Avoids a fixed sleep — queries every `intervalMs` up to `maxMs`.
 */
async function pollForStream(
  logql: string,
  needle: string,
  maxMs = 10_000,
  intervalMs = 1_000,
): Promise<LokiStream | null> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const body = await queryRange(logql);
    const streams = body?.data?.result ?? [];
    for (const s of streams) {
      if ((s.values ?? []).some(([, line]) => line.includes(needle))) return s;
    }
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  return null;
}

// ── Suite ──────────────────────────────────────────────────────────────────────

suite('Loki live smoke', () => {
  it(
    'init + log → record retrievable, labels correct, trace_id in structured metadata',
    async () => {
      // Unique per-run id carried in the log body to isolate this run from
      // accumulated history. project/service stay stable (low-cardinality labels).
      const runId = randomUUID();
      const errors: unknown[] = [];
      const onError = (err: unknown) => errors.push(err);

      // 1. Boot the SDK pointing at the local Loki.
      init({
        project: 'observe-js-smoke',
        service: 'smoke-service',
        endpoint: `${LOKI}/otlp/v1/logs`,
        onError,
      });

      // 2. Open a span and emit a log inside it so trace_id is stamped on the record.
      //    Span.traceId is a 32-char lowercase hex string (see src/core/span.ts).
      const span = startSpan('smoke');
      const traceId = span.traceId;
      withSpan(span, () => log('info', `smoke ${runId}`, { 'run.id': runId }));

      // 3. Drain the batcher through the exporter.
      await flush();

      // 4. Cut Loki head chunks to the store (mirrors backend/verify.sh).
      await fetch(`${LOKI}/flush`, { method: 'POST' });

      // 5. Poll for the emitted record (up to ~10 s, 1 s cadence).
      const stream = await pollForStream(
        `{project="observe-js-smoke"} |= "${runId}"`,
        `smoke ${runId}`,
      );

      if (stream === null) {
        // Export errors make ingest failures diagnosable instead of a generic timeout.
        const errDetail =
          errors.length > 0
            ? `Export errors: ${errors.map(String).join('; ')}`
            : 'No export errors captured — check the Loki ingest path manually.';
        throw new Error(`Record "smoke ${runId}" not found in Loki after polling. ${errDetail}`);
      }

      // ── Assertion 1: record body retrievable ──────────────────────────────
      const lines = (stream.values ?? []).map(([, line]) => line);
      expect(lines.some((l) => l.includes(`smoke ${runId}`))).toBe(true);

      // ── Assertion 2: required index labels present with correct values ─────
      // Loki maps service.name → service_name for label compatibility.
      // Note: in Loki 3.x, stream.stream in query_range responses includes both
      // indexed stream labels AND per-stream structured metadata. The three required
      // labels are present here; the negative check (assertion 3) uses a label-
      // selector query rather than not.toHaveProperty() to avoid Loki-version brittleness.
      const labels = stream.stream;
      expect(labels['project']).toBe('observe-js-smoke');
      expect(labels['service_name']).toBe('smoke-service');
      expect(labels['level']).toBe('info');

      // ── Assertion 3: high-cardinality fields NOT indexed as stream labels ───
      // Label-selector queries only match when the field is a real index label.
      // Returning 0 results proves the field lives in structured metadata, not the index.
      // (Loki 3.x includes structured metadata in stream.stream for display, so
      // not.toHaveProperty() on stream.stream would give a false-negative here.)
      const noTraceLabel = await queryRange(`{project="observe-js-smoke", trace_id!=""}`);
      expect(noTraceLabel.data.result).toHaveLength(0);

      const noSpanLabel = await queryRange(`{project="observe-js-smoke", span_id!=""}`);
      expect(noSpanLabel.data.result).toHaveLength(0);

      const noInstanceLabel = await queryRange(
        `{project="observe-js-smoke", service_instance_id!=""}`,
      );
      expect(noInstanceLabel.data.result).toHaveLength(0);

      // ── Assertion 4: trace_id queryable as structured metadata ────────────
      // The record is already in the store so a single direct query is sufficient.
      const traceBody = await queryRange(
        `{project="observe-js-smoke"} |= "${runId}" | trace_id="${traceId}"`,
      );
      const traceStreams = traceBody?.data?.result ?? [];
      const traceFound = traceStreams.some((s) =>
        (s.values ?? []).some(([, line]) => line.includes(`smoke ${runId}`)),
      );
      expect(traceFound).toBe(true);
    },
    // The poll loop budgets ~10 s; add flush + network slack for a safe ceiling.
    20_000,
  );
});
