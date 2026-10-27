import { anonymizeUrl } from '../anonymize-url';
import { ANONYMIZATION_RULES } from '.';

const OID = '507f1f77bcf86cd799439011';
const run = (url: string): string | null =>
  anonymizeUrl(url, ANONYMIZATION_RULES);

describe('ANONYMIZATION_RULES', () => {
  describe('page view (P01-P06, P09, P13)', () => {
    it.each`
      url                               | expected
      ${'/wiki/project/documentation'}  | ${'/[HASHED:22ca1a8b9f281349]'}
      ${'/user-name_123/project!'}      | ${'/[HASHED:7aa6a8f4468baa96]'}
      ${'/user/john/projects'}          | ${'/user/[USERNAME_HASHED:96d9632f363564cc]/[HASHED:2577c0f557b2e4b5]'}
      ${'/user/john'}                   | ${'/user/[USERNAME_HASHED:96d9632f363564cc]'}
      ${'/user/john.doe/projects'}      | ${expect.stringMatching(/^\/user\/\[USERNAME_HASHED:[a-f0-9]{16}\]\/\[HASHED:[a-f0-9]{16}\]$/)}
      ${'/v1.2/notes'}                  | ${expect.stringMatching(/^\/\[HASHED:[a-f0-9]{16}\]$/)}
      ${'/%E6%97%A5%E6%9C%AC%E8%AA%9E'} | ${expect.stringMatching(/^\/\[HASHED:[a-f0-9]{16}\]$/)}
      ${`/download/${OID}`}             | ${expect.stringMatching(/^\/\[HASHED:[a-f0-9]{16}\]$/)}
    `('hashes $url', ({ url, expected }) => {
      expect(run(url)).toEqual(expected);
    });

    it('keeps the non-sensitive query and redacts the sensitive one (P03, P09)', () => {
      expect(run('/wiki/project/documentation?tab=a&q=secret')).toBe(
        '/[HASHED:22ca1a8b9f281349]?tab=a&q=%5BANONYMIZED%5D',
      );
    });
  });

  describe('kept pages and system pages (P10-P12)', () => {
    it.each([
      '/',
      '/user',
      `/${OID}`,
      `/${OID}.md`,
      '/admin/app',
      '/me',
      '/login',
      `/_api/v3/page/info?pageId=${OID}`,
      '/_search',
    ])('leaves %s unchanged', (url) => {
      expect(run(url)).toBeNull();
    });
  });

  describe('.md and trash (P07, P08)', () => {
    it('hashes the page path in .md and keeps the suffix', () => {
      expect(run('/wiki/project/documentation.md')).toBe(
        '/[HASHED:22ca1a8b9f281349].md',
      );
    });

    it('hashes the user name in a user page .md', () => {
      expect(run('/user/john.md')).toMatch(
        /^\/user\/\[USERNAME_HASHED:[a-f0-9]{16}\]\.md$/,
      );
    });

    it('hashes the page under /trash and keeps the prefix', () => {
      expect(run('/trash/wiki/project/documentation')).toBe(
        '/trash/[HASHED:22ca1a8b9f281349]',
      );
    });

    it('hashes a user page under /trash', () => {
      expect(run('/trash/user/john/projects')).toBe(
        '/trash/user/[USERNAME_HASHED:96d9632f363564cc]/[HASHED:2577c0f557b2e4b5]',
      );
    });

    it('leaves /trash itself unchanged', () => {
      expect(run('/trash')).toBeNull();
    });
  });

  describe('data URL (N01-N07)', () => {
    it('hashes the page path and keeps buildId and locale (N01)', () => {
      expect(
        run(
          '/_next/data/BID/en_US/wiki/project/documentation.json?path=%2Fa&x=1',
        ),
      ).toBe(
        '/_next/data/BID/en_US/[HASHED:22ca1a8b9f281349].json?path=%5BANONYMIZED%5D&x=1',
      );
    });

    it('hashes the user name (N02)', () => {
      expect(run('/_next/data/BID/ja_JP/user/john.json')).toBe(
        '/_next/data/BID/ja_JP/user/[USERNAME_HASHED:96d9632f363564cc].json',
      );
    });

    it('hashes a trashed page (N03)', () => {
      expect(
        run('/_next/data/BID/en_US/trash/wiki/project/documentation.json'),
      ).toBe('/_next/data/BID/en_US/trash/[HASHED:22ca1a8b9f281349].json');
    });

    it('redacts only the query for search data URLs (N04, N05)', () => {
      expect(run('/_next/data/BID/en_US/_search.json?q=word')).toBe(
        '/_next/data/BID/en_US/_search.json?q=%5BANONYMIZED%5D',
      );
    });

    it('redacts the share link id (N06)', () => {
      expect(run('/_next/data/BID/en_US/share/abc123.json?path=abc123')).toBe(
        '/_next/data/BID/en_US/share/[ANONYMIZED].json?path=%5BANONYMIZED%5D',
      );
    });

    it('leaves the top page data URL unchanged (N07)', () => {
      expect(run('/_next/data/BID/en_US.json')).toBeNull();
    });
  });

  describe('secret values (K01-K05, U07)', () => {
    it.each`
      url                                       | expected
      ${'/share/abc123'}                        | ${'/share/[ANONYMIZED]'}
      ${'/forgot-password/tok'}                 | ${'/forgot-password/[ANONYMIZED]'}
      ${'/user-activation/tok'}                 | ${'/user-activation/[ANONYMIZED]'}
      ${'/_api/v3/share-links/abc123'}          | ${'/_api/v3/share-links/[ANONYMIZED]'}
      ${`/_api/v3/user-groups/${OID}/users/jo`} | ${`/_api/v3/user-groups/${OID}/users/[ANONYMIZED]`}
    `('redacts $url', ({ url, expected }) => {
      expect(run(url)).toBe(expected);
    });

    it('does not treat an encoded slash as a segment separator', () => {
      expect(run(`/_api/v3/user-groups/${OID}/users/a%2Fb`)).toBe(
        `/_api/v3/user-groups/${OID}/users/[ANONYMIZED]`,
      );
    });
  });

  describe('static files (F01, F02)', () => {
    it.each([
      '/_next/static/chunks/main.js',
      '/_drawio-assets/a/b',
      '/uploads/attachment/x.png',
      '/vault.git/info/refs',
      '/favicon.ico',
      '/favicon.svg',
      '/static/logo.png',
      '/images/icons/a.SVG',
    ])('keeps %s', (url) => {
      expect(run(url)).toBeNull();
    });

    it.each([
      '/images/some-page',
      '/images/v1.2',
      '/static/notes.txt',
    ])('hashes %s as a page', (url) => {
      expect(run(url)).toMatch(/^\/\[HASHED:[a-f0-9]{16}\]$/);
    });
  });

  describe('sensitive query parameters (Q01, S, U, A, K04)', () => {
    it.each`
      url                                                              | expected
      ${'/_api/search?q=a&nq=b&limit=10'}                              | ${'/_api/search?q=%5BANONYMIZED%5D&nq=%5BANONYMIZED%5D&limit=10'}
      ${'/_api/v3/users?searchText=jo'}                                | ${'/_api/v3/users?searchText=%5BANONYMIZED%5D'}
      ${'/_api/v3/check-username?username=jo'}                         | ${'/_api/v3/check-username?username=%5BANONYMIZED%5D'}
      ${'/_api/v3/activity?searchFilter=%7B%7D'}                       | ${'/_api/v3/activity?searchFilter=%5BANONYMIZED%5D'}
      ${`/_api/v3/user-groups/${OID}/unrelated-users?searchWord=jo`}   | ${`/_api/v3/user-groups/${OID}/unrelated-users?searchWord=%5BANONYMIZED%5D`}
      ${'/_api/v3/page?path=%2Fa%2Fb&pageId=x'}                        | ${'/_api/v3/page?path=%5BANONYMIZED%5D&pageId=x'}
      ${'/_api/v3/page/exist-paths?fromPath=%2Fa&toPath=%2Fb'}         | ${'/_api/v3/page/exist-paths?fromPath=%5BANONYMIZED%5D&toPath=%5BANONYMIZED%5D'}
      ${'/_api/v3/page/page-paths-with-descendant-count?paths[]=%2Fa'} | ${'/_api/v3/page/page-paths-with-descendant-count?paths[]=%5BANONYMIZED%5D'}
      ${'/_api/v3/page/shared?shareLinkId=abc&pageId=x'}               | ${'/_api/v3/page/shared?shareLinkId=%5BANONYMIZED%5D&pageId=x'}
    `('redacts $url', ({ url, expected }) => {
      expect(run(url)).toBe(expected);
    });
  });
});
