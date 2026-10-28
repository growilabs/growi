import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { httpInstrumentationConfig } from './anonymize-http-requests';

const runHook = (url: string): Record<string, unknown> => {
  const hook = httpInstrumentationConfig.startIncomingSpanHook;
  if (hook == null) {
    throw new Error('startIncomingSpanHook is not configured');
  }
  return hook(
    mock<IncomingMessage>({ url, headers: { host: 'wiki.example.com' } }),
  );
};

const getHttpTarget = (url: string): unknown => runHook(url)['http.target'];

describe('httpInstrumentationConfig.startIncomingSpanHook', () => {
  describe('page access', () => {
    it.each`
      description                                       | url
      ${'percent-encoded non-ASCII page path'}          | ${'/Sandbox/%E6%97%A5%E6%9C%AC%E8%AA%9E'}
      ${'percent-encoded non-ASCII user sub-page path'} | ${'/user/john/%E6%97%A5%E6%9C%AC%E8%AA%9E'}
      ${'page path decoding to a "?"'}                  | ${'/Sandbox/secret%3Fpage'}
      ${'page path decoding to a "%"'}                  | ${'/Sandbox/secret%25page'}
      ${'page path decoding to a backslash'}            | ${'/Sandbox/secret%5Cpage'}
      ${'page path with a malformed percent-encoding'}  | ${'/Sandbox/secret%E6%97'}
    `('should not leak the path of a $description', ({ url }) => {
      const target = getHttpTarget(url);

      expect(target).toMatch(/\[HASHED:[a-f0-9]{16}\]$/);
      expect(target).not.toMatch(/%[0-9A-Fa-f]{2}|secret/);
    });

    it.each`
      description             | upperCaseUrl              | lowerCaseUrl
      ${'page path'}          | ${'/Sandbox/%E6%97%A5'}   | ${'/Sandbox/%e6%97%a5'}
      ${'user sub-page path'} | ${'/user/john/%E6%97%A5'} | ${'/user/john/%e6%97%a5'}
    `(
      'should anonymize a $description identically regardless of percent-encoding case',
      ({ upperCaseUrl, lowerCaseUrl }) => {
        expect(getHttpTarget(lowerCaseUrl)).toBe(getHttpTarget(upperCaseUrl));
      },
    );

    it('should keep the hash of an ASCII page path unchanged', () => {
      expect(getHttpTarget('/wiki/project/documentation')).toBe(
        '/[HASHED:22ca1a8b9f281349]',
      );
    });
  });

  describe('API requests', () => {
    it('should not let page access anonymization override a page API result', () => {
      const target = getHttpTarget(
        '/_api/v3/pages/list?path=%2FSandbox%2F%E6%97%A5&limit=10',
      );

      expect(target).toMatch(/^\/_api\/v3\/pages\/list\?/);
      expect(target).not.toContain('%E6%97%A5');
    });
  });

  describe('URL attributes other than http.target', () => {
    it('should rebuild http.url from the anonymized target', () => {
      const attributes = runHook('/Sandbox/%E7%A7%98%E5%AF%86?tab=history');

      expect(attributes['http.url']).toBe(
        `http://wiki.example.com${attributes['http.target']}`,
      );
      expect(attributes['http.url']).not.toContain('%E7%A7%98');
    });

    it('should not add http.url when nothing is anonymized', () => {
      expect(runHook('/static/css/style.css')).not.toHaveProperty('http.url');
    });
  });
});
