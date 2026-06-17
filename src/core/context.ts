// Platform-neutral ambient context interface and registry.
// Imports nothing outside core/ — no Node or browser globals.

/** Active trace/span context, carried ambiently across async boundaries. */
export interface Context {
  traceId: string;
  spanId: string;
  traceFlags: number;
  /** W3C tracestate value, passed through verbatim when present. */
  traceState?: string;
}

/**
 * Platform-supplied implementation wired in once at startup via
 * setContextManager(). Each platform layer (node/, browser/) provides one.
 */
export interface ContextManager {
  /** Return the currently active context, or undefined if none is set. */
  active(): Context | undefined;
  /**
   * Run fn inside the given context. Restores the previous context on both
   * normal return and throw.
   */
  with<T>(ctx: Context, fn: () => T): T;
  /**
   * Bind ctx as the active context for the rest of the current async scope
   * (enterWith-style). Unlike with(), does not restore on exit — use only at
   * callback / interceptor boundaries where the scope is already well-defined.
   */
  bind(ctx: Context): void;
}

// ── No-op default (active before any platform manager registers) ──────────────

const noopManager: ContextManager = {
  active(): Context | undefined {
    return undefined;
  },
  with<T>(_ctx: Context, fn: () => T): T {
    return fn();
  },
  bind(_ctx: Context): void {
    // intentional no-op
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

let currentManager: ContextManager = noopManager;

/** Platform layers call this once at startup to register their implementation. */
export function setContextManager(mgr: ContextManager): void {
  currentManager = mgr;
}

/** Read the currently active context. Returns undefined when no span is open. */
export function getActiveContext(): Context | undefined {
  return currentManager.active();
}

/**
 * Run fn inside the given context. Restores the previous context on exit or
 * throw. This is the primary way to scope work to a trace span.
 */
export function runWithContext<T>(ctx: Context, fn: () => T): T {
  return currentManager.with(ctx, fn);
}

/**
 * Bind ctx as the active context for the current async scope. Prefer
 * runWithContext wherever possible — bindContext does not restore on exit.
 */
export function bindContext(ctx: Context): void {
  currentManager.bind(ctx);
}
