import type { Collection, Document, Filter } from 'mongodb';

import type { PasswordHashFormatCounts } from '~/interfaces/password-hash-status';

import {
  activeUserFilter,
  bothFilter,
  legacyOnlyFilter,
  nonActiveUserFilter,
  noPasswordFilter,
  scopeFilter,
  upgradedOnlyFilter,
} from '../models/user/password-hash-format-filters';

const NO_SCOPE: Filter<Document> = {};

export const countPasswordHashFormats = async (
  users: Collection,
  baseFilter: Filter<Document> = NO_SCOPE,
): Promise<PasswordHashFormatCounts> => {
  const [
    upgradedOnly,
    both,
    legacyOnlyActive,
    legacyOnlyNonActive,
    noPassword,
  ] = await Promise.all([
    users.countDocuments(scopeFilter(baseFilter, upgradedOnlyFilter)),
    users.countDocuments(scopeFilter(baseFilter, bothFilter)),
    users.countDocuments(
      scopeFilter(baseFilter, legacyOnlyFilter, activeUserFilter),
    ),
    users.countDocuments(
      scopeFilter(baseFilter, legacyOnlyFilter, nonActiveUserFilter),
    ),
    users.countDocuments(scopeFilter(baseFilter, noPasswordFilter)),
  ]);

  return {
    upgradedOnly,
    both,
    legacyOnly: { active: legacyOnlyActive, nonActive: legacyOnlyNonActive },
    noPassword,
  };
};

// Callers own any abort policy (see research.md "CLI では中止し、画面では中止しない理由").
export const unsetLegacyPasswordOfMigratedUsers = async (
  users: Collection,
  baseFilter: Filter<Document> = NO_SCOPE,
): Promise<{ readonly unset: number }> => {
  const result = await users.updateMany(scopeFilter(baseFilter, bothFilter), {
    $unset: { password: '' },
  });
  return { unset: result.modifiedCount };
};
