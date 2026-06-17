// OTLP/JSON envelope encoder — wraps a resource + records into the standard
// resourceLogs → scopeLogs → logRecords nesting.
// Pure and deterministic: no clock, no id generation, no mutation of inputs.

import type {
  ExportLogsServiceRequest,
  InstrumentationScope,
  LogRecord,
  Resource,
} from './wire.js';

/** The SDK instrumentation scope stamped on every batch (matches the golden fixtures). */
export const DEFAULT_SCOPE: InstrumentationScope = { name: 'observe', version: '0.1.0' };

/**
 * Encode a batch of log records into an OTLP/JSON ExportLogsServiceRequest.
 *
 * All records are placed under a single scopeLogs entry using `scope` when
 * supplied, otherwise `DEFAULT_SCOPE`.
 */
export function encodeLogs(
  resource: Resource,
  records: LogRecord[],
  scope?: InstrumentationScope,
): ExportLogsServiceRequest {
  return {
    resourceLogs: [
      {
        resource,
        scopeLogs: [
          {
            scope: scope ?? DEFAULT_SCOPE,
            logRecords: records,
          },
        ],
      },
    ],
  };
}
