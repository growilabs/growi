import { PageGrant } from '@growi/core';

import {
  isPubliclyReadablePage,
  type PublicPageFilterSource,
} from './public-page-filter';

describe('isPubliclyReadablePage', () => {
  it('classifies a GRANT_PUBLIC page as publicly readable', () => {
    const page: PublicPageFilterSource = { grant: PageGrant.GRANT_PUBLIC };
    expect(isPubliclyReadablePage(page)).toBe(true);
  });

  it('classifies a legacy page with no grant field as publicly readable', () => {
    // Matches `generateGrantCondition` (~/server/models/page), which puts
    // `{ grant: null }` in the same "anyone may read" branch as GRANT_PUBLIC.
    const page: PublicPageFilterSource = { grant: null };
    expect(isPubliclyReadablePage(page)).toBe(true);
  });

  it('excludes a link-only (GRANT_RESTRICTED) page', () => {
    // "Anyone with a browser" is not the same as "anyone with the specific link".
    const page: PublicPageFilterSource = { grant: PageGrant.GRANT_RESTRICTED };
    expect(isPubliclyReadablePage(page)).toBe(false);
  });

  it('excludes a GRANT_SPECIFIED (named users) page', () => {
    const page: PublicPageFilterSource = { grant: PageGrant.GRANT_SPECIFIED };
    expect(isPubliclyReadablePage(page)).toBe(false);
  });

  it('excludes a GRANT_OWNER page -- even though this predicate takes no actor at all, so there is no owner-context it could be evaluated against', () => {
    // Unlike `ViewerPageFilter`, this function has no `user`/`userGroups`
    // parameter to pass an owner through -- there is no way to make this
    // return `true` for an owner-restricted page, by construction of the
    // function's own signature (see the next test for the signature itself).
    const page: PublicPageFilterSource = { grant: PageGrant.GRANT_OWNER };
    expect(isPubliclyReadablePage(page)).toBe(false);
  });

  it('excludes a GRANT_USER_GROUP page -- even for a group member, for the same no-actor reason', () => {
    const page: PublicPageFilterSource = { grant: PageGrant.GRANT_USER_GROUP };
    expect(isPubliclyReadablePage(page)).toBe(false);
  });

  it('takes exactly one argument, so no caller can pass actor context into it', () => {
    // Regression guard: if someone later adds a `user`/`userGroups` parameter
    // to "help" this function special-case an owner/group-member case (the
    // way `ViewerPageFilter` does), this assertion on the function's own
    // arity catches that mistake even though such a parameter would likely
    // be optional and every existing call site would keep compiling.
    expect(isPubliclyReadablePage.length).toBe(1);
  });
});
