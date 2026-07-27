import type { IUser } from '@growi/core';

/**
 * Build the "@alice, @bob and N others" label shown for a page notification's
 * action users.
 *
 * `actionUsers` is typed `IUser[]` but can contain `null` at runtime when a
 * linked activity has no resolvable user: chiefly an activity settled without
 * its request context (a "bare" activity, mostly from editor saves), or one
 * that references a since-removed user. Nulls are dropped before any `.name`
 * access -- otherwise a single null crashes the whole notification list (and,
 * via the error boundary, the entire page) -- and are excluded from the
 * "others" count so the tail number stays accurate. See the server-side filter
 * in `apiv3/in-app-notification.ts` and PR #11510.
 */
export const buildActionUsersLabel = (
  actionUsers: ReadonlyArray<IUser | null | undefined>,
): string => {
  const users = actionUsers.filter((user) => user != null);
  const latestUsers = users.slice(0, 3).map((user) => `@${user.name}`);

  if (latestUsers.length === 1) {
    return latestUsers[0];
  }
  if (users.length >= 4) {
    return `${latestUsers.slice(0, 2).join(', ')} and ${users.length - 2} others`;
  }
  return latestUsers.join(', ');
};
