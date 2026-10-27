import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeTransportOptions } from './transport-factory.js';

describe('createNodeTransportOptions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.FORMAT_NODE_LOG;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('development mode', () => {
    it('returns bunyan-format transport config', () => {
      const opts = createNodeTransportOptions(false);
      expect(opts.transport).toBeDefined();
      expect(opts.transport?.target).toContain('bunyan-format');
    });

    it('passes no options (singleLine defaults to false inside bunyan-format)', () => {
      const opts = createNodeTransportOptions(false);
      expect(opts.transport?.options).toBeUndefined();
    });
  });

  describe('production mode — raw JSON', () => {
    it('returns no transport when FORMAT_NODE_LOG is "false"', () => {
      process.env.FORMAT_NODE_LOG = 'false';
      const opts = createNodeTransportOptions(true);
      expect(opts.transport).toBeUndefined();
    });

    it('returns no transport when FORMAT_NODE_LOG is "0"', () => {
      process.env.FORMAT_NODE_LOG = '0';
      const opts = createNodeTransportOptions(true);
      expect(opts.transport).toBeUndefined();
    });
  });

  describe('production mode — formatted (pino-pretty)', () => {
    // The transport target must be an ABSOLUTE PATH to pino-pretty, not the bare
    // specifier 'pino-pretty'. pino loads transports in a worker thread that
    // resolves a bare specifier relative to the caller; when @growi/logger is
    // bundled (e.g. Next.js SSR via Turbopack) that resolution fails with
    // "unable to determine transport target for pino-pretty" and every page 500s.
    // An absolute path is loaded directly by the worker and works in any context.
    it('resolves pino-pretty to an absolute path when FORMAT_NODE_LOG is unset', () => {
      delete process.env.FORMAT_NODE_LOG;
      const opts = createNodeTransportOptions(true);
      const target = opts.transport?.target as string;
      expect(target).toBeDefined();
      expect(target).not.toBe('pino-pretty');
      expect(isAbsolute(target)).toBe(true);
      expect(target).toContain('pino-pretty');
      expect(existsSync(target)).toBe(true);
    });

    it('resolves pino-pretty to an absolute path when FORMAT_NODE_LOG is "true"', () => {
      process.env.FORMAT_NODE_LOG = 'true';
      const opts = createNodeTransportOptions(true);
      const target = opts.transport?.target as string;
      expect(isAbsolute(target)).toBe(true);
      expect(target).toContain('pino-pretty');
    });

    it('resolves pino-pretty to an absolute path when FORMAT_NODE_LOG is "1"', () => {
      process.env.FORMAT_NODE_LOG = '1';
      const opts = createNodeTransportOptions(true);
      const target = opts.transport?.target as string;
      expect(isAbsolute(target)).toBe(true);
      expect(target).toContain('pino-pretty');
    });

    it('returns singleLine: true for concise one-liner output', () => {
      delete process.env.FORMAT_NODE_LOG;
      const opts = createNodeTransportOptions(true);
      const popts = opts.transport?.options as Record<string, unknown>;
      expect(popts?.singleLine).toBe(true);
    });
  });
});
