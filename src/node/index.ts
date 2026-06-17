// Node layer — AsyncLocalStorage ambient context, Winston transport adapter.
// Imports from core only; never imports from browser/.

export { __sdk } from '../core/index.js';

// Re-export the singleton (a used value, not a bare side-effecting call) to
// keep the setContextManager() registration alive under tree-shaking.
export { nodeContextManager } from './context.js';

// Public API re-exports for Node consumers.
export { init, log, flush, shutdown } from '../core/index.js';
export type { InitOptions } from '../core/index.js';
export type { Level } from '../core/index.js';

// Context API re-exports for Node consumers.
export type { Context, ContextManager } from '../core/context.js';
export { getActiveContext, runWithContext, bindContext } from '../core/context.js';

// Span / correlation API re-exports for Node consumers.
export type { Span } from '../core/index.js';
export { startSpan, withSpan } from '../core/index.js';

// Trace-context propagation re-exports for Node consumers.
export type { Carrier } from '../core/index.js';
export { inject, extract, objectCarrier, headersCarrier } from '../core/index.js';
