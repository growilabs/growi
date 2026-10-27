/**
 * Drift guard: the Page collection must never regain a TTL index.
 *
 * WHY: WIP page expiry used to be enforced by a MongoDB TTL index on
 * `ttlTimestamp`. MongoDB deleted those pages internally, so no application code
 * ran — ancestors kept counting the deleted page (`descendantCount` inflated) and
 * the empty placeholder pages that only hosted it were orphaned. Expiry is now
 * application-driven (WipPageCleanupCronService). Re-adding `expireAfterSeconds`
 * to any Page index would silently reintroduce the whole class of bug, with no
 * test failing anywhere else.
 *
 * Mutation-checked: adding `{ expireAfterSeconds: 1 }` to a Page index turns this
 * RED with a message naming the offending index.
 */
import mongoose from 'mongoose';

import { getPageSchema } from './obsolete-page';
import pageModel from './page';

/**
 * mongoose 6 types Schema#indexes() as IndexDefinition[], but it actually returns
 * [fields, options] tuples. No accurate type is exported, so the shape is declared
 * here and applied at the single call site below.
 */
type SchemaIndexTuple = [
  Record<string, unknown>,
  { expireAfterSeconds?: number } | undefined,
];

describe('Page schema must not declare a TTL index', () => {
  let indexes: SchemaIndexTuple[];
  let schema: mongoose.Schema;

  beforeAll(() => {
    getPageSchema(null);
    pageModel(null);
    schema = mongoose.model('Page').schema;
    indexes = schema.indexes() as unknown as SchemaIndexTuple[];
  });

  it('declares no index with expireAfterSeconds', () => {
    const ttlIndexes = indexes.filter(
      ([, options]) => options?.expireAfterSeconds != null,
    );

    expect(
      ttlIndexes.map(([fields, options]) => ({ fields, options })),
    ).toStrictEqual([]);
  });

  // Guard the guard: if the field or its index is renamed, the assertion above
  // would pass vacuously against an empty/unrelated index list.
  it('still indexes wipExpiredAt, and no longer declares ttlTimestamp', () => {
    const indexedFields = indexes.flatMap(([fields]) => Object.keys(fields));

    expect(indexedFields).toContain('wipExpiredAt');
    expect(indexedFields).not.toContain('ttlTimestamp');
    expect(schema.path('wipExpiredAt')).toBeDefined();
    expect(schema.path('ttlTimestamp')).toBeUndefined();
  });
});
