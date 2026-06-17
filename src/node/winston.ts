// Winston transport adapter — subpath export `observe-js/winston`.
//
// Prerequisites:
//   - The host must call `init(opts)` once at bootstrap before attaching this
//     transport. The transport forwards records through `log()` only; it does
//     not call `init()` itself.
//   - Add ObserveTransport as one more entry in the logger's `transports` array.
//     It is purely additive — existing console/file transports are unaffected.
//
// Usage (ESM):
//   import { ObserveTransport } from 'observe-js/winston';
//
// Usage (CJS):
//   const { ObserveTransport } = require('observe-js/winston');

import Transport from 'winston-transport';
import type { Level } from '../core/index.js';
import { log } from '../core/index.js';

// ── Level mapping ─────────────────────────────────────────────────────────────
// Per the contract (otlp-logging-contract.md, Winston host→canonical row).

function winstonLevelToCanonical(level: string): Level {
  switch (level) {
    case 'error':   return 'error';
    case 'warn':    return 'warn';
    case 'info':    return 'info';
    case 'http':    return 'debug';
    case 'verbose': return 'debug';
    case 'debug':   return 'debug';
    case 'silly':   return 'trace';
    default:        return 'info'; // unknown → nearest by meaning
  }
}

// ── Transport class ───────────────────────────────────────────────────────────

/**
 * ObserveTransport — a Winston transport that forwards log records through the
 * observe-js SDK. Drop it into a Winston logger's `transports` array; no
 * call-site changes are needed in the host application.
 *
 * The host is responsible for calling `init(opts)` before any logs flow.
 */
export class ObserveTransport extends Transport {
  constructor(opts?: Transport.TransportStreamOptions) {
    super(opts);
  }

  log(info: Record<string | symbol, unknown>, callback: () => void): void {
    try {
      // Resolve the raw level from the Symbol-keyed field (avoids colorized
      // strings injected by host formats like colorize()) with fallback to
      // the plain `level` string key.
      const rawLevel =
        (info[Symbol.for('level')] as string | undefined) ??
        (info['level'] as string | undefined) ??
        '';

      const canonical = winstonLevelToCanonical(rawLevel);

      // Coerce message to string; never throw on unusual message shapes.
      const msg = String(
        info['message'] !== undefined && info['message'] !== null
          ? info['message']
          : '',
      );

      // Build attrs from own string-keyed enumerable properties, dropping the
      // two reserved string keys (`level`, `message`). Symbol-keyed fields
      // (Symbol.for('level'), Symbol.for('message'), Symbol.for('splat')) are
      // already excluded by Object.keys(), so no extra stripping is needed.
      const rawAttrs: Record<string, unknown> = {};
      let hasAttrs = false;
      for (const key of Object.keys(info)) {
        if (key === 'level' || key === 'message') continue;
        rawAttrs[key] = info[key as string];
        hasAttrs = true;
      }

      log(canonical, msg, hasAttrs ? rawAttrs : undefined);
    } catch {
      // Swallow all errors — the transport must never throw into the host
      // logger. The SDK log() is already non-throwing; this guard covers
      // level/attr-extraction edge cases and SDK mock surprises in tests.
    } finally {
      // Decouple the two obligations so a throwing `logged` listener cannot
      // prevent the stream callback from firing (which would stall backpressure).
      // `logged` fires on the next tick per Winston convention; `callback()` is
      // called directly so the writable stream can always advance.
      setImmediate(() => this.emit('logged', info));
      callback();
    }
  }
}
