import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createExporter,
  DEFAULT_SCOPE,
  encodeLogs,
} from '../src/core/index.js';
import { buildResource } from '../src/core/index.js';
import type { ExportLogsServiceRequest, LogRecord, Resource } from '../src/core/index.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const resource: Resource = buildResource('test-project', 'test-service');

const sampleRecord: LogRecord = {
  timeUnixNano: '1718632800000000000',
  severityNumber: 9,
  severityText: 'INFO',
  body: { stringValue: 'hello' },
  attributes: [{ key: 'level', value: { stringValue: 'info' } }],
};

// ─── encodeLogs ──────────────────────────────────────────────────────────────

describe('encodeLogs', () => {
  it('produces the correct nested envelope with DEFAULT_SCOPE when no scope given', () => {
    const result = encodeLogs(resource, [sampleRecord]);

    expect(result.resourceLogs).toHaveLength(1);

    const rl = result.resourceLogs[0];
    expect(rl.resource).toBe(resource);
    expect(rl.scopeLogs).toHaveLength(1);

    const sl = rl.scopeLogs[0];
    expect(sl.scope).toEqual(DEFAULT_SCOPE);
    expect(sl.logRecords).toEqual([sampleRecord]);
  });

  it('uses a custom scope when supplied', () => {
    const customScope = { name: 'my-lib', version: '1.0.0' };
    const result = encodeLogs(resource, [sampleRecord], customScope);

    expect(result.resourceLogs[0].scopeLogs[0].scope).toEqual(customScope);
  });

  it('DEFAULT_SCOPE matches the golden fixtures: { name: "observe", version: "0.1.0" }', () => {
    expect(DEFAULT_SCOPE).toEqual({ name: 'observe', version: '0.1.0' });
  });

  it('is JSON.stringify-able and round-trips correctly', () => {
    const result = encodeLogs(resource, [sampleRecord]);
    const roundTripped: ExportLogsServiceRequest = JSON.parse(JSON.stringify(result));
    expect(roundTripped).toEqual(result);
  });
});

// ─── createExporter ──────────────────────────────────────────────────────────

describe('createExporter', () => {
  const ENDPOINT = 'http://localhost:3100/otlp/v1/logs';

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Helper: build a minimal Response-like object
  function makeResponse(status: number): Response {
    return { ok: status >= 200 && status < 300, status } as Response;
  }

  // ── Success paths ──────────────────────────────────────────────────────────

  it('resolves on HTTP 200 and POSTs to the configured endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(200));
    vi.stubGlobal('fetch', mockFetch);

    const exporter = createExporter({ endpoint: ENDPOINT, resource });
    await exporter.export([sampleRecord]);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');

    const body: ExportLogsServiceRequest = JSON.parse(init.body as string);
    expect(body.resourceLogs).toHaveLength(1);
    expect(body.resourceLogs[0].scopeLogs[0].logRecords).toEqual([sampleRecord]);
  });

  it('resolves on HTTP 204', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(204));
    vi.stubGlobal('fetch', mockFetch);

    const exporter = createExporter({ endpoint: ENDPOINT, resource });
    await expect(exporter.export([sampleRecord])).resolves.toBeUndefined();
  });

  // ── Failure paths ──────────────────────────────────────────────────────────

  it('(a) fetch rejection: resolves without throwing and calls onError once', async () => {
    const networkError = new Error('network failure');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));

    const onError = vi.fn();
    const exporter = createExporter({ endpoint: ENDPOINT, resource, onError });

    await expect(exporter.export([sampleRecord])).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(networkError);
  });

  it('(b) non-2xx HTTP 500: resolves without throwing and calls onError once', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(500)));

    const onError = vi.fn();
    const exporter = createExporter({ endpoint: ENDPOINT, resource, onError });

    await expect(exporter.export([sampleRecord])).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    const err = onError.mock.calls[0][0] as Error;
    expect(err.message).toContain('500');
  });

  it('(c) AbortError timeout: resolves without throwing and calls onError once', async () => {
    const abortError = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    const onError = vi.fn();
    const exporter = createExporter({ endpoint: ENDPOINT, resource, onError });

    await expect(exporter.export([sampleRecord])).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0][0] as Error).name).toBe('AbortError');
  });

  it('resolves without throwing when no onError provided and fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('gone')));

    const exporter = createExporter({ endpoint: ENDPOINT, resource });
    await expect(exporter.export([sampleRecord])).resolves.toBeUndefined();
  });
});
