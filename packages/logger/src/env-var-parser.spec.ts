import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseEnvLevels } from './env-var-parser';

describe('parseEnvLevels', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
    delete process.env.DEBUG;
    delete process.env.TRACE;
    delete process.env.INFO;
    delete process.env.WARN;
    delete process.env.ERROR;
    delete process.env.FATAL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns empty object when no env vars are set', () => {
    const result = parseEnvLevels();
    expect(result).toEqual({});
  });

  it('parses a single namespace from DEBUG', () => {
    process.env.DEBUG = 'growi:service:page';
    const result = parseEnvLevels();
    expect(result).toEqual({ 'growi:service:page': 'debug' });
  });

  it('parses multiple comma-separated namespaces from DEBUG', () => {
    process.env.DEBUG = 'growi:routes:*,growi:service:page';
    const result = parseEnvLevels();
    expect(result).toEqual({
      'growi:routes:*': 'debug',
      'growi:service:page': 'debug',
    });
  });

  it('parses all six level env vars', () => {
    process.env.DEBUG = 'ns:debug';
    process.env.TRACE = 'ns:trace';
    process.env.INFO = 'ns:info';
    process.env.WARN = 'ns:warn';
    process.env.ERROR = 'ns:error';
    process.env.FATAL = 'ns:fatal';
    const result = parseEnvLevels();
    expect(result).toEqual({
      'ns:debug': 'debug',
      'ns:trace': 'trace',
      'ns:info': 'info',
      'ns:warn': 'warn',
      'ns:error': 'error',
      'ns:fatal': 'fatal',
    });
  });

  it('trims whitespace around namespace patterns', () => {
    process.env.DEBUG = ' growi:service , growi:routes ';
    const result = parseEnvLevels();
    expect(result).toEqual({
      'growi:service': 'debug',
      'growi:routes': 'debug',
    });
  });

  it('ignores empty entries from trailing/double commas', () => {
    process.env.DEBUG = 'growi:service,,growi:routes,';
    const result = parseEnvLevels();
    expect(result).toEqual({
      'growi:service': 'debug',
      'growi:routes': 'debug',
    });
  });

  it('uses the last value when the same namespace appears in multiple env vars', () => {
    process.env.DEBUG = 'growi:service';
    process.env.TRACE = 'growi:service';
    const result = parseEnvLevels();
    // TRACE is processed after DEBUG, so it wins
    expect(result['growi:service']).toBe('trace');
  });

  it('supports glob wildcard patterns', () => {
    process.env.DEBUG = 'growi:*';
    const result = parseEnvLevels();
    expect(result).toEqual({ 'growi:*': 'debug' });
  });
});
