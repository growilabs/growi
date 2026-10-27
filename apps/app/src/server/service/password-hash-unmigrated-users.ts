import type { Collection, Document, Filter } from 'mongodb';

import type {
  IPasswordHashUnmigratedUser,
  IPasswordHashUnmigratedUserList,
} from '~/interfaces/password-hash-migration';

import {
  legacyOnlyFilter,
  scopeFilter,
} from '../models/user/password-hash-format-filters';

/**
 * List the users who still hold an old-format credential, newest login first.
 *
 * WHY a list and not just the count: the count tells an administrator that
 * something is unfinished but nothing about who to approach, so it names a problem
 * without a way to act on it.
 *
 * WHY `lastLoginAt` is part of the row, and why it sorts the list: migration only
 * happens when the local password is verified, while `lastLoginAt` is updated by
 * every strategy (the shared `loginSuccessHandler` in routes/login-passport). So a
 * user who logged in recently and is STILL unmigrated is, by elimination, not
 * signing in with their password — asking them to "please log in" will never clear
 * them. Those users sort to the top, because they are the ones whose presence an
 * administrator would otherwise be unable to explain.
 *
 * `hasExternalAccount` corroborates that reading by naming the likely route in.
 * It is a hint, not a verdict: holding an external account does not prove the user
 * never signs in locally.
 *
 * Takes the collections as parameters rather than importing them, so the caller
 * chooses the target and tests can pass fixture-seeded ones. `baseFilter` narrows
 * the set the same way it does for the cleanup.
 */
export const listPasswordHashUnmigratedUsers = async (
  usersCollection: Collection,
  externalAccountsCollection: Collection,
  options: { page: number; limit: number; baseFilter?: Filter<Document> },
): Promise<IPasswordHashUnmigratedUserList> => {
  const { page, limit, baseFilter = {} } = options;
  const scoped = scopeFilter(baseFilter, legacyOnlyFilter);

  const totalCount = await usersCollection.countDocuments(scoped);

  const docs = await usersCollection
    .find(scoped, {
      projection: { username: 1, email: 1, lastLoginAt: 1, status: 1 },
    })
    // Never-logged-in users sort last: MongoDB orders missing/null before any
    // value ascending, so descending puts the informative rows first.
    .sort({ lastLoginAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  // One lookup for the whole page rather than per row. The field is `user` on
  // disk; `userId` is only the Prisma-side alias (see schema.prisma @map).
  const externalAccounts = await externalAccountsCollection
    .find(
      { user: { $in: docs.map((doc) => doc._id) } },
      { projection: { user: 1 } },
    )
    .toArray();
  const userIdsWithExternalAccount = new Set(
    externalAccounts.map((account) => String(account.user)),
  );

  const users: IPasswordHashUnmigratedUser[] = docs.map((doc) => ({
    _id: String(doc._id),
    username: doc.username ?? '',
    email: doc.email ?? null,
    lastLoginAt:
      doc.lastLoginAt != null ? new Date(doc.lastLoginAt).toISOString() : null,
    status: doc.status,
    hasExternalAccount: userIdsWithExternalAccount.has(String(doc._id)),
  }));

  return { users, totalCount, page, limit };
};
