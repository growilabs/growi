import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';

import { morganLikeFormatOptions } from './morgan-like-format-options';

function fakeReq(method: string, url: string): IncomingMessage {
  return { method, url } as IncomingMessage;
}

function fakeRes(statusCode: number): ServerResponse {
  return { statusCode } as unknown as ServerResponse;
}

describe('morganLikeFormatOptions', () => {
  describe('customSuccessMessage', () => {
    it('formats as METHOD /url STATUS - TIMEms', () => {
      const msg = morganLikeFormatOptions.customSuccessMessage(
        fakeReq('GET', '/page/path'),
        fakeRes(200),
        12.4,
      );
      expect(msg).toBe('GET /page/path 200 - 12ms');
    });

    it('rounds responseTime to nearest integer', () => {
      const msg = morganLikeFormatOptions.customSuccessMessage(
        fakeReq('POST', '/api'),
        fakeRes(201),
        0.7,
      );
      expect(msg).toBe('POST /api 201 - 1ms');
    });
  });

  describe('customErrorMessage', () => {
    it('includes error message', () => {
      const msg = morganLikeFormatOptions.customErrorMessage(
        fakeReq('PUT', '/data'),
        fakeRes(500),
        new Error('db timeout'),
      );
      expect(msg).toBe('PUT /data 500 - db timeout');
    });
  });

  describe('customLogLevel', () => {
    it('returns info for 2xx responses', () => {
      const level = morganLikeFormatOptions.customLogLevel(
        fakeReq('GET', '/'),
        fakeRes(200),
        undefined,
      );
      expect(level).toBe('info');
    });

    it('returns warn for 4xx responses', () => {
      const level = morganLikeFormatOptions.customLogLevel(
        fakeReq('GET', '/'),
        fakeRes(404),
        undefined,
      );
      expect(level).toBe('warn');
    });

    it('returns error for 5xx responses', () => {
      const level = morganLikeFormatOptions.customLogLevel(
        fakeReq('GET', '/'),
        fakeRes(503),
        undefined,
      );
      expect(level).toBe('error');
    });

    it('returns error when error object is present', () => {
      const level = morganLikeFormatOptions.customLogLevel(
        fakeReq('GET', '/'),
        fakeRes(200),
        new Error('unexpected'),
      );
      expect(level).toBe('error');
    });
  });
});
