// Platform-neutral span module — id generation and span lifecycle.
// Imports nothing outside core/ (uses only globalThis.crypto, like resource.ts).

import { getActiveContext, runWithContext } from './context.js';

// ── Span interface ─────────────────────────────────────────────────────────────

/** A W3C-shaped trace/span context record. */
export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: number;
}

// ── Id generation ─────────────────────────────────────────────────────────────

// Prefer the Web Crypto global (Node 18+ main realm, browsers). Fall back to a
// Math.random-based byte fill when the global is absent (e.g. vitest VM contexts
// on older Node 18.x patch levels). Ids are uniqueness tokens, not secrets, so
// the weaker fallback is acceptable. Mirror the defensive pattern in resource.ts.
function randomBytes(byteLen: number): Uint8Array {
  const buf = new Uint8Array(byteLen);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < byteLen; i++) {
      buf[i] = (Math.random() * 256) | 0;
    }
  }
  return buf;
}

function randomHex(byteLen: number): string {
  return Array.from(randomBytes(byteLen))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Return true when every character in the hex string is '0'.
function isAllZero(hex: string): boolean {
  return /^0+$/.test(hex);
}

// Generate a 32-char hex traceId (16 bytes), retrying on the all-zero case.
function newTraceId(): string {
  let id: string;
  do {
    id = randomHex(16);
  } while (isAllZero(id));
  return id;
}

// Generate a 16-char hex spanId (8 bytes), retrying on the all-zero case.
function newSpanId(): string {
  let id: string;
  do {
    id = randomHex(8);
  } while (isAllZero(id));
  return id;
}

// ── Span lifecycle ────────────────────────────────────────────────────────────

/**
 * Create a new span. Inherits the active trace context when one exists (same
 * traceId, parent = active spanId); opens a new root trace otherwise.
 *
 * @param name Reserved for future span export (timing, status, etc.); unused
 *   in v0. Accepted now so callers can label spans without a later API change.
 */
export function startSpan(name?: string): Span {
  // `name` is captured for future span-export use. v0 does not record or emit
  // it; the parameter exists to stabilise the public API surface.
  void name;

  const active = getActiveContext();

  if (active !== undefined) {
    // Inherit the current trace; parent is the active span.
    return {
      traceId: active.traceId,
      spanId: newSpanId(),
      parentSpanId: active.spanId,
      traceFlags: active.traceFlags,
    };
  }

  // No active context — start a new root trace.
  // traceFlags 0x01 = sampled. Span sampling is a future tracing-backend concern;
  // logs are always emitted regardless of this flag.
  return {
    traceId: newTraceId(),
    spanId: newSpanId(),
    traceFlags: 0x01,
  };
}

/**
 * Run `fn` inside the ambient context of `spanOrName`.
 *
 * - If `spanOrName` is a `Span` object, it is used as-is.
 * - If it is a string or undefined, a new span is created via
 *   `startSpan(spanOrName)`.
 *
 * Note: accepting `undefined` is an intentional ergonomic superset of the
 * language-neutral contract (which specifies `Span | string`). `withSpan(
 * undefined, fn)` simply opens a fresh root/child span without naming it —
 * the semantics are a strict extension, not a violation.
 *
 * The context manager's try/finally inside `runWithContext` restores the
 * previous context on both normal return and throw, so nesting is always
 * well-behaved. Returns `fn`'s result transparently (works for sync and
 * async callbacks alike).
 */
export function withSpan<T>(spanOrName: Span | string | undefined, fn: () => T): T {
  const span: Span =
    typeof spanOrName === 'object' && spanOrName !== null
      ? spanOrName
      : startSpan(spanOrName as string | undefined);

  return runWithContext(
    { traceId: span.traceId, spanId: span.spanId, traceFlags: span.traceFlags },
    fn,
  );
}
