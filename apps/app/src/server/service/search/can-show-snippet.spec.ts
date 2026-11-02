import { PageGrant } from '@growi/core';

import { canShowSnippetForGrant } from './can-show-snippet';

const page = (
  grant: number,
  grantedUserIds: string[] = [],
  grantedGroupIds: string[] = [],
) => ({ grant, grantedUserIds, grantedGroupIds });

const guest = { userId: null, userGroupIds: null };
const alice = { userId: 'alice', userGroupIds: ['g1'] };

describe('canShowSnippetForGrant', () => {
  it.each([
    ['public', page(PageGrant.GRANT_PUBLIC), guest, true],
    ['no grant (legacy)', page(Number.NaN), guest, true],
    ['link-only', page(PageGrant.GRANT_RESTRICTED), alice, false],
    ['owner page, owner', page(PageGrant.GRANT_OWNER, ['alice']), alice, true],
    ['owner page, other', page(PageGrant.GRANT_OWNER, ['bob']), alice, false],
    ['owner page, guest', page(PageGrant.GRANT_OWNER, ['bob']), guest, false],
    [
      'group page, member',
      page(PageGrant.GRANT_USER_GROUP, [], ['g1']),
      alice,
      true,
    ],
    [
      'group page, non-member',
      page(PageGrant.GRANT_USER_GROUP, [], ['g2']),
      alice,
      false,
    ],
    [
      'group page, guest',
      page(PageGrant.GRANT_USER_GROUP, [], ['g1']),
      guest,
      false,
    ],
    [
      'specified page, granted user',
      page(PageGrant.GRANT_SPECIFIED, ['bob', 'alice']),
      alice,
      true,
    ],
    [
      'specified page, other',
      page(PageGrant.GRANT_SPECIFIED, ['bob']),
      alice,
      false,
    ],
    [
      'specified page, guest',
      page(PageGrant.GRANT_SPECIFIED, ['bob']),
      guest,
      false,
    ],
  ])('%s -> %s', (_label, target, viewer, expected) => {
    expect(canShowSnippetForGrant(target, viewer)).toBe(expected);
  });
});
