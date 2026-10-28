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

  // Pinned values equal the pre-change implementation, which hashed the
  // pathname after the same normalization (requirements 9.2)
  describe('request targets the URL parser normalizes', () => {
    const HASHED_B = '/[HASHED:3e23e8160039594a]'; // /b
    const HASHED_A_B = '/[HASHED:c14cddc033f64b9d]'; // /a/b
    const HASHED_BAR = '/[HASHED:fcde2b2edba56bf4]'; // /bar
    const HASHED_SECRET_PAGE = '/[HASHED:26be148f15928561]'; // /secret/page
    const HASHED_WIKI_PAGE_ONLY = '/[HASHED:2f4a824f8eacbc70]'; // /wiki/page

    it.each`
      description                                    | url                                       | expected
      ${'a ".." segment'}                            | ${'/a/../b'}                              | ${HASHED_B}
      ${'an encoded ".." segment'}                   | ${'/a/%2e%2e/b'}                          | ${HASHED_B}
      ${'a "." segment'}                             | ${'/a/./b'}                               | ${HASHED_A_B}
      ${'an encoded "." segment'}                    | ${'/a/%2E/b'}                             | ${HASHED_A_B}
      ${'a backslash'}                               | ${'/a\\b'}                                | ${HASHED_A_B}
      ${'a "." segment in a user page'}              | ${'/user/john/./projects'}                | ${'/user/[USERNAME_HASHED:96d9632f363564cc]/[HASHED:2577c0f557b2e4b5]'}
      ${'a leading "//" (authority)'}                | ${'//foo/bar'}                            | ${HASHED_BAR}
      ${'a leading "//" with one segment'}           | ${'//foo'}                                | ${'/'}
      ${'an absolute-form URL'}                      | ${'http://evil.example/secret/page'}      | ${HASHED_SECRET_PAGE}
      ${'an absolute-form URL with an upper scheme'} | ${'HTTP://evil.example/secret/page'}      | ${HASHED_SECRET_PAGE}
      ${'an absolute-form URL with a query'}         | ${'http://evil.example/secret/page?q=kw'} | ${`${HASHED_SECRET_PAGE}?q=%5BANONYMIZED%5D`}
      ${'a raw non-ASCII path'}                      | ${'/Sandbox/日本語'}                      | ${'/[HASHED:4b62814263afc935]'}
      ${'a raw space'}                               | ${'/a b'}                                 | ${'/[HASHED:c8687a08aa5d6ed2]'}
      ${'an empty query'}                            | ${'/wiki/page?'}                          | ${HASHED_WIKI_PAGE_ONLY}
      ${'a fragment'}                                | ${'/wiki/page#frag'}                      | ${HASHED_WIKI_PAGE_ONLY}
      ${'a query without a path'}                    | ${'?q=kw'}                                | ${'/?q=%5BANONYMIZED%5D'}
      ${'only "?"'}                                  | ${'?'}                                    | ${'/'}
      ${'an empty string'}                           | ${''}                                     | ${'/'}
    `(
      'anonymizes the normalized value for $description',
      ({ url, expected }) => {
        expect(anonymizeUrl(url, rules)).toBe(expected);
      },
    );

    it('returns the normalized value even when no rule changes it, so the raw form is never recorded', () => {
      expect(anonymizeUrl('/_api/v3/../v3/pages?limit=10', rules)).toBe(
        '/_api/v3/pages?limit=10',
      );
    });

    describe('unparsable', () => {
      afterEach(() => {
        diag.disable();
      });

      it.each`
        description                                    | url
        ${'the normalized value has no absolute path'} | ${'foo:secret'}
        ${'the URL cannot be parsed'}                  | ${'http://[secret/page'}
      `(
        'returns the fixed failure value without logging the URL when $description',
        ({ url }) => {
          const diagLogger = mock<DiagLogger>();
          diag.setLogger(diagLogger, DiagLogLevel.WARN);

          expect(anonymizeUrl(url, rules)).toBe('/[ANONYMIZATION_FAILED]');
          expect(diagLogger.warn).toHaveBeenCalled();
          expect(JSON.stringify(diagLogger.warn.mock.calls)).not.toContain(
            'secret',
          );
        },
      );
    });

    it('returns null for a URL that only looks like it needs normalization', () => {
      expect(anonymizeUrl('/_api/v3/pages?from=/.hidden', rules)).toBeNull();
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
