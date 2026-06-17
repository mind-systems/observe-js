// OTLP/HTTP JSON exporter — POSTs batches to a single endpoint via global fetch.
// The resource is bound at construction and reused for every export call.
//
// Future knobs (deferred):
//   - Retry with exponential back-off
//   - Pluggable transport (e.g. navigator.sendBeacon on page unload)

import type { LogRecord, Resource } from './wire.js';
import { encodeLogs } from './encode.js';

/** Caller-facing contract: export resolves after the attempt, never rejects. */
export interface Exporter {
  export(records: LogRecord[]): Promise<void>;
}

export interface ExporterConfig {
  /** Full OTLP logs endpoint URL, e.g. `http://localhost:3100/otlp/v1/logs`. */
  endpoint: string;
  /** Resource created once at `init` and attached to every batch. */
  resource: Resource;
  /** Abort timeout in milliseconds. Defaults to 5000. */
  timeoutMs?: number;
  /**
   * Called with the error on any failure (network rejection, non-2xx, timeout).
   * Do NOT route this through the host logger — that would create a log loop.
   */
  onError?: (err: unknown) => void;
}

/** Create an exporter bound to the given endpoint and resource. */
export function createExporter(config: ExporterConfig): Exporter {
  const { endpoint, resource, onError } = config;
  const timeoutMs = config.timeoutMs ?? 5000;

  return {
    async export(records: LogRecord[]): Promise<void> {
      try {
        const body = JSON.stringify(encodeLogs(resource, records));
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.status !== 200 && response.status !== 204) {
          throw new Error(`OTLP export failed: HTTP ${response.status}`);
        }
      } catch (err) {
        // Swallow all errors — host must never see exceptions from the export path.
        onError?.(err);
      }
    },
  };
}
