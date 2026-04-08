import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock pino-http before importing
vi.mock('pino-http', () => {
  const pinoHttp = vi.fn((_opts: unknown) => {
    return (_req: unknown, _res: unknown, next: () => void) => next();
  });
  return { default: pinoHttp };
});

// Mock logger-factory
vi.mock('./logger-factory', () => ({
  loggerFactory: vi.fn(() => ({
    level: 'info',
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  })),
}));

describe('createHttpLoggerMiddleware', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns an Express-compatible middleware function', async () => {
    const { createHttpLoggerMiddleware } = await import('./http-logger');
    const middleware = await createHttpLoggerMiddleware();
    expect(typeof middleware).toBe('function');
  });

  it('uses "express" as the default namespace', async () => {
    const { loggerFactory } = await import('./logger-factory');
    const { createHttpLoggerMiddleware } = await import('./http-logger');
    await createHttpLoggerMiddleware();
    expect(loggerFactory).toHaveBeenCalledWith('express');
  });

  it('accepts a custom namespace', async () => {
    const { loggerFactory } = await import('./logger-factory');
    const { createHttpLoggerMiddleware } = await import('./http-logger');
    await createHttpLoggerMiddleware({ namespace: 'custom-http' });
    expect(loggerFactory).toHaveBeenCalledWith('custom-http');
  });

  it('passes autoLogging options to pino-http', async () => {
    const pinoHttp = (await import('pino-http')).default;
    const { createHttpLoggerMiddleware } = await import('./http-logger');

    const ignoreFn = (req: { url?: string }) =>
      req.url?.startsWith('/_next/') ?? false;
    await createHttpLoggerMiddleware({ autoLogging: { ignore: ignoreFn } });

    expect(pinoHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        autoLogging: { ignore: ignoreFn },
      }),
    );
  });

  it('applies morganLikeFormatOptions in development mode', async () => {
    process.env.NODE_ENV = 'development';
    const pinoHttp = (await import('pino-http')).default;
    const { createHttpLoggerMiddleware } = await import('./http-logger');
    await createHttpLoggerMiddleware();

    expect(pinoHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        customSuccessMessage: expect.any(Function),
        customErrorMessage: expect.any(Function),
        customLogLevel: expect.any(Function),
      }),
    );
  });

  it('does not apply morganLikeFormatOptions in production mode', async () => {
    process.env.NODE_ENV = 'production';
    const pinoHttp = (await import('pino-http')).default;
    const { createHttpLoggerMiddleware } = await import('./http-logger');
    await createHttpLoggerMiddleware();

    const callArgs = (pinoHttp as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(callArgs.customSuccessMessage).toBeUndefined();
    expect(callArgs.customErrorMessage).toBeUndefined();
    expect(callArgs.customLogLevel).toBeUndefined();
  });
});
