import { PageGrant } from '@growi/core';

import {
  buildLinkPreview,
  type LinkPreviewPageSource,
  type LinkPreviewUrlTarget,
  PERMALINK_UNAVAILABLE_MESSAGE,
} from './link-preview-mapper';

const page = (
  grant: PageGrant | null,
  overrides: Partial<LinkPreviewPageSource> = {},
): LinkPreviewPageSource => ({
  grant,
  path: '/team/onboarding',
  body: 'x'.repeat(3000),
  updatedAt: new Date('2026-01-15T09:30:00.000Z'),
  commentCount: 4,
  ...overrides,
});

/** Path-form URL target -- `isPermalink: false`, matching today's callers. */
const pathTarget = (
  grant: PageGrant | null,
  overrides: Partial<LinkPreviewPageSource> = {},
): LinkPreviewUrlTarget => ({
  isPermalink: false,
  page: page(grant, overrides),
});

describe('buildLinkPreview', () => {
  it('gives a full summary for a publicly readable page in an open GROWI', () => {
    const result = buildLinkPreview(pathTarget(PageGrant.GRANT_PUBLIC), true);

    expect(result?.restricted).toBe(false);
    expect(result?.path).toBe('/team/onboarding');
    expect(result?.excerpt).toBe('x'.repeat(2000));
    expect(result?.updatedAt).toBe('2026-01-15T09:30:00.000Z');
    expect(result?.commentCount).toBe(4);
  });

  it('gives path-only for a non-public (GRANT_OWNER) page even in an open GROWI', () => {
    const result = buildLinkPreview(pathTarget(PageGrant.GRANT_OWNER), true);

    expect(result).toEqual({ path: '/team/onboarding', restricted: true });
  });

  describe('a publicly-granted page in a CLOSED GROWI (Requirement 6.9-6.11)', () => {
    const TITLE_ONLY_PERMALINK = {
      path: 'onboarding',
      restricted: true,
      updatedAt: '2026-01-15T09:30:00.000Z',
    };
    const TITLE_ONLY_PATH_URL = {
      path: '/team/onboarding',
      restricted: true,
      updatedAt: '2026-01-15T09:30:00.000Z',
    };

    it('gives only the title and updated-at for a permalink -- never the full path, excerpt or comment count', () => {
      const result = buildLinkPreview(
        { isPermalink: true, page: page(PageGrant.GRANT_PUBLIC) },
        false,
      );

      expect(result).toStrictEqual(TITLE_ONLY_PERMALINK);
    });

    it('gives only the path and updated-at for a path-form URL -- never the excerpt or comment count', () => {
      const result = buildLinkPreview(
        pathTarget(PageGrant.GRANT_PUBLIC),
        false,
      );

      expect(result).toStrictEqual(TITLE_ONLY_PATH_URL);
    });

    it('treats a legacy null-grant page the same as GRANT_PUBLIC, for both a permalink and a path-form URL', () => {
      const permalinkResult = buildLinkPreview(
        { isPermalink: true, page: page(null) },
        false,
      );
      const pathResult = buildLinkPreview(pathTarget(null), false);

      expect(permalinkResult).toStrictEqual(TITLE_ONLY_PERMALINK);
      expect(pathResult).toStrictEqual(TITLE_ONLY_PATH_URL);
    });

    it('uses "/" as the title for a permalink to the root page', () => {
      const result = buildLinkPreview(
        {
          isPermalink: true,
          page: page(PageGrant.GRANT_PUBLIC, { path: '/' }),
        },
        false,
      );

      expect(result).toStrictEqual({
        path: '/',
        restricted: true,
        updatedAt: '2026-01-15T09:30:00.000Z',
      });
    });
  });

  describe('a non-public page in a CLOSED GROWI reveals neither title nor updated-at (Requirement 6.12, 6.8)', () => {
    const nonPublicGrants = [
      { name: 'GRANT_OWNER', grant: PageGrant.GRANT_OWNER },
      { name: 'GRANT_USER_GROUP', grant: PageGrant.GRANT_USER_GROUP },
      { name: 'GRANT_RESTRICTED', grant: PageGrant.GRANT_RESTRICTED },
      { name: 'GRANT_SPECIFIED', grant: PageGrant.GRANT_SPECIFIED },
    ];

    it('answers a not-found permalink with the fixed unavailable message', () => {
      expect(
        buildLinkPreview({ isPermalink: true, page: null }, false),
      ).toStrictEqual({
        path: PERMALINK_UNAVAILABLE_MESSAGE,
        restricted: true,
      });
    });

    it.each(
      nonPublicGrants,
    )('answers a permalink to a page with $name exactly like a not-found permalink', ({
      grant,
    }) => {
      const notFound = buildLinkPreview(
        { isPermalink: true, page: null },
        false,
      );

      const result = buildLinkPreview(
        { isPermalink: true, page: page(grant) },
        false,
      );

      expect(result).toStrictEqual(notFound);
    });

    it.each(
      nonPublicGrants,
    )('gives only the path for a path-form URL to a page with $name', ({
      grant,
    }) => {
      const result = buildLinkPreview(pathTarget(grant), false);

      expect(result).toStrictEqual({
        path: '/team/onboarding',
        restricted: true,
      });
    });
  });

  it('gives path-only for a non-public page in a closed GROWI (both gates fail)', () => {
    const result = buildLinkPreview(
      pathTarget(PageGrant.GRANT_SPECIFIED),
      false,
    );

    expect(result).toEqual({ path: '/team/onboarding', restricted: true });
  });

  it('treats a legacy null-grant page the same as GRANT_PUBLIC', () => {
    const result = buildLinkPreview(pathTarget(null), true);

    expect(result?.restricted).toBe(false);
  });

  it('never includes excerpt/updatedAt/commentCount for a page whose grant is not public', () => {
    const result = buildLinkPreview(
      pathTarget(PageGrant.GRANT_RESTRICTED),
      true,
    );

    expect(result?.excerpt).toBeUndefined();
    expect(result?.updatedAt).toBeUndefined();
    expect(result?.commentCount).toBeUndefined();
  });

  it('truncates a long body to 2000 characters, not the full body', () => {
    const longBody = 'a'.repeat(5000);
    const result = buildLinkPreview(
      pathTarget(PageGrant.GRANT_PUBLIC, { body: longBody }),
      true,
    );

    expect(result?.excerpt).toHaveLength(2000);
  });

  it('does not truncate a body shorter than the limit', () => {
    const shortBody = 'hello world';
    const result = buildLinkPreview(
      pathTarget(PageGrant.GRANT_PUBLIC, { body: shortBody }),
      true,
    );

    expect(result?.excerpt).toBe(shortBody);
  });

  it('returns null for a path-form URL that matched no page (unchanged behavior)', () => {
    const target: LinkPreviewUrlTarget = { isPermalink: false, page: null };

    const result = buildLinkPreview(target, true);

    expect(result).toBeNull();
  });

  it('returns the fixed unavailable message for a permalink that matched no page, instead of null', () => {
    const target: LinkPreviewUrlTarget = { isPermalink: true, page: null };

    const result = buildLinkPreview(target, true);

    expect(result).toEqual({
      path: PERMALINK_UNAVAILABLE_MESSAGE,
      restricted: true,
    });
  });

  it('returns the fixed unavailable message for a permalink that resolved to a private page', () => {
    const target: LinkPreviewUrlTarget = {
      isPermalink: true,
      page: page(PageGrant.GRANT_OWNER),
    };

    const result = buildLinkPreview(target, true);

    expect(result).toEqual({
      path: PERMALINK_UNAVAILABLE_MESSAGE,
      restricted: true,
    });
  });

  it('gives the exact same response for a not-found permalink and a found-but-private permalink (Requirement 6.8: indistinguishable)', () => {
    const notFound = buildLinkPreview({ isPermalink: true, page: null }, true);
    const foundButPrivate = buildLinkPreview(
      { isPermalink: true, page: page(PageGrant.GRANT_OWNER) },
      true,
    );

    // Guards against a vacuous pass: without this, both sides regressing to
    // `null` would also satisfy `toEqual` above.
    expect(notFound).toEqual({
      path: PERMALINK_UNAVAILABLE_MESSAGE,
      restricted: true,
    });
    expect(notFound).toEqual(foundButPrivate);
  });

  it('gives a full summary for a permalink that resolved to a publicly readable page', () => {
    const target: LinkPreviewUrlTarget = {
      isPermalink: true,
      page: page(PageGrant.GRANT_PUBLIC),
    };

    const result = buildLinkPreview(target, true);

    expect(result).toEqual({
      path: '/team/onboarding',
      restricted: false,
      excerpt: 'x'.repeat(2000),
      updatedAt: '2026-01-15T09:30:00.000Z',
      commentCount: 4,
    });
  });
});
