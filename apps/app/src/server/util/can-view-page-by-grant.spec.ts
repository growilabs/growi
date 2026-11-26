import { PageGrant } from '@growi/core';

import { canViewPageByGrant } from './can-view-page-by-grant';

const linkOnly = {
  grant: PageGrant.GRANT_RESTRICTED,
  grantedUserIds: [],
  grantedGroupIds: [],
};
const alice = { userId: 'alice', userGroupIds: [] };
const guest = { userId: null, userGroupIds: null };

// The rest of the grant matrix is covered through canShowSnippetForGrant.
describe('canViewPageByGrant on a link-only page', () => {
  it.each([
    [true, alice, true],
    [true, guest, true],
    [false, alice, false],
    [false, guest, false],
  ])('includeAnyoneWithTheLink=%s lets %o view it: %s', (includeAnyoneWithTheLink, viewer, expected) => {
    expect(
      canViewPageByGrant(linkOnly, viewer, { includeAnyoneWithTheLink }),
    ).toBe(expected);
  });
});
