import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeLoggerFactory, loggerFactory } from './logger-factory';
import type { LoggerConfig } from './types';

// ---------------------------------------------------------------------------
// Shared-transport test: pino.transport() must be called exactly once,
// and each namespace logger must be created via rootLogger.child(), not pino().
// ---------------------------------------------------------------------------
describe('shared transport — single Worker thread (Req 11)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('pino');
    vi.resetModules();
  });

  it('pino() and pino.transport() are called once in initializeLoggerFactory; child() is called per namespace', async () => {
    vi.resetModules();

    const childSpy = vi.fn().mockImplementation(() => ({
      level: 'info',
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: childSpy,
    }));

    const mockRootLogger = {
      level: 'trace',
      child: childSpy,
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    };

    const transportSpy = vi.fn().mockReturnValue({});
    const pinoSpy = vi.fn().mockReturnValue(mockRootLogger) as ReturnType<
      typeof vi.fn
    > & {
      transport: ReturnType<typeof vi.fn>;
    };
    pinoSpy.transport = transportSpy;

    vi.doMock('pino', () => ({ default: pinoSpy }));

    const { initializeLoggerFactory: init, loggerFactory: factory } =
      await import('./logger-factory');

    init({ config: { default: 'info', 'growi:debug:*': 'debug' } });

    // After initialization: pino() called once (root logger), transport() called once
    expect(pinoSpy).toHaveBeenCalledTimes(1);
    expect(transportSpy).toHaveBeenCalledTimes(1);

    // Create loggers for three distinct namespaces
    factory('growi:service:page');
    factory('growi:service:user');
    factory('growi:debug:something');

    // pino() must NOT be called again — no new instances, no new Worker threads
    expect(pinoSpy).toHaveBeenCalledTimes(1);
    // transport() must NOT be called again
    expect(transportSpy).toHaveBeenCalledTimes(1);
    // child() must be called once per new namespace
    expect(childSpy).toHaveBeenCalledTimes(3);
  });

  it('re-initializing creates a new root logger (one additional pino() call)', async () => {
    vi.resetModules();

    const childSpy = vi.fn().mockImplementation(() => ({
      level: 'info',
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: childSpy,
    }));

    const mockRootLogger = {
      level: 'trace',
      child: childSpy,
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    };

    const transportSpy = vi.fn().mockReturnValue({});
    const pinoSpy = vi.fn().mockReturnValue(mockRootLogger) as ReturnType<
      typeof vi.fn
    > & {
      transport: ReturnType<typeof vi.fn>;
    };
    pinoSpy.transport = transportSpy;

    vi.doMock('pino', () => ({ default: pinoSpy }));

    const { initializeLoggerFactory: init, loggerFactory: factory } =
      await import('./logger-factory');

    init({ config: { default: 'info' } });
    factory('growi:ns1');

    const callsAfterFirst = pinoSpy.mock.calls.length; // 1

    // Re-initialize — should create a new root logger
    init({ config: { default: 'warn' } });
    factory('growi:ns1');

    expect(pinoSpy).toHaveBeenCalledTimes(callsAfterFirst + 1);
  });
});

// Reset the module-level cache/state between tests
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initializeLoggerFactory + loggerFactory', () => {
  const config: LoggerConfig = {
    default: 'info',
    'growi:debug:*': 'debug',
  };

  it('returns a logger with info() method', () => {
    initializeLoggerFactory({ config });
    const logger = loggerFactory('growi:test');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('returns the same logger instance for the same namespace (cache hit)', () => {
    initializeLoggerFactory({ config });
    const logger1 = loggerFactory('growi:service:page');
    const logger2 = loggerFactory('growi:service:page');
    expect(logger1).toBe(logger2);
  });

  it('returns different logger instances for different namespaces', () => {
    initializeLoggerFactory({ config });
    const logger1 = loggerFactory('growi:service:page');
    const logger2 = loggerFactory('growi:service:user');
    expect(logger1).not.toBe(logger2);
  });

  it('resolves log level from config for matched pattern', () => {
    initializeLoggerFactory({ config });
    const logger = loggerFactory('growi:debug:something');
    expect(logger.level).toBe('debug');
  });

  it('uses default level when no pattern matches', () => {
    initializeLoggerFactory({ config });
    const logger = loggerFactory('growi:unmatched:ns');
    expect(logger.level).toBe('info');
  });

  it('re-initializing clears the cache', () => {
    initializeLoggerFactory({ config });
    const logger1 = loggerFactory('growi:service:page');

    // Re-initialize with different config
    initializeLoggerFactory({ config: { default: 'warn' } });
    const logger2 = loggerFactory('growi:service:page');

    // After re-init, cache is cleared — new instance
    expect(logger1).not.toBe(logger2);
    expect(logger2.level).toBe('warn');
  });
});
