import { GroupType, PageGrant } from '@growi/core';

import type { IPageGrantData } from '~/interfaces/page';
import { UserGroupPageGrantStatus } from '~/interfaces/page';

import { toSelectedGrant } from './selected-grant';

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
