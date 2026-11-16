import { PageGrant } from '@growi/core';
import { isCreatablePage } from '@growi/core/dist/utils/page-path-utils';

import { decideSummaryPath } from './summary-page-path';

const user = { username: 'alice' };
// Local-time constructor: the date segment is the server's local date, so
// the expectation holds in any time zone.
const NOW = new Date(2026, 10, 16, 9, 30);
const MEMO = '/user/alice/memo/2026-11-16';

const memoPathFor = (title: string): string =>
  decideSummaryPath({ requestedPath: null, user, title, now: NOW }).path;

describe('decideSummaryPath', () => {
  describe('without a requested path', () => {
    it("puts the page in the user's memo area under the date and the title, visible to the user only", () => {
      expect(
        decideSummaryPath({
          requestedPath: null,
          user,
          title: 'Weekly sync',
          now: NOW,
        }),
      ).toEqual({
        path: `${MEMO} Weekly sync`,
        grant: PageGrant.GRANT_OWNER,
      });
    });

    it.each([
      new Date(2026, 10, 16, 0, 0, 0),
      new Date(2026, 10, 16, 23, 59, 59),
    ])('uses the local date of the clock (%s)', (now) => {
      expect(
        decideSummaryPath({ requestedPath: null, user, title: 'T', now }).path,
      ).toBe(`${MEMO} T`);
    });

    it.each([
      ['a slash', 'A/B test', `${MEMO} A B test`],
      ['a backslash', 'C:\\temp notes', `${MEMO} C: temp notes`],
      [
        'characters GROWI paths reject',
        'C++ tips #1? 50%',
        `${MEMO} C tips 1 50`,
      ],
      ['angle brackets and anchors', '<b>^Bold$</b>', `${MEMO} b Bold b`],
      [
        'surrounding and inner whitespace',
        '  Weekly\n\tsync  ',
        `${MEMO} Weekly sync`,
      ],
      ['control characters', 'Line\u0007bell', `${MEMO} Line bell`],
      ['a trailing .md', 'notes.md', `${MEMO} notes`],
      ['repeated trailing .md', 'notes.md .md', `${MEMO} notes`],
      ['a trailing /edit', 'release/edit', `${MEMO} release edit`],
      ['a parent-directory segment', 'a/../b', `${MEMO} a .. b`],
    ])('cleans a title with %s', (_label, title, expected) => {
      const path = memoPathFor(title);

      expect(path).toBe(expected);
      expect(isCreatablePage(path)).toBe(true);
    });

    it('keeps the page directly in the memo area whatever slashes the title has', () => {
      const path = memoPathFor('/a/b/c/');

      expect(path.split('/')).toHaveLength(MEMO.split('/').length);
    });

    it.each([
      ['empty', ''],
      ['only whitespace', '   '],
      ['only rejected characters', '?#%/'],
      ['only .md', '.md'],
    ])('falls back to a fixed title when the title is %s', (_label, title) => {
      const path = memoPathFor(title);

      expect(path).toBe(`${MEMO} Chat summary`);
      expect(isCreatablePage(path)).toBe(true);
    });

    it('cuts a long title to 100 characters', () => {
      const path = memoPathFor('x'.repeat(150));

      expect(path).toBe(`${MEMO} ${'x'.repeat(100)}`);
    });

    it('never cuts a character in half', () => {
      const path = memoPathFor(`${'a'.repeat(99)}😀😀`);

      expect(path).toBe(`${MEMO} ${'a'.repeat(99)}😀`);
    });

    it('drops what cutting leaves at the end that a path cannot end with', () => {
      const path = memoPathFor(`${'a'.repeat(97)}.md and more`);

      expect(path).toBe(`${MEMO} ${'a'.repeat(97)}`);
      expect(isCreatablePage(path)).toBe(true);
    });

    it('treats a blank requested path as none', () => {
      expect(
        decideSummaryPath({ requestedPath: '  ', user, title: 'T', now: NOW }),
      ).toEqual({ path: `${MEMO} T`, grant: PageGrant.GRANT_OWNER });
    });
  });

  describe('with a requested path', () => {
    it.each([
      ['/team/notes', '/team/notes'],
      ['team/notes', '/team/notes'],
      ['  /team/notes/  ', '/team/notes'],
    ])('uses %j as %j and leaves the grant to the default', (requestedPath, path) => {
      expect(
        decideSummaryPath({ requestedPath, user, title: 'ignored', now: NOW }),
      ).toEqual({ path, grant: undefined });
    });
  });
});
