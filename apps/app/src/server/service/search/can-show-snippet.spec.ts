import { PageGrant } from '@growi/core';
import mongoose from 'mongoose';

import {
  canShowSnippetForGrant,
  snippetGrantFieldsOf,
} from './can-show-snippet';

const page = (
  grant: number | null | undefined,
  grantedUserIds: string[] = [],
  grantedGroupIds: string[] = [],
) => ({ grant, grantedUserIds, grantedGroupIds });

const guest = { userId: null, userGroupIds: null };
const alice = { userId: 'alice', userGroupIds: ['g1'] };

describe('canShowSnippetForGrant', () => {
  it.each([
    ['public', page(PageGrant.GRANT_PUBLIC), guest, true],
    ['no grant (legacy null)', page(null), guest, true],
    ['no grant (legacy, field missing)', page(undefined), guest, true],
    ['unknown grant value', page(9), alice, false],
    ['unknown grant value, guest', page(9), guest, false],
    ['NaN grant', page(Number.NaN), alice, false],
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

describe('snippetGrantFieldsOf', () => {
  const groupId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  it('reads ObjectIds, string ids and populated documents', () => {
    expect(
      snippetGrantFieldsOf({
        grant: PageGrant.GRANT_USER_GROUP,
        grantedUsers: [userId, 'u2', { _id: 'u3' }],
        grantedGroups: [
          { item: groupId, type: 'UserGroup' },
          { item: 'g2', type: 'ExternalUserGroup' },
          { item: { _id: 'g3' }, type: 'UserGroup' },
        ],
      }),
    ).toEqual({
      grant: PageGrant.GRANT_USER_GROUP,
      grantedUserIds: [userId.toString(), 'u2', 'u3'],
      grantedGroupIds: [groupId.toString(), 'g2', 'g3'],
    });
  });

  it.each([
    ['an entry without item', [{ type: 'UserGroup' }]],
    [
      'an entry whose item is undefined',
      [{ item: undefined, type: 'UserGroup' }],
    ],
    ['an entry whose item is null', [{ item: null, type: 'UserGroup' }]],
    ['a null entry', [null]],
    ['an undefined entry', [undefined]],
    ['a bare ObjectId (no { item, type })', [groupId]],
    ['a bare string id (no { item, type })', [groupId.toString()]],
  ])('treats %s as not granted, without throwing', (_label, grantedGroups) => {
    const fields = snippetGrantFieldsOf({
      grant: PageGrant.GRANT_USER_GROUP,
      grantedUsers: [],
      grantedGroups,
    });

    expect(fields.grantedGroupIds).toEqual([]);
    expect(
      canShowSnippetForGrant(fields, {
        userId: 'alice',
        userGroupIds: [groupId.toString()],
      }),
    ).toBe(false);
  });

  it('drops null granted users and keeps the valid ones', () => {
    expect(
      snippetGrantFieldsOf({
        grant: PageGrant.GRANT_OWNER,
        grantedUsers: [null, undefined, userId],
      }).grantedUserIds,
    ).toEqual([userId.toString()]);
  });

  it('treats missing or null grant arrays as empty', () => {
    expect(
      snippetGrantFieldsOf({
        grant: PageGrant.GRANT_USER_GROUP,
        grantedUsers: null,
        grantedGroups: undefined,
      }),
    ).toEqual({
      grant: PageGrant.GRANT_USER_GROUP,
      grantedUserIds: [],
      grantedGroupIds: [],
    });
  });
});
