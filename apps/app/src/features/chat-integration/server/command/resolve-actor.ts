// Resolving "who did this" for a request that arrives from the proxy
// (design.md `ResolveActor` -- Requirements 3.6, 3.7, 4.3, 4.4, 4.5, 7.5, 7.6).
//
// A chat account is not, by itself, permission to act. GROWI applies two
// checks to every screen-driven request that `chat_account_links` cannot
// show, and this module is where they are applied instead:
//
//   - the user must be ACTIVE (`middlewares/login-required.ts`)
//   - the user must not be read-only (`middlewares/exclude-read-only-user.ts`)
//
// Both conditions are imported from `~/server/models/user/predicates`, which
// those two middlewares also use, so this path and the screens cannot drift
// apart. If they did, a suspended or deleted person -- who can do nothing in
// the UI -- could create pages from chat and search with their own read
// permissions, and search results are posted into a channel, so paths only
// they could see would be shown to everyone in it.

import type { ChatAccountRef } from '@growi/chat';
import type { IUser } from '@growi/core';
import mongoose, { type HydratedDocument } from 'mongoose';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import {
  isActiveUserStatus,
  isReadOnlyUser,
} from '~/server/models/user/predicates';
import UserGroupRelation from '~/server/models/user-group-relation';

import { ChatAccountLink } from '../account-link/models/chat-account-link';

export interface ResolvedActor {
  /**
   * `null` when the chat account is not linked, **or when the GROWI user it
   * is linked to may not operate**. Decided by "may this person act?", not
   * by "was a row found?".
   *
   * design.md writes this field as `IUser | null`; it is the hydrated
   * document here because every consumer needs `_id` (the search
   * delegator's viewer filter and page creation both take the user
   * document), and `IUser` alone declares no `_id`. A hydrated document is
   * an `IUser`, so nothing design.md states about this field changes.
   */
  readonly user: HydratedDocument<IUser> | null;
  /** Empty whenever `user` is `null`. */
  readonly userGroups: ReadonlyArray<ObjectIdLike>;
  /**
   * Why writes are refused. Kept as three separate reasons because the
   * guidance the person gets differs; they must never be rolled into one.
   */
  readonly writeDenied: 'not-linked' | 'read-only' | 'inactive' | null;
}

const NOT_LINKED: ResolvedActor = Object.freeze({
  user: null,
  userGroups: [],
  writeDenied: 'not-linked',
});

/**
 * An unusable GROWI user is NOT reported as "not linked": that person has
 * already linked their account, so guidance telling them to open a linking
 * URL would change nothing. Requirement 7.6's guidance is reserved for a
 * chat account with no link at all.
 */
const INACTIVE: ResolvedActor = Object.freeze({
  user: null,
  userGroups: [],
  writeDenied: 'inactive',
});

/**
 * Resolves a chat account to the GROWI user allowed to act as it.
 *
 * `relationId` is part of the key, not decoration: a chat platform's member
 * id is only unique within a workspace, so `chat_account_links` is unique on
 * `(relationId, platform, accountId)` (Requirement 7.4) and `ChatAccountRef`
 * carries no workspace axis of its own.
 */
export const resolveActor = async (
  relationId: string,
  actor: ChatAccountRef,
): Promise<ResolvedActor> => {
  const link = await ChatAccountLink.findOne({
    relationId,
    platform: actor.platform,
    accountId: actor.accountId,
  });

  if (link == null) {
    return NOT_LINKED;
  }

  const User = mongoose.model<IUser>('User');
  const user = await User.findById(link.userId);

  // The link row outliving its GROWI user document is reported as inactive
  // rather than not-linked for the same reason as an inactive user, plus one
  // more: the composite unique index would reject a fresh link for this
  // account, so "link your account" would be a loop with no exit.
  if (user == null || !isActiveUserStatus(user.status)) {
    return INACTIVE;
  }

  // Both group sources, exactly as `server/routes/search.ts` collects them
  // for `searchKeyword`. Dropping the external one would silently hide pages
  // from members of an externally-synced group.
  const userGroups: ObjectIdLike[] = [
    ...(await UserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
    ...(await ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(user)),
  ];

  // A read-only user stays the actor: they search with their own view
  // permissions, and only writes are refused (Requirement 4.5).
  return {
    user,
    userGroups,
    writeDenied: isReadOnlyUser(user) ? 'read-only' : null,
  };
};

/**
 * Whether the request may read at all, and if not, why.
 *
 * Requirement 3.7's path (no linked user => return only pages anyone may
 * read) does not look at whether this GROWI shows anything to a visitor who
 * is not logged in. In a closed GROWI, someone who cannot log in sees
 * nothing -- yet a chat search would post the paths and titles of
 * public-scoped pages into a channel, where people without a GROWI account
 * read them. GROWI's own externally-facing page endpoint refuses for exactly
 * this reason (`routes/ogp.ts`: "This GROWI is not public"), and chat search
 * and link previews are endpoints of the same kind.
 *
 * The caller passes `crowi.aclService.isGuestAllowedToRead()`; keeping that
 * lookup out of here leaves this function pure and testable.
 *
 * The return value is the REASON, never a boolean, because the two ways of
 * having no user must not be answered with the same guidance: an inactive
 * person is already linked (see {@link INACTIVE}).
 */
export const resolveReadDenial = (
  resolved: ResolvedActor,
  isGuestAllowedToRead: boolean,
): 'not-linked' | 'inactive' | null => {
  if (resolved.user != null || isGuestAllowedToRead) {
    return null;
  }
  return resolved.writeDenied === 'inactive' ? 'inactive' : 'not-linked';
};
