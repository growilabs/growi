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

const FACETS = {
  upgradedOnly: upgradedOnlyFilter,
  both: bothFilter,
  legacyOnlyActive: scopeFilter({}, legacyOnlyFilter, activeUserFilter),
  legacyOnlyNonActive: scopeFilter({}, legacyOnlyFilter, nonActiveUserFilter),
  noPassword: noPasswordFilter,
} as const satisfies Record<string, Filter<Document>>;

type FacetResult = Partial<
  Record<keyof typeof FACETS, readonly { readonly n: number }[]>
>;

// One collection scan for all buckets (design.md "レビュー（code-review high）を受けた修正").
export const countPasswordHashFormats = async (
  users: Collection,
  baseFilter: Filter<Document> = {},
): Promise<PasswordHashFormatCounts> => {
  const facetStages = Object.fromEntries(
    Object.entries(FACETS).map(([name, filter]) => [
      name,
      [{ $match: filter }, { $count: 'n' }],
    ]),
  );
  const [result = {}] = await users
    .aggregate<FacetResult>([
      { $match: baseFilter },
      // $facet buffers every matched document; keep only the fields FACETS reads.
      { $project: { password: 1, passwordHash: 1, status: 1 } },
      { $facet: facetStages },
    ])
    .toArray();
  // $count emits no document for an empty bucket, so a missing entry means 0.
  const countOf = (name: keyof typeof FACETS): number =>
    result[name]?.[0]?.n ?? 0;

  return {
    upgradedOnly: countOf('upgradedOnly'),
    both: countOf('both'),
    legacyOnly: {
      active: countOf('legacyOnlyActive'),
      nonActive: countOf('legacyOnlyNonActive'),
    },
    noPassword: countOf('noPassword'),
  };
};

// Callers own any abort policy (see research.md "CLI では中止し、画面では中止しない理由").
export const unsetLegacyPasswordOfMigratedUsers = async (
  users: Collection,
  baseFilter: Filter<Document> = {},
): Promise<{ readonly unset: number }> => {
  const result = await users.updateMany(scopeFilter(baseFilter, bothFilter), {
    $unset: { password: '' },
  });
  return { unset: result.modifiedCount };
};
