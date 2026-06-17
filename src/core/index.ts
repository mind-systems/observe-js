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
