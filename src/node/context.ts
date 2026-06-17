// Node ambient context — AsyncLocalStorage implementation of ContextManager.
// Imports from core only; never imports from browser/.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context, ContextManager } from '../core/context.js';
import { setContextManager } from '../core/context.js';

function createNodeContextManager(): ContextManager {
  const als = new AsyncLocalStorage<Context>();

  return {
    active(): Context | undefined {
      return als.getStore();
    },

    with<T>(ctx: Context, fn: () => T): T {
      // als.run restores the previous store on both normal return and throw,
      // satisfying the restore-on-throw requirement.
      return als.run(ctx, fn);
    },

    bind(ctx: Context): void {
      // enterWith binds ctx for the rest of the current async scope and does
      // NOT restore the previous context — use only at callback / interceptor
      // boundaries where the scope is already well-defined. Prefer with()
      // everywhere else.
      als.enterWith(ctx);
    },
  };
}

/** Singleton Node context manager. Re-exported to keep the module alive under tree-shaking. */
export const nodeContextManager: ContextManager = createNodeContextManager();

// Register on module load — importing this module is the only setup step needed.
setContextManager(nodeContextManager);
