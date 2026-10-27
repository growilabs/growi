import type { Collection, Document, Filter } from 'mongodb';

import type { IPasswordHashFormatDistribution } from '~/interfaces/password-hash-migration';

import {
  activeUserFilter,
  bothFilter,
  legacyOnlyFilter,
  nonActiveUserFilter,
  noPasswordFilter,
  scopeFilter,
  upgradedOnlyFilter,
} from '../models/user/password-hash-format-filters';

/**
 * Count how many users hold each password-hash format.
 *
 * This is the read-only half of the cleanup lifecycle: an administrator needs the
 * distribution to know whether the (destructive) cleanup can run yet, and the
 * migrate-mongo status migration reports the same four categories to stdout.
 * Classification uses the shared filters in `password-hash-format-filters.ts`, so
 * the UI, the status report, and the cleanup script can never disagree about who
 * falls into which bucket.
 *
 * `legacyOnly` is additionally split by status because only its ACTIVE members
 * block the cleanup — a non-active user cannot be compelled to log in, so counting
 * them as blocking would make the cleanup unreachable indefinitely.
 *
 * Takes the collection as a parameter rather than importing one, so the caller
 * chooses the target (and tests can pass a fixture-seeded collection).
 * `baseFilter` narrows every count to a subset — production passes nothing, integ
 * tests pass a marker scope so they never count documents seeded by other tests.
 *
 * The counts run sequentially on purpose. Each one is effectively a collection
 * scan, so issuing them concurrently would multiply peak memory for a report an
 * administrator opens occasionally — the same trade-off the status migration makes.
 */
export const countPasswordHashFormatDistribution = async (
  usersCollection: Collection,
  baseFilter: Filter<Document> = {},
): Promise<IPasswordHashFormatDistribution> => {
  const upgradedOnly = await usersCollection.countDocuments(
    scopeFilter(baseFilter, upgradedOnlyFilter),
  );
  const both = await usersCollection.countDocuments(
    scopeFilter(baseFilter, bothFilter),
  );
  const legacyOnlyActive = await usersCollection.countDocuments(
    scopeFilter(baseFilter, legacyOnlyFilter, activeUserFilter),
  );
  const legacyOnlyNonActive = await usersCollection.countDocuments(
    scopeFilter(baseFilter, legacyOnlyFilter, nonActiveUserFilter),
  );
  const noPassword = await usersCollection.countDocuments(
    scopeFilter(baseFilter, noPasswordFilter),
  );

  return {
    upgradedOnly,
    both,
    legacyOnly: legacyOnlyActive + legacyOnlyNonActive,
    legacyOnlyActive,
    legacyOnlyNonActive,
    noPassword,
  };
};
