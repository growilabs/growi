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

  it('gives path-only for a GRANT_PUBLIC page in a CLOSED GROWI -- the closed-GROWI gate applies even to a publicly-graned page (design.md: "リンクの展開...パスだけにする", no public-grant exception stated)', () => {
    const result = buildLinkPreview(pathTarget(PageGrant.GRANT_PUBLIC), false);

    expect(result).toEqual({ path: '/team/onboarding', restricted: true });
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

  it('never includes excerpt/updatedAt/commentCount when restricted', () => {
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
