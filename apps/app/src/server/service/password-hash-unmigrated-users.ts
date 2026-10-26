import type { Collection, Document, Filter } from 'mongodb';

import type {
  PasswordHashUnmigratedUser,
  PasswordHashUnmigratedUsersResponse,
} from '~/interfaces/password-hash-status';

import {
  legacyOnlyFilter,
  scopeFilter,
} from '../models/user/password-hash-format-filters';

const NO_SCOPE: Filter<Document> = {};

// Scope and exclusion rules: design.md "催促が必要なユーザーの一覧", research.md last section.
export const listUnmigratedUsersToNudge = async (
  users: Collection,
  externalAccounts: Collection,
  options: {
    readonly page: number;
    readonly limit: number;
    readonly baseFilter?: Filter<Document>;
  },
): Promise<PasswordHashUnmigratedUsersResponse> => {
  const { page, limit, baseFilter = NO_SCOPE } = options;

  const linkedUserIds = await externalAccounts.distinct('user');
  const filter = scopeFilter(baseFilter, legacyOnlyFilter, {
    _id: { $nin: linkedUserIds },
  });

  const [docs, totalCount] = await Promise.all([
    users
      .find(filter, { projection: { username: 1, email: 1, lastLoginAt: 1 } })
      .sort({ lastLoginAt: -1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    users.countDocuments(filter),
  ]);

  const rows: PasswordHashUnmigratedUser[] = docs.map((doc) => ({
    _id: doc._id.toString(),
    username: doc.username ?? '',
    email: doc.email ?? null,
    lastLoginAt:
      doc.lastLoginAt != null ? new Date(doc.lastLoginAt).toISOString() : null,
  }));

  return { users: rows, totalCount, page, limit };
};
