// Platform-neutral W3C traceparent propagation.
// Imports nothing outside core/ — no Node or browser globals.

import { getActiveContext } from './context.js';
import type { Context } from './context.js';

// ── Carrier interface ─────────────────────────────────────────────────────────

/** Abstract header/metadata carrier used by inject() and extract(). */
export interface Carrier {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

// ── W3C traceparent format/parse ──────────────────────────────────────────────

function isAllZero(hex: string): boolean {
  return /^0+$/.test(hex);
}

function isLowerHex(s: string, len: number): boolean {
  return s.length === len && /^[0-9a-f]+$/.test(s);
}

/**
 * Serialize ctx to a W3C traceparent value.
 * Format: 00-<32hex traceId>-<16hex spanId>-<2hex flags>
 */
function formatTraceparent(ctx: Context): string {
  const flags = (ctx.traceFlags & 0xff).toString(16).padStart(2, '0');
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

/**
 * Parse a W3C traceparent value. Returns undefined on any validation failure;
 * never throws.
 */
function parseTraceparent(value: string): Context | undefined {
  const parts = value.split('-');
  if (parts.length !== 4) return undefined;

  const [version, traceId, spanId, flagsHex] = parts;

  if (version !== '00') return undefined;
  if (!isLowerHex(traceId, 32) || isAllZero(traceId)) return undefined;
  if (!isLowerHex(spanId, 16) || isAllZero(spanId)) return undefined;
  if (!isLowerHex(flagsHex, 2)) return undefined;

  return {
    traceId,
    spanId,
    traceFlags: parseInt(flagsHex, 16),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Write the active (or supplied) trace context into the carrier as a W3C
 * traceparent header. No-ops when no context is available.
 * When ctx.traceState is present, also writes the tracestate header verbatim.
 */
export function inject(carrier: Carrier, ctx?: Context): void {
  const active = ctx ?? getActiveContext();
  if (active === undefined) return;
  carrier.set('traceparent', formatTraceparent(active));
  if (active.traceState !== undefined) {
    carrier.set('tracestate', active.traceState);
  }
}

/**
 * Read trace context from the carrier. Returns undefined when the carrier
 * carries no valid traceparent. Pure — does not bind ambient context.
 * When a tracestate header is present it is copied verbatim onto the Context.
 */
export function extract(carrier: Carrier): Context | undefined {
  const header = carrier.get('traceparent');
  if (header === undefined) return undefined;
  const ctx = parseTraceparent(header);
  if (ctx === undefined) return undefined;
  const traceState = carrier.get('tracestate');
  if (traceState !== undefined) {
    ctx.traceState = traceState;
  }
  return ctx;
}

// ── Carrier adapters ──────────────────────────────────────────────────────────

/**
 * Wrap a plain string-keyed object as a Carrier.
 * get() does a case-insensitive key lookup so HTTP-style header maps work
 * regardless of casing; set() writes the lowercase key.
 */
export function objectCarrier(obj: Record<string, string>): Carrier {
  return {
    get(key: string): string | undefined {
      const lower = key.toLowerCase();
      for (const k of Object.keys(obj)) {
        if (k.toLowerCase() === lower) return obj[k];
      }
      return undefined;
    },
    set(key: string, value: string): void {
      obj[key.toLowerCase()] = value;
    },
  };
}

/**
 * Wrap a standard Headers object as a Carrier.
 * Headers.get() is already case-insensitive; set() delegates to Headers.set().
 * Headers is a shared web/Node 18+ global — no import needed.
 */
export function headersCarrier(headers: Headers): Carrier {
  return {
    get(key: string): string | undefined {
      return headers.get(key) ?? undefined;
    },
    set(key: string, value: string): void {
      headers.set(key, value);
    },
  };
}
