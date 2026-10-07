import { GroupType, PageGrant } from '@growi/core';

import type { IPageGrantData } from '~/interfaces/page';
import { UserGroupPageGrantStatus } from '~/interfaces/page';

import { toPageUpdateGrantParams, toSelectedGrant } from './selected-grant';

describe('toSelectedGrant', () => {
  it('maps the grant of the current page', () => {
    const currentPageGrant: IPageGrantData = { grant: PageGrant.GRANT_OWNER };

    expect(toSelectedGrant(currentPageGrant).grant).toBe(PageGrant.GRANT_OWNER);
  });

  it('returns an empty userRelatedGrantedGroups when groupGrantData is absent', () => {
    const currentPageGrant: IPageGrantData = { grant: PageGrant.GRANT_PUBLIC };

    expect(toSelectedGrant(currentPageGrant).userRelatedGrantedGroups).toEqual(
      [],
    );
  });

  it('includes only groups whose status is isGranted, mapped to { item, type }', () => {
    const currentPageGrant: IPageGrantData = {
      grant: PageGrant.GRANT_USER_GROUP,
      groupGrantData: {
        userRelatedGroups: [
          {
            id: 'granted-group',
            name: 'granted',
            type: GroupType.userGroup,
            status: UserGroupPageGrantStatus.isGranted,
          },
          {
            id: 'not-granted-group',
            name: 'not granted',
            type: GroupType.userGroup,
            status: UserGroupPageGrantStatus.notGranted,
          },
          {
            id: 'cannot-grant-group',
            name: 'cannot grant',
            type: GroupType.externalUserGroup,
            status: UserGroupPageGrantStatus.cannotGrant,
          },
        ],
        nonUserRelatedGrantedGroups: [],
      },
    };

    expect(toSelectedGrant(currentPageGrant).userRelatedGrantedGroups).toEqual([
      { item: 'granted-group', type: GroupType.userGroup },
    ]);
  });
});

describe('toPageUpdateGrantParams', () => {
  // When the grant has not been chosen/loaded (null), the update must omit grant
  // so the server preserves the page's existing grant — see issue #11272.
  it('omits grant fields when no grant is selected (null)', () => {
    expect(toPageUpdateGrantParams(null)).toEqual({
      grant: undefined,
      userRelatedGrantUserGroupIds: undefined,
    });
  });

  it('passes through the selected grant and granted groups', () => {
    const userRelatedGrantedGroups = [
      { item: 'group-1', type: GroupType.userGroup },
    ];

    expect(
      toPageUpdateGrantParams({
        grant: PageGrant.GRANT_USER_GROUP,
        userRelatedGrantedGroups,
      }),
    ).toEqual({
      grant: PageGrant.GRANT_USER_GROUP,
      userRelatedGrantUserGroupIds: userRelatedGrantedGroups,
    });
  });
});
