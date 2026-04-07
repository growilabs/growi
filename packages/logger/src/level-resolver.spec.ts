import { describe, expect, it } from 'vitest';

import { resolveLevel } from './level-resolver';
import type { LoggerConfig } from './types';

describe('resolveLevel', () => {
  const baseConfig: LoggerConfig = {
    default: 'info',
    'growi:service:page': 'debug',
    'growi:routes:*': 'debug',
    'growi:crowi': 'debug',
  };

  describe('config pattern matching', () => {
    it('returns default level when no pattern matches', () => {
      const result = resolveLevel('growi:unknown', baseConfig, {});
      expect(result).toBe('info');
    });

    it('returns level for exact namespace match', () => {
      const result = resolveLevel('growi:crowi', baseConfig, {});
      expect(result).toBe('debug');
    });

    it('matches glob wildcard pattern', () => {
      const result = resolveLevel('growi:routes:login', baseConfig, {});
      expect(result).toBe('debug');
    });

    it('does not match partial namespace without wildcard', () => {
      const config: LoggerConfig = {
        default: 'warn',
        'growi:service': 'debug',
      };
      // 'growi:service:page' should NOT match 'growi:service' (no wildcard)
      const result = resolveLevel('growi:service:page', config, {});
      expect(result).toBe('warn');
    });

    it('uses config default when provided', () => {
      const config: LoggerConfig = { default: 'error' };
      const result = resolveLevel('growi:anything', config, {});
      expect(result).toBe('error');
    });
  });

  describe('env override precedence', () => {
    it('env override takes precedence over config pattern', () => {
      const envOverrides = { 'growi:service:page': 'trace' };
      const result = resolveLevel(
        'growi:service:page',
        baseConfig,
        envOverrides,
      );
      expect(result).toBe('trace');
    });

    it('env override glob takes precedence over config exact match', () => {
      const envOverrides = { 'growi:*': 'fatal' };
      const result = resolveLevel('growi:crowi', baseConfig, envOverrides);
      expect(result).toBe('fatal');
    });

    it('falls back to config when no env override matches', () => {
      const envOverrides = { 'other:ns': 'trace' };
      const result = resolveLevel('growi:crowi', baseConfig, envOverrides);
      expect(result).toBe('debug');
    });

    it('falls back to config default when neither env nor config pattern matches', () => {
      const envOverrides = { 'other:ns': 'trace' };
      const result = resolveLevel('growi:unknown:ns', baseConfig, envOverrides);
      expect(result).toBe('info');
    });
  });

  describe('glob pattern matching', () => {
    it('matches deep wildcard patterns', () => {
      const config: LoggerConfig = {
        default: 'info',
        'growi:service:*': 'debug',
      };
      const result = resolveLevel('growi:service:auth', config, {});
      expect(result).toBe('debug');
    });

    it('env override wildcard applies to multiple namespaces', () => {
      const envOverrides = { 'growi:service:*': 'trace' };
      const result1 = resolveLevel(
        'growi:service:page',
        baseConfig,
        envOverrides,
      );
      const result2 = resolveLevel(
        'growi:service:user',
        baseConfig,
        envOverrides,
      );
      expect(result1).toBe('trace');
      expect(result2).toBe('trace');
    });
  });
});
