/**
 * Winston transport — unit tests (Node layer).
 *
 * Uses the .node.test.ts suffix because the Node ContextManager is registered
 * as a side-effect of importing the node entry (matching context.node.test.ts
 * and span.node.test.ts conventions).
 *
 * Strategy:
 *   - Drive ObserveTransport through a real winston.createLogger() so the test
 *     exercises the actual `info` object shape (including Symbol-keyed fields).
 *   - Mock the SDK `log` via vi.mock() so nothing is enqueued or exported.
 *   - Use a minimal format (no timestamp/label/ms) so attribute assertions stay
 *     exact and are not made brittle by format-injected fields.
 */

// Register the Node ContextManager as a side effect.
import '../src/node/index.js';

import winston from 'winston';
import Transport from 'winston-transport';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock the SDK log ──────────────────────────────────────────────────────────
// Replace `log` with a spy so we can assert what the transport forwards.
// All other core exports remain real.

vi.mock('observe-js', async (importOriginal) => {
  const original = await importOriginal<typeof import('observe-js')>();
  return { ...original, log: vi.fn() };
});

import * as CoreModule from 'observe-js';
import { ObserveTransport } from '../src/node/winston.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A minimal logger — no extra format fields so attrs assertions stay exact. */
function makeLogger(transport: ObserveTransport) {
  return winston.createLogger({
    transports: [transport],
  });
}

const logSpy = vi.mocked(CoreModule.log);

beforeEach(() => {
  logSpy.mockClear();
});

// ── Level mapping ─────────────────────────────────────────────────────────────

describe('winstonLevelToCanonical — contract table', () => {
  const cases: [string, string][] = [
    ['error',   'error'],
    ['warn',    'warn'],
    ['info',    'info'],
    ['http',    'debug'],
    ['verbose', 'debug'],
    ['debug',   'debug'],
    ['silly',   'trace'],
  ];

  for (const [winstonLevel, expected] of cases) {
    it(`"${winstonLevel}" maps to "${expected}"`, () =>
      new Promise<void>((resolve) => {
        const transport = new ObserveTransport();
        const logger = winston.createLogger({
          // Set the level ceiling high enough to pass all Winston levels through.
          level: 'silly',
          transports: [transport],
        });

        logger.log(winstonLevel, 'test');

        transport.once('logged', () => {
          expect(logSpy).toHaveBeenCalledOnce();
          expect(logSpy.mock.calls[0][0]).toBe(expected);
          logSpy.mockClear();
          resolve();
        });
      }));
  }

  it('unknown level falls back to "info"', () =>
    new Promise<void>((resolve) => {
      const transport = new ObserveTransport();
      const logger = winston.createLogger({
        levels: { weird: 0 },
        level: 'weird',
        transports: [transport],
      });

      logger.log('weird', 'test');

      transport.once('logged', () => {
        expect(logSpy).toHaveBeenCalledOnce();
        expect(logSpy.mock.calls[0][0]).toBe('info');
        logSpy.mockClear();
        resolve();
      });
    }));
});

// ── Message and attribute forwarding ─────────────────────────────────────────

describe('message + attrs forwarding', () => {
  it('forwards message and user meta; no level/message keys in attrs', () =>
    new Promise<void>((resolve) => {
      const transport = new ObserveTransport();
      const logger = makeLogger(transport);

      logger.info('hello', { userId: 7, region: 'eu' });

      transport.once('logged', () => {
        expect(logSpy).toHaveBeenCalledOnce();
        const [level, msg, attrs] = logSpy.mock.calls[0];
        expect(level).toBe('info');
        expect(msg).toBe('hello');
        expect(attrs).toEqual({ userId: 7, region: 'eu' });
        resolve();
      });
    }));

  it('omits attrs (undefined) when no meta is present', () =>
    new Promise<void>((resolve) => {
      const transport = new ObserveTransport();
      const logger = makeLogger(transport);

      logger.info('bare message');

      transport.once('logged', () => {
        expect(logSpy).toHaveBeenCalledOnce();
        const [, , attrs] = logSpy.mock.calls[0];
        expect(attrs).toBeUndefined();
        resolve();
      });
    }));

  it('does not leak Symbol-keyed fields into attrs', () =>
    new Promise<void>((resolve) => {
      const transport = new ObserveTransport();
      const logger = makeLogger(transport);

      logger.warn('sym-test', { extra: 'ok' });

      transport.once('logged', () => {
        const [, , attrs] = logSpy.mock.calls[0];
        expect(attrs).toEqual({ extra: 'ok' });
        resolve();
      });
    }));
});

// ── Additive transport ────────────────────────────────────────────────────────

describe('additive — other transports still receive records', () => {
  it('a second no-op transport also receives the record', () =>
    new Promise<void>((resolve) => {
      const observeTransport = new ObserveTransport();
      const received: string[] = [];
      const other = new Transport();
      other.log = (info: Record<string | symbol, unknown>, cb: () => void) => {
        received.push(String(info['message'] ?? ''));
        cb();
      };

      const logger = winston.createLogger({
        transports: [observeTransport, other],
      });

      logger.info('hello from both');

      observeTransport.once('logged', () => {
        // Give the other transport a tick to process.
        setImmediate(() => {
          expect(received).toContain('hello from both');
          resolve();
        });
      });
    }));
});

// ── Never-throw guarantee ─────────────────────────────────────────────────────

describe('never throws / always calls back', () => {
  it('logger stays usable when SDK log spy throws', () =>
    new Promise<void>((resolve) => {
      logSpy.mockImplementationOnce(() => {
        throw new Error('sdk-blow-up');
      });

      const transport = new ObserveTransport();
      const logger = makeLogger(transport);

      // Should not reject / throw; the transport's try/finally must swallow it.
      expect(() => logger.info('trigger-throw')).not.toThrow();

      transport.once('logged', () => {
        // Logger is still functional for subsequent calls.
        logSpy.mockClear();
        logger.info('recovery call');

        transport.once('logged', () => {
          expect(logSpy).toHaveBeenCalledOnce();
          expect(logSpy.mock.calls[0][1]).toBe('recovery call');
          resolve();
        });
      });
    }));
});
