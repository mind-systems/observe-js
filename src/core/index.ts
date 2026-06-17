// Platform-neutral core — record model, OTLP encoder, batcher, exporter, resource attrs.
// This module imports nothing outside itself.

export const __sdk = 'observe-js' as const;

// Wire types and helpers
export type {
  AnyValue,
  KeyValue,
  LogRecord,
  InstrumentationScope,
  ScopeLogs,
  Resource,
  ResourceLogs,
  ExportLogsServiceRequest,
} from './wire.js';
export { stringValue, kv } from './wire.js';

// Level mapping
export type { Level } from './levels.js';
export { LEVELS, severityFor } from './levels.js';

// Resource builder
export { buildResource } from './resource.js';

// Envelope encoder
export { encodeLogs, DEFAULT_SCOPE } from './encode.js';

// OTLP/HTTP exporter
export type { Exporter, ExporterConfig } from './exporter.js';
export { createExporter } from './exporter.js';

// Bounded batching buffer
export type { Batcher, BatcherConfig } from './batcher.js';
export { createBatcher } from './batcher.js';

// Ambient context interface and registry
export type { Context, ContextManager } from './context.js';
export { setContextManager, getActiveContext, runWithContext, bindContext } from './context.js';

// Span / correlation core
export type { Span } from './span.js';
export { startSpan, withSpan } from './span.js';

// Trace-context propagation
export type { Carrier } from './propagation.js';
export { inject, extract, objectCarrier, headersCarrier } from './propagation.js';

// Public API: init + log + lifecycle
export type { InitOptions } from './sdk.js';
export { init, log, flush, shutdown } from './sdk.js';
