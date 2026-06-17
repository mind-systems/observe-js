// Browser layer — explicit lightweight ambient context (no zone.js), framework-agnostic wrapper.
// Imports from core only; never imports from node/.

export { __sdk } from '../core/index.js';

// Trace-context propagation re-exports for browser consumers.
export type { Carrier } from '../core/index.js';
export { inject, extract, objectCarrier, headersCarrier } from '../core/index.js';
