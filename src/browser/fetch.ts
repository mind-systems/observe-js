// Browser trace-context propagation helpers — opt-in traceparent injection.
// Imports from core only; never imports from node/.
//
// Global fetch is intentionally NOT patched. Propagation is opt-in: callers
// wrap their fetch calls with tracedFetch, or build headers with withTraceparent,
// rather than relying on a patched global. A future opt-in installGlobalFetch()
// is explicitly deferred and must not be built here.

import { headersCarrier, inject } from '../core/index.js';

/**
 * Construct a `Headers` object from the input (if any) and inject the active
 * span's traceparent into it. When no span is active, the headers are returned
 * unchanged (inject is a no-op).
 *
 * @param headers  Optional existing headers to merge. Accepts any HeadersInit
 *   shape (Headers, plain object, or entries array).
 * @returns A new `Headers` instance with the traceparent header set when a
 *   span is active.
 */
export function withTraceparent(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  inject(headersCarrier(result));
  return result;
}

/**
 * Fetch wrapper that injects the active trace context as a W3C `traceparent`
 * header on every request. When no span is active the request goes through
 * without modification.
 *
 * Drop-in replacement for the global `fetch` inside a traced scope:
 *
 *   const res = await tracedFetch('/api/orders');
 *
 * @param input  The URL or Request to fetch.
 * @param init   Optional RequestInit. Existing `headers` are preserved and
 *   merged; traceparent is added (or overwritten) on top.
 */
export function tracedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = withTraceparent(init?.headers);
  return fetch(input, { ...init, headers });
}
