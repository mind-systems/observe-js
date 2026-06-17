// OTLP/JSON wire types — camelCase encoding per the OpenTelemetry Logs Data Model.
// No serialization logic here; shapes mirror the contract golden record verbatim.

export type AnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { boolValue: boolean }
  | { doubleValue: number };

export type KeyValue = {
  key: string;
  value: AnyValue;
};

export type LogRecord = {
  timeUnixNano: string;
  observedTimeUnixNano?: string;
  severityNumber: number;
  severityText: string;
  eventName?: string;
  body: AnyValue;
  attributes: KeyValue[];
  traceId?: string;
  spanId?: string;
  flags?: number;
};

export type InstrumentationScope = {
  name: string;
  version?: string;
};

export type ScopeLogs = {
  scope: InstrumentationScope;
  logRecords: LogRecord[];
};

export type Resource = {
  attributes: KeyValue[];
};

export type ResourceLogs = {
  resource: Resource;
  scopeLogs: ScopeLogs[];
};

export type ExportLogsServiceRequest = {
  resourceLogs: ResourceLogs[];
};

// Constructor helpers — used by the resource builder and exporter.
export function stringValue(v: string): AnyValue {
  return { stringValue: v };
}

export function kv(key: string, value: AnyValue): KeyValue {
  return { key, value };
}
