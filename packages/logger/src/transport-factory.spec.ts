import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeTransportOptions } from './transport-factory';

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
    it('returns pino-pretty transport config', () => {
      const opts = createNodeTransportOptions(false);
      expect(opts.transport).toBeDefined();
      expect(opts.transport?.target).toBe('pino-pretty');
    });

    it('includes translateTime, ignore, and singleLine options', () => {
      const opts = createNodeTransportOptions(false);
      const popts = opts.transport?.options as Record<string, unknown>;
      expect(popts?.translateTime).toBeTruthy();
      expect(popts?.ignore).toContain('pid');
      expect(popts?.ignore).toContain('hostname');
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
    it('returns pino-pretty transport when FORMAT_NODE_LOG is unset', () => {
      delete process.env.FORMAT_NODE_LOG;
      const opts = createNodeTransportOptions(true);
      expect(opts.transport).toBeDefined();
      expect(opts.transport?.target).toBe('pino-pretty');
    });

    it('returns pino-pretty transport when FORMAT_NODE_LOG is "true"', () => {
      process.env.FORMAT_NODE_LOG = 'true';
      const opts = createNodeTransportOptions(true);
      expect(opts.transport).toBeDefined();
      expect(opts.transport?.target).toBe('pino-pretty');
    });

    it('returns pino-pretty transport when FORMAT_NODE_LOG is "1"', () => {
      process.env.FORMAT_NODE_LOG = '1';
      const opts = createNodeTransportOptions(true);
      expect(opts.transport).toBeDefined();
      expect(opts.transport?.target).toBe('pino-pretty');
    });
  });
});
