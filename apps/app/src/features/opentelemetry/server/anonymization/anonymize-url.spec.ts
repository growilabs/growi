import { type DiagLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { anonymizeUrl } from './anonymize-url';
import type { AnonymizationRules, PathRule } from './rules/types';
import { matchPathPattern } from './utils/path-pattern';

const HASHED_WIKI_PAGE = '/[HASHED:22ca1a8b9f281349]'; // /wiki/project/documentation
const HASHED_USER_JOHN = '/user/[USERNAME_HASHED:96d9632f363564cc]';

const nextData: PathRule = {
  id: 'next-data',
  matches: ({ raw }) => raw.startsWith('/_next/data/') && raw.endsWith('.json'),
  action: { kind: 'unwrap-next-data' },
};
const secretSegments: PathRule = {
  id: 'secret-path-segments',
  matches: ({ raw }) => matchPathPattern('/share/:linkId', raw) != null,
  action: {
    kind: 'redact-pattern-params',
    patterns: [{ pattern: '/share/:linkId', params: ['linkId'] }],
  },
};
const keptTop: PathRule = {
  id: 'kept-pages',
  matches: ({ decoded }) => decoded === '/',
  action: { kind: 'keep' },
};
const pageMarkdown: PathRule = {
  id: 'page-markdown',
  matches: ({ decoded }) => decoded.endsWith('.md'),
  action: { kind: 'hash-page-path-with-suffix', suffix: '.md' },
};
const trashPage: PathRule = {
  id: 'trash-page',
  matches: ({ decoded }) => decoded.startsWith('/trash/'),
  action: { kind: 'hash-page-path-under-prefix', prefix: '/trash' },
};
const pageView: PathRule = {
  id: 'page-view',
  matches: ({ decoded }) => !decoded.startsWith('/_'),
  action: { kind: 'hash-page-path' },
};

const rules: AnonymizationRules = {
  pathRules: [
    nextData,
    secretSegments,
    keptTop,
    pageMarkdown,
    trashPage,
    pageView,
  ],
  sensitiveQueryParams: ['q', 'path'],
};

describe('anonymizeUrl', () => {
  describe('rule order', () => {
    const keepWiki: PathRule = {
      id: 'kept-pages',
      matches: ({ decoded }) => decoded.startsWith('/wiki/'),
      action: { kind: 'keep' },
    };

    it('applies only the first matching rule', () => {
      const url = '/wiki/project/documentation';

      expect(
        anonymizeUrl(url, {
          pathRules: [keepWiki, pageView],
          sensitiveQueryParams: [],
        }),
      ).toBeNull();
      expect(
        anonymizeUrl(url, {
          pathRules: [pageView, keepWiki],
          sensitiveQueryParams: [],
        }),
      ).toBe(HASHED_WIKI_PAGE);
    });
  });

  describe('path actions', () => {
    it.each`
      description                      | url                                    | expected
      ${'hash-page-path'}              | ${'/wiki/project/documentation'}       | ${HASHED_WIKI_PAGE}
      ${'hash-page-path (user page)'}  | ${'/user/john'}                        | ${HASHED_USER_JOHN}
      ${'hash-page-path-with-suffix'}  | ${'/wiki/project/documentation.md'}    | ${`${HASHED_WIKI_PAGE}.md`}
      ${'hash-page-path-under-prefix'} | ${'/trash/wiki/project/documentation'} | ${`/trash${HASHED_WIKI_PAGE}`}
    `('applies $description', ({ url, expected }) => {
      expect(anonymizeUrl(url, rules)).toBe(expected);
    });

    it('hashes the decoded path so that encoded and plain forms give the same value', () => {
      const fromEncoded = anonymizeUrl('/Sandbox/%E6%97%A5', rules);

      expect(fromEncoded).toMatch(/^\/\[HASHED:[0-9a-f]{16}\]$/);
      expect(fromEncoded).toBe(anonymizeUrl('/Sandbox/日', rules));
    });

    it('redacts pattern params on the undecoded path, so an encoded "/" stays inside one segment', () => {
      expect(anonymizeUrl('/share/abc%2Fdef', rules)).toBe(
        '/share/[ANONYMIZED]',
      );
    });
  });

  describe('path and query are anonymized independently', () => {
    it('anonymizes both the path and the query', () => {
      expect(
        anonymizeUrl('/wiki/project/documentation?q=secret&limit=10', rules),
      ).toBe(`${HASHED_WIKI_PAGE}?q=%5BANONYMIZED%5D&limit=10`);
    });

    it('does not let a path page named like a search page restore the query keyword', () => {
      expect(anonymizeUrl('/foo/_search?q=secret', rules)).toMatch(
        /^\/\[HASHED:[0-9a-f]{16}\]\?q=%5BANONYMIZED%5D$/,
      );
    });

    it('keeps the original undecoded path when only the query changes', () => {
      expect(anonymizeUrl('/_api/v3/a%2Fb%20c?q=secret', rules)).toBe(
        '/_api/v3/a%2Fb%20c?q=%5BANONYMIZED%5D',
      );
    });

    it('keeps a malformed percent-encoding in the path as received when only the query changes', () => {
      expect(anonymizeUrl('/_api/v3/a%E6?q=secret', rules)).toBe(
        '/_api/v3/a%E6?q=%5BANONYMIZED%5D',
      );
    });

    it('keeps the query byte-for-byte when only the path changes', () => {
      expect(
        anonymizeUrl('/wiki/project/documentation?limit=10&sort=a%20b', rules),
      ).toBe(`${HASHED_WIKI_PAGE}?limit=10&sort=a%20b`);
    });
  });

  describe('unchanged', () => {
    it.each`
      description                                 | url
      ${'no rule matches and no sensitive query'} | ${'/_api/v3/pages?limit=10'}
      ${'a keep rule matches'}                    | ${'/'}
      ${'the hash action returns the path as-is'} | ${'/58a4569921a8424d00a1aa0e'}
    `('returns null when $description', ({ url }) => {
      expect(anonymizeUrl(url, rules)).toBeNull();
    });
  });

  describe('Next.js data URL', () => {
    it('re-applies the rule list to the inner page path and keeps the build ID and locale', () => {
      expect(
        anonymizeUrl(
          '/_next/data/BID/en_US/wiki/project/documentation.json?path=%2Fwiki%2Fproject',
          rules,
        ),
      ).toBe(
        `/_next/data/BID/en_US${HASHED_WIKI_PAGE}.json?path=%5BANONYMIZED%5D`,
      );
    });

    it('handles a data URL without a locale segment', () => {
      expect(
        anonymizeUrl('/_next/data/BID/wiki/project/documentation.json', rules),
      ).toBe(`/_next/data/BID${HASHED_WIKI_PAGE}.json`);
    });

    it('applies the user page hashing to the inner path', () => {
      expect(anonymizeUrl('/_next/data/BID/en_US/user/john.json', rules)).toBe(
        `/_next/data/BID/en_US${HASHED_USER_JOHN}.json`,
      );
    });

    it('cuts the inner path from the undecoded outer path', () => {
      expect(
        anonymizeUrl('/_next/data/BID/ja_JP/share/abc%2Fdef.json', rules),
      ).toBe('/_next/data/BID/ja_JP/share/[ANONYMIZED].json');
    });

    it('anonymizes only the query when the inner path is kept', () => {
      expect(
        anonymizeUrl('/_next/data/BID/en_US/_search.json?q=secret', rules),
      ).toBe('/_next/data/BID/en_US/_search.json?q=%5BANONYMIZED%5D');
    });

    it('returns null for the top page data URL', () => {
      expect(anonymizeUrl('/_next/data/BID/en_US.json', rules)).toBeNull();
    });
  });

  describe('unexpected failure', () => {
    afterEach(() => {
      diag.disable();
    });

    it('returns the fixed failure value and records a warning', () => {
      const diagLogger = mock<DiagLogger>();
      diag.setLogger(diagLogger, DiagLogLevel.WARN);
      const throwingRule: PathRule = {
        id: 'page-view',
        matches: vi.fn(() => {
          throw new Error('boom');
        }),
        action: { kind: 'hash-page-path' },
      };

      const result = anonymizeUrl('/wiki/secret-page?q=secret', {
        pathRules: [throwingRule],
        sensitiveQueryParams: ['q'],
      });

      expect(result).toBe('/[ANONYMIZATION_FAILED]');
      expect(diagLogger.warn).toHaveBeenCalled();
      expect(JSON.stringify(diagLogger.warn.mock.calls)).not.toContain(
        'secret',
      );
    });
  });
});
