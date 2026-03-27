import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeLoggerFactory, loggerFactory } from './logger-factory';
import type { LoggerConfig } from './types';

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
