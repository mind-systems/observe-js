// Browser ambient context — explicit single-variable ContextManager.
// Imports from core only; never imports from node/.
//
// Context boundary: the active context is correct for the SYNCHRONOUS call
// stack and immediately-chained microtasks (e.g. a click handler that
// synchronously calls tracedFetch). It does NOT survive arbitrary await
// hops — each new microtask continuation runs with whatever the variable
// holds at that moment, which is the restored (previous) value. This is the
// intended contract for v0.1.2; ALS-equivalent across-await propagation is
// deferred pending TC39 AsyncContext.

import type { Context, ContextManager } from '../core/context.js';
import { setContextManager } from '../core/context.js';

function createBrowserContextManager(): ContextManager {
  let current: Context | undefined = undefined;

  return {
    active(): Context | undefined {
      return current;
    },

    with<T>(ctx: Context, fn: () => T): T {
      // Save the previous context, set the new one, run fn, then restore in
      // finally — correct on both normal return and throw.
      const previous = current;
      current = ctx;
      try {
        return fn();
      } finally {
        current = previous;
      }
    },

    bind(ctx: Context): void {
      // enterWith-style: sets ctx for the rest of the current scope without
      // restoring. Use only at well-defined callback / interceptor boundaries
      // where the surrounding scope is already well-known. Prefer with()
      // everywhere else.
      current = ctx;
    },
  };
}

/** Singleton browser context manager. Re-exported to keep the module alive under tree-shaking. */
export const browserContextManager: ContextManager = createBrowserContextManager();

// Register on module load — importing this module is the only setup step needed.
setContextManager(browserContextManager);
