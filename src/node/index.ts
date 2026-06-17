// Node layer — AsyncLocalStorage ambient context, Winston transport adapter.
// Imports from core only; never imports from browser/.

export { __sdk } from '../core/index.js';

// Re-export the singleton (a used value, not a bare side-effecting call) to
// keep the setContextManager() registration alive under tree-shaking.
export { nodeContextManager } from './context.js';

// Context API re-exports for Node consumers.
export type { Context, ContextManager } from '../core/context.js';
export { getActiveContext, runWithContext, bindContext } from '../core/context.js';
