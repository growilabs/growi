import mongoose from 'mongoose';

import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
// Imported for its side effect only: the module body registers the `ExternalAccount`
// schema (`getOrCreateModel`), which is what makes the registry lookup below resolve
// instead of throwing MissingSchemaError. The model has no default export to import.
import '~/server/models/external-account';

import userModelFactory from '~/server/models/user';
import UserGroup from '~/server/models/user-group';

import type { CollectionName, UniqueKeySpec } from './detect-unique-conflicts';
import {
  COLLECTION_DETECTORS,
  EXTERNAL_ACCOUNT_UNIQUE_KEYS,
  EXTERNAL_USER_GROUP_UNIQUE_KEYS,
  GROUP_UNIQUE_KEYS,
  USER_UNIQUE_KEYS,
} from './detect-unique-conflicts';

/**
 * Guards requirement 5.1/5.2: the unique keys this detection declares must stay equal to
 * the unique constraints the data model actually defines. A constraint that exists in the
 * database but is missing from the declaration is exactly the silent detection gap this
 * feature was opened for, and the reverse (a declared key with no real constraint) means
 * the detection aborts transfers over a collision the database would have accepted.
 *
 * The reference point for "actually defined" is each model's Mongoose schema, read
 * statically - no database connection is involved, only the schema objects the model
 * modules build at import time.
 *
 * IMPORTANT for `externalaccounts`: its Mongoose schema (`models/external-account.ts`) is
 * temporary code, kept solely so Mongoose creates the collection's indexes until the
 * Mongoose -> Prisma migration described in `.claude/rules/model.md` finishes. When that
 * migration completes and the Mongoose schema is deleted, this test's reference point must
 * switch from `Model.schema.indexes()` to the `@@unique` definitions in
 * `prisma/schema.prisma` (see the Revalidation Triggers section of this feature's
 * design.md).
 */

// The `users` model is a factory that takes the Crowi instance; `null` is accepted and
// only affects the methods (see `validateCrowi` in models/user/index.js), so the schema -
// the only thing this test reads - is fully built without booting anything.
const User = userModelFactory(null);

/**
 * Mongoose types `Schema.indexes()` as `IndexDefinition[]` (a single key -> direction map),
 * but at runtime each element is a `[keys, options]` pair. Reading the result as `unknown[]`
 * and narrowing it below keeps the parsing honest rather than trusting a declared type that
 * does not describe the value.
 */
type SchemaIndexReader = {
  indexes(): unknown[];
};

type SchemaIndexEntry = readonly [
  keys: Record<string, unknown>,
  options: Record<string, unknown>,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const isSchemaIndexEntry = (value: unknown): value is SchemaIndexEntry =>
  Array.isArray(value) &&
  value.length >= 2 &&
  isRecord(value[0]) &&
  isRecord(value[1]);

/**
 * The field groups of every `unique: true` index the schema defines, single-field
 * (`{ username: 1 }`) and compound (`{ providerType: 1, accountId: 1 }`) alike. Mongoose
 * reports both a path-level `unique: true` and a `schema.index(..., { unique: true })` call
 * through the same list, so both forms are covered.
 */
const readUniqueIndexFieldGroups = (
  schema: SchemaIndexReader,
): readonly string[][] =>
  schema
    .indexes()
    .filter(isSchemaIndexEntry)
    .filter(([, options]) => options.unique === true)
    .map(([keys]) => Object.keys(keys));

/**
 * Turns one collection's declared keys into bare field groups.
 *
 * Called once per collection so that each call is its own instantiation of `T` - which is
 * what lets the four differently-typed declarations end up in one homogeneous table below
 * without a type assertion, and is why `CollectionDetector` deliberately does not expose
 * its key declaration (doing so would erase `T`).
 */
const toFieldGroups = <T>(
  keys: readonly UniqueKeySpec<T>[],
): readonly string[][] => keys.map((key) => [...key.fields]);

/**
 * A field group's identity, independent of the order the fields are written in: a unique
 * key is a *set* of fields that are unique together, so `{name, provider}` and
 * `{provider, name}` are the same constraint. Comparing signatures rather than raw arrays
 * keeps a harmless reordering from being reported as drift.
 */
const toSignature = (fields: readonly string[]): string =>
  [...fields].sort().join('+');

const toSignatures = (fieldGroups: readonly string[][]): string[] =>
  fieldGroups.map(toSignature).sort();

interface DriftTarget {
  collection: CollectionName;
  declaredFieldGroups: readonly string[][];
  schema: SchemaIndexReader;
}

const DRIFT_TARGETS: readonly DriftTarget[] = [
  {
    collection: 'users',
    declaredFieldGroups: toFieldGroups(USER_UNIQUE_KEYS),
    schema: User.schema,
  },
  {
    collection: 'usergroups',
    declaredFieldGroups: toFieldGroups(GROUP_UNIQUE_KEYS),
    schema: UserGroup.schema,
  },
  {
    collection: 'externalaccounts',
    declaredFieldGroups: toFieldGroups(EXTERNAL_ACCOUNT_UNIQUE_KEYS),
    // See the note at the top of this file: this schema is temporary and its replacement
    // (prisma/schema.prisma) becomes the reference point once the migration completes.
    schema: mongoose.model('ExternalAccount').schema,
  },
  {
    collection: 'externalusergroups',
    declaredFieldGroups: toFieldGroups(EXTERNAL_USER_GROUP_UNIQUE_KEYS),
    schema: ExternalUserGroup.schema,
  },
];

describe('unique key declarations vs the data model', () => {
  it.each(
    DRIFT_TARGETS,
  )('declares exactly the unique constraints $collection actually defines', ({
    collection,
    declaredFieldGroups,
    schema,
  }) => {
    const declared = toSignatures(declaredFieldGroups);
    const indexed = toSignatures(readUniqueIndexFieldGroups(schema));

    // Reported as one object rather than two separate assertions so a failure names the
    // collection and both directions of the drift (which field combinations are declared
    // without a real constraint, and which real constraints are not declared) at once.
    expect({
      collection,
      declaredButNotIndexed: declared.filter(
        (signature) => !indexed.includes(signature),
      ),
      indexedButNotDeclared: indexed.filter(
        (signature) => !declared.includes(signature),
      ),
    }).toEqual({
      collection,
      declaredButNotIndexed: [],
      indexedButNotDeclared: [],
    });
  });

  // Guards the guard: if a model stopped being reachable, or a Mongoose upgrade changed the
  // shape `indexes()` returns, the comparison above would read an empty constraint list.
  // That would still fail today, but only because the declarations are non-empty - this
  // makes "we are reading nothing at all" fail on its own terms.
  it.each(
    DRIFT_TARGETS,
  )('reads at least one unique index out of $collection', ({ schema }) => {
    expect(readUniqueIndexFieldGroups(schema).length).toBeGreaterThan(0);
  });

  // The declarations above are looked up per collection, so a collection added to the
  // detection without being added here would never be checked for drift.
  it('covers every collection the detection declares a detector for', () => {
    const detected = COLLECTION_DETECTORS.map(
      (detector) => detector.collection,
    ).sort();
    const covered = DRIFT_TARGETS.map((target) => target.collection).sort();

    expect(covered).toEqual(detected);
  });
});
