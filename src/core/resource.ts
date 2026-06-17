// Resource builder — produces exactly the three required OTLP resource attributes.

import { type Resource, stringValue, kv } from './wire.js';

// Prefer the Web Crypto global (Node 18+ main realm, browsers). Fall back to a
// Math.random-based UUID v4 when the global is absent (e.g. vitest VM contexts
// on older Node 18.x patch levels). The instance id is a uniqueness token, not
// a secret, so the weaker fallback is acceptable.
function newInstanceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Build an OTLP Resource for the given project and service.
 *
 * Returns exactly three KeyValue attributes in order:
 *   project, service.name, service.instance.id
 *
 * Each call generates a fresh UUIDv4 instance id — one per process start / init call.
 */
export function buildResource(project: string, service: string): Resource {
  return {
    attributes: [
      kv('project', stringValue(project)),
      kv('service.name', stringValue(service)),
      kv('service.instance.id', stringValue(newInstanceId())),
    ],
  };
}
