// Browser layer — explicit lightweight ambient context (no zone.js), framework-agnostic.
// Imports from core only; never imports from node/.

export { __sdk } from '../core/index.js';

// Re-export the singleton (a used value, not a bare side-effecting import) to
// keep the setContextManager() registration alive under tree-shaking.
export { browserContextManager } from './context.js';
// context.js is also imported by init.ts, so registration is guaranteed either way.

// Browser init wrapper (shadows core init — consumers must use this one).
export { init, createBeaconExporter } from './init.js';

// Browser-only propagation helpers.
export { tracedFetch, withTraceparent } from './fetch.js';

// Core API re-exports for browser consumers.
export { log, flush, shutdown } from '../core/index.js';
export { startSpan, withSpan } from '../core/index.js';
export { getActiveContext, runWithContext, bindContext } from '../core/index.js';
export { inject, extract, objectCarrier, headersCarrier } from '../core/index.js';
export { encodeLogs } from '../core/index.js';

// Types re-exported for browser consumers.
export type { InitOptions } from '../core/index.js';
export type { Context, ContextManager } from '../core/index.js';
export type { Span } from '../core/index.js';
export type { Carrier } from '../core/index.js';
