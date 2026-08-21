import fs from 'node:fs';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Model } from 'mongoose';

import loggerFactory from '~/utils/logger';

import * as JSONStream from 'JSONStream';

const logger = loggerFactory('growi:service:import:detect-unique-conflicts');

// Single source of truth for which fields the unique-conflict detection targets,
// kept in sync with the MongoDB unique index definitions (models/user, models/user-group).
export type UserUniqueField = 'username' | 'email' | 'slackMemberId';
export type GroupUniqueField = 'name';
export type UniqueField = UserUniqueField | GroupUniqueField;

// Minimal document shape extracted from the archive / existing data for comparison.
// Sparse unique fields (email, slackMemberId) may be absent, so they are optional/nullable.
export interface UserUniqueFields {
  _id: string;
  username?: string | null;
  email?: string | null;
  slackMemberId?: string | null;
}

export interface GroupUniqueFields {
  _id: string;
  name?: string | null;
}

export interface ExternalAccountUniqueFields {
  _id: string;
  providerType?: string | null;
  accountId?: string | null;
}

export interface ExternalUserGroupUniqueFields {
  _id: string;
  externalId?: string | null;
  name?: string | null;
  provider?: string | null;
}

/**
 * Every value the archive's users hold on a unique field, plus every `_id` it carries.
 *
 * The keys are derived from {@link UserUniqueField} - the same declaration the detection
 * targets - so a unique index added to `users` shows up here as a key whoever builds this
 * has to fill, instead of being silently left out of what consumes it.
 */
export type ArchiveUserIdentity = {
  readonly [Field in UserUniqueField as `${Field}s`]: ReadonlySet<string>;
} & {
  readonly ids: ReadonlySet<string>;
};

export type CollectionName =
  | 'users'
  | 'usergroups'
  | 'externalaccounts'
  | 'externalusergroups';

/**
 * One unique constraint, as a set of fields that are unique *together*.
 *
 * A single-field constraint is the one-element case, so the same declaration covers
 * `username` and `providerType` + `accountId` alike. `label` is what the operator sees
 * (a field name, or something like `providerType+accountId` for a composite key).
 */
export interface UniqueKeySpec<T> {
  label: string;
  fields: readonly (keyof T & string)[];
}

export interface UniqueFieldConflict {
  collection: CollectionName;
  // Widened from the closed union of field names: a composite key's label is not a field
  // name, so it does not fit that union.
  field: string;
  value: string;
  archiveId: string;
  existingId: string;
}

export interface UniqueConflictReport {
  conflictsByCollection: ReadonlyMap<
    CollectionName,
    readonly UniqueFieldConflict[]
  >;
}

export const hasConflicts = (report: UniqueConflictReport): boolean =>
  [...report.conflictsByCollection.values()].some(
    (conflicts) => conflicts.length > 0,
  );

// Sparse unique fields treat null/undefined/empty-string as "not set". Two documents
// that both lack the value do not violate a unique index, so they must not be compared.
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

/**
 * The values one document holds on one unique key, or `null` when it holds none.
 *
 * A key is only violated when every one of its fields carries a value, so a document
 * missing any of them is not matched on that key at all - the sparse-field exclusion
 * above, generalised from a single field to a set of them.
 */
const readKeyValues = <T>(
  doc: T,
  fields: readonly (keyof T & string)[],
): string[] | null => {
  const values: string[] = [];

  for (const field of fields) {
    const value = doc[field];
    if (!isNonEmptyString(value)) return null;
    values.push(value);
  }

  return values;
};

/**
 * The map key a composite unique key is indexed under.
 *
 * Built with `JSON.stringify` over the array rather than by joining the values with a
 * delimiter, because no delimiter is safe here: a field like SAML's `accountId` may hold
 * any string, including the delimiter itself. Joining with `|` makes
 * `{providerType: 'a', accountId: 'b|c'}` and `{providerType: 'a|b', accountId: 'c'}`
 * both read as `a|b|c` and collide, which would report a conflict between two documents
 * that do not actually share a key (requirement 1.2). The array form keeps each value's
 * boundaries explicit, so values can never run into each other.
 */
const toMatchKey = (values: readonly string[]): string =>
  JSON.stringify(values);

// A single-field key reports the bare value, which is what the operator recognises; only
// a composite key needs the array form to show which value belongs to which field.
// Deliberately not routed through `toMatchKey`: how a key is matched and how it is shown
// to an operator are separate concerns and must be free to diverge.
const toReportedValue = (values: readonly string[]): string =>
  values.length === 1 ? values[0] : JSON.stringify(values);

/**
 * Pure comparison: enumerates every archive document whose unique key values match an
 * existing document's under a different `_id`. Receives both datasets as arguments (does
 * not import or fetch them) so it stays reusable and unit-testable.
 */
export function collectConflicts<T extends { _id: string }>(
  collection: CollectionName,
  archiveDocs: readonly T[],
  existingDocs: readonly T[],
  keys: readonly UniqueKeySpec<T>[],
): UniqueFieldConflict[] {
  const conflicts: UniqueFieldConflict[] = [];

  for (const key of keys) {
    // Index existing docs by key value once per key to avoid an N+1 scan per archive doc.
    const existingIdByValue = new Map<string, string>();
    for (const existingDoc of existingDocs) {
      const values = readKeyValues(existingDoc, key.fields);
      if (values == null) continue;
      existingIdByValue.set(toMatchKey(values), existingDoc._id);
    }

    for (const archiveDoc of archiveDocs) {
      const values = readKeyValues(archiveDoc, key.fields);
      if (values == null) continue;

      const existingId = existingIdByValue.get(toMatchKey(values));
      if (existingId == null || existingId === archiveDoc._id) continue;

      conflicts.push({
        collection,
        field: key.label,
        value: toReportedValue(values),
        archiveId: archiveDoc._id,
        existingId,
      });
    }
  }

  return conflicts;
}

// The archive JSON written by the export service is UTF-8 (growiBridgeService.getEncoding).
const ARCHIVE_ENCODING = 'utf-8';

// Existing documents are fetched in `$in` batches so that a huge archive never turns into
// one unbounded query, and the destination collection is never loaded whole into memory.
const EXISTING_LOOKUP_BATCH_SIZE = 1000;

// `users` has three independent single-field unique keys (see models/user.ts): each is
// declared on its own so a document may conflict on one without conflicting on another.
export const USER_UNIQUE_KEYS: readonly UniqueKeySpec<UserUniqueFields>[] = [
  { label: 'username', fields: ['username'] },
  { label: 'email', fields: ['email'] },
  { label: 'slackMemberId', fields: ['slackMemberId'] },
] as const;

const GROUP_UNIQUE_KEYS: readonly UniqueKeySpec<GroupUniqueFields>[] = [
  { label: 'name', fields: ['name'] },
] as const;

// `externalaccounts` has no single-field unique key of its own — only the composite
// {providerType, accountId} index (see models/external-account.ts) — so this is declared
// directly in the new UniqueKeySpec[] form rather than as a flat field-name list.
export const EXTERNAL_ACCOUNT_UNIQUE_KEYS: readonly UniqueKeySpec<ExternalAccountUniqueFields>[] =
  [
    { label: 'providerType+accountId', fields: ['providerType', 'accountId'] },
  ] as const;

// `externalusergroups` has two independent unique keys (see models/external-user-group.ts):
// a single-field key on `externalId` and a composite key on {name, provider}. Both are
// declared here so `collectConflicts` evaluates them separately - a document may conflict
// on one without conflicting on the other.
export const EXTERNAL_USER_GROUP_UNIQUE_KEYS: readonly UniqueKeySpec<ExternalUserGroupUniqueFields>[] =
  [
    { label: 'externalId', fields: ['externalId'] },
    { label: 'name+provider', fields: ['name', 'provider'] },
  ] as const;

type RawDocument = Record<string, unknown>;

/**
 * Read-only projection query over one collection. Handing the detection only this
 * capability (instead of the model itself) is what makes "detection never writes"
 * structural rather than a convention: there is no write method to reach (requirement 2.4).
 */
export type ExistingDocumentLookup = (
  filter: Record<string, unknown>,
  projection: string,
) => Promise<RawDocument[]>;

// Exported so the caller (g2g-transfer.ts) can build a `CollectionInput.lookup` from a
// Mongoose Model without detect-unique-conflicts having to know about Mongoose models at
// its public boundary (only the narrower `ExistingDocumentLookup` capability crosses it).
export const toLookup = <TDoc>(model: Model<TDoc>): ExistingDocumentLookup => {
  return async (filter, projection) =>
    await model.find(filter).select(projection).lean<RawDocument[]>();
};

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

// The archive holds `_id` as a hex string while a lean query result holds an ObjectId.
// Both sides are normalised to a string so that "is this the same document?" compares like
// with like — otherwise every re-imported document would look like a conflict (req 1.5).
const toIdString = (value: unknown): string => String(value);

const pickUserUniqueFields = (doc: RawDocument): UserUniqueFields => ({
  _id: toIdString(doc._id),
  username: asOptionalString(doc.username),
  email: asOptionalString(doc.email),
  slackMemberId: asOptionalString(doc.slackMemberId),
});

const pickGroupUniqueFields = (doc: RawDocument): GroupUniqueFields => ({
  _id: toIdString(doc._id),
  name: asOptionalString(doc.name),
});

export const pickExternalAccountUniqueFields = (
  doc: RawDocument,
): ExternalAccountUniqueFields => ({
  _id: toIdString(doc._id),
  providerType: asOptionalString(doc.providerType),
  accountId: asOptionalString(doc.accountId),
});

export const pickExternalUserGroupUniqueFields = (
  doc: RawDocument,
): ExternalUserGroupUniqueFields => ({
  _id: toIdString(doc._id),
  externalId: asOptionalString(doc.externalId),
  name: asOptionalString(doc.name),
  provider: asOptionalString(doc.provider),
});

// Only the first and last few bytes are inspected, so verifying a multi-gigabyte archive
// costs nothing and the streaming read below keeps its memory profile.
const ARCHIVE_HEAD_TAIL_BYTES = 64;

/**
 * Fails unless the file is a complete top-level JSON array. The export service always
 * writes one (`[` on the first chunk, `]` in the stream's `final`, `[]` for an empty
 * collection - see export.ts generateTransformStream), so anything else means the archive
 * was truncated or is not a collection dump.
 *
 * This check cannot be replaced by anything JSONStream reports: when the root array never
 * closes it emits neither an error nor a completion event, it simply stops yielding
 * documents, and the underlying read stream ends normally at EOF. A truncated archive
 * would therefore be reported as "no conflicts", the caller would start importing, and
 * `bulk.insert()` would silently drop the conflicting documents - the very silent
 * breakage this detection exists to prevent (requirement 2.3, Error Handling: fail fast,
 * never fall through to the import).
 */
const assertCompleteJsonArray = async (jsonPath: string): Promise<void> => {
  const handle = await fs.promises.open(jsonPath, 'r');

  try {
    const { size } = await handle.stat();
    // A zero-byte file yields an empty span, hence no first/last character, and is
    // rejected by the same condition.
    const span = Math.min(ARCHIVE_HEAD_TAIL_BYTES, size);
    const head = Buffer.alloc(span);
    const tail = Buffer.alloc(span);
    await handle.read(head, 0, span, 0);
    await handle.read(tail, 0, span, size - span);

    const first = head.toString(ARCHIVE_ENCODING).trimStart().at(0);
    const last = tail.toString(ARCHIVE_ENCODING).trimEnd().at(-1);

    if (first !== '[' || last !== ']') {
      throw new Error(
        `Archive JSON is not a complete top-level array (truncated or unexpected format): ${jsonPath}`,
      );
    }
  } finally {
    await handle.close();
  }
};

/**
 * Streams one archive JSON (a top-level array of documents) and reduces each document to
 * its unique fields while still inside the stream, so nothing else the archive carries
 * (page bodies, password hashes) is retained past this callback.
 */
const readArchiveUniqueFields = async <T>(
  jsonPath: string,
  pick: (doc: RawDocument) => T,
): Promise<T[]> => {
  await assertCompleteJsonArray(jsonPath);

  const picked: T[] = [];

  await pipeline(
    fs.createReadStream(jsonPath, { encoding: ARCHIVE_ENCODING }),
    JSONStream.parse('*'),
    new Writable({
      objectMode: true,
      write(doc: RawDocument, _encoding, callback) {
        picked.push(pick(doc));
        callback();
      },
    }),
  );

  return picked;
};

const collectArchiveValues = <T>(
  archiveDocs: readonly T[],
  field: keyof T,
): string[] => {
  const values = new Set<string>();

  for (const doc of archiveDocs) {
    const value = doc[field];
    if (isNonEmptyString(value)) {
      values.add(value);
    }
  }

  return [...values];
};

/**
 * Streams the archive's `users.json` and returns every value it occupies on a unique
 * field, plus every `_id` it carries.
 *
 * The detection's own report cannot answer this: it lists the pairs that collide, so a
 * value the source uses and the destination does not never appears in it. The admin
 * rescue needs the whole set — it has to pick a replacement username the source does
 * *not* use (requirement 4.4) and to know whether its own `_id` is about to be taken by
 * an incoming document (requirement 4.10).
 *
 * A truncated archive throws here (via `assertCompleteJsonArray`) rather than yielding a
 * partial set, because a partial set is worse than none: the rescue would pick a name the
 * source actually uses and the re-insertion would fail the unique index.
 */
export async function readArchiveUserIdentity(
  usersJsonPath: string,
): Promise<ArchiveUserIdentity> {
  const archiveDocs = await readArchiveUniqueFields(
    usersJsonPath,
    pickUserUniqueFields,
  );

  return {
    usernames: new Set(collectArchiveValues(archiveDocs, 'username')),
    emails: new Set(collectArchiveValues(archiveDocs, 'email')),
    slackMemberIds: new Set(collectArchiveValues(archiveDocs, 'slackMemberId')),
    // Already normalised to a string by `pickUserUniqueFields`, so this compares like
    // with like against a destination document's ObjectId.
    ids: new Set(collectArchiveValues(archiveDocs, '_id')),
  };
}

const toBatches = <T>(values: readonly T[], size: number): T[][] => {
  const batches: T[][] = [];

  for (let i = 0; i < values.length; i += size) {
    batches.push(values.slice(i, i + size));
  }

  return batches;
};

/**
 * The distinct value tuples the archive occupies on one unique key.
 *
 * De-duplicated through {@link toMatchKey} - the same composition the comparison uses -
 * so a tuple many documents share is asked for once, and skipping documents that do not
 * fill every field of the key is the same sparse-field exclusion {@link readKeyValues}
 * applies (a document holding no value on the key cannot collide on it).
 */
const collectArchiveKeyTuples = <T>(
  archiveDocs: readonly T[],
  fields: readonly (keyof T & string)[],
): string[][] => {
  const tuples = new Map<string, string[]>();

  for (const doc of archiveDocs) {
    const values = readKeyValues(doc, fields);
    if (values == null) continue;
    tuples.set(toMatchKey(values), values);
  }

  return [...tuples.values()];
};

// One `$or` element: every field of the key pinned to the value of one tuple.
const toExactMatchFilter = (
  fields: readonly string[],
  values: readonly string[],
): Record<string, string> =>
  Object.fromEntries(fields.map((field, index) => [field, values[index]]));

/**
 * The queries that fetch the destination documents which could collide on one unique key,
 * batched so that no single query asks for the whole archive's worth of values.
 *
 * A single-field key narrows with `$in` over the values the archive uses - effective
 * because such fields (`username`, `email`) hold a great many distinct values.
 *
 * A composite key must not be narrowed field by field: `externalaccounts.providerType`
 * only ever holds one of a handful of values (`ldap` / `saml` / `oidc` / ...), so an `$in`
 * on it alone matches nearly the entire destination collection and defeats the constraint
 * that the destination is never loaded whole into memory. Each tuple the archive actually
 * uses therefore becomes an exact-match condition over all of the key's fields, gathered
 * into an `$or` - which is also what the collection's own composite index is built for.
 *
 * A key no archive document fills yields no query at all, which is required and not merely
 * an optimisation: MongoDB rejects an empty `$or`.
 */
const buildLookupFilters = <T>(
  archiveDocs: readonly T[],
  key: UniqueKeySpec<T>,
): Record<string, unknown>[] => {
  const tuples = collectArchiveKeyTuples(archiveDocs, key.fields);
  const batches = toBatches(tuples, EXISTING_LOOKUP_BATCH_SIZE);

  if (key.fields.length === 1) {
    const field = key.fields[0];
    return batches.map((batch) => ({
      [field]: { $in: batch.map(([value]) => value) },
    }));
  }

  return batches.map((batch) => ({
    $or: batch.map((values) => toExactMatchFilter(key.fields, values)),
  }));
};

/**
 * Fetches only the destination documents that could collide, projected down to `_id` plus
 * every field any key names. Results are de-duplicated by `_id` because one document can
 * match several keys.
 *
 * Exported for the unit test that pins the shape of the queries this issues - the
 * performance constraint above is a property of the filters, not of what they return.
 */
export const findExistingCandidates = async <T extends { _id: string }>(input: {
  lookup: ExistingDocumentLookup;
  archiveDocs: readonly T[];
  keys: readonly UniqueKeySpec<T>[];
  pick: (doc: RawDocument) => T;
}): Promise<T[]> => {
  const { lookup, archiveDocs, keys, pick } = input;

  const projectedFields = new Set(keys.flatMap((key) => key.fields));
  const projection = ['_id', ...projectedFields].join(' ');
  const existingById = new Map<string, T>();

  for (const key of keys) {
    for (const filter of buildLookupFilters(archiveDocs, key)) {
      // Sequential on purpose: the batches exist to bound how much one query asks for,
      // which firing them all at once would defeat.
      const rawDocs = await lookup(filter, projection);

      for (const rawDoc of rawDocs) {
        const picked = pick(rawDoc);
        existingById.set(picked._id, picked);
      }
    }
  }

  return [...existingById.values()];
};

const detectForCollection = async <T extends { _id: string }>(input: {
  collection: CollectionName;
  jsonPath: string;
  fields: readonly UniqueKeySpec<T>[];
  pick: (doc: RawDocument) => T;
  lookup: ExistingDocumentLookup;
}): Promise<UniqueFieldConflict[]> => {
  const { collection, jsonPath, fields: keys, pick, lookup } = input;

  const archiveDocs = await readArchiveUniqueFields(jsonPath, pick);
  if (archiveDocs.length === 0) {
    return [];
  }

  const existingDocs = await findExistingCandidates({
    lookup,
    archiveDocs,
    keys,
    pick,
  });

  return collectConflicts(collection, archiveDocs, existingDocs, keys);
};

/**
 * One collection's detection, with its unique-key type already resolved.
 *
 * Deliberately non-generic: the minimal document shape differs per collection
 * (`UserUniqueFields`, `ExternalAccountUniqueFields`, ...), so a container that kept that
 * type visible could not hold the four declarations in one homogeneous list without a type
 * assertion. Closing the type inside `detect` is what removes that need.
 */
export interface CollectionDetector {
  readonly collection: CollectionName;
  detect(
    jsonPath: string,
    lookup: ExistingDocumentLookup,
  ): Promise<UniqueFieldConflict[]>;
}

/**
 * Binds one collection's unique-key declaration to the function that extracts those fields.
 *
 * Each call is its own generic instantiation, so `T` is fixed here - which also makes the
 * compiler reject a key list and a pick function that do not describe the same document
 * shape - and the returned {@link CollectionDetector} carries no type parameter.
 */
const declareDetector = <T extends { _id: string }>(
  collection: CollectionName,
  keys: readonly UniqueKeySpec<T>[],
  pick: (doc: RawDocument) => T,
): CollectionDetector => ({
  collection,
  detect: (jsonPath, lookup) =>
    detectForCollection({ collection, jsonPath, fields: keys, pick, lookup }),
});

/**
 * The single source for which collections the detection covers and what makes a document in
 * each of them unique. Adding a collection means adding one entry here; nothing else
 * branches on a collection name.
 */
export const COLLECTION_DETECTORS: readonly CollectionDetector[] = [
  declareDetector('users', USER_UNIQUE_KEYS, pickUserUniqueFields),
  declareDetector('usergroups', GROUP_UNIQUE_KEYS, pickGroupUniqueFields),
  declareDetector(
    'externalaccounts',
    EXTERNAL_ACCOUNT_UNIQUE_KEYS,
    pickExternalAccountUniqueFields,
  ),
  declareDetector(
    'externalusergroups',
    EXTERNAL_USER_GROUP_UNIQUE_KEYS,
    pickExternalUserGroupUniqueFields,
  ),
];

// Counts and field names only: the conflicting values are user data (e-mail addresses,
// slack member ids) and must not reach the log.
const logDetectedConflicts = (report: UniqueConflictReport): void => {
  const conflictCountByCollection: Record<string, number> = {};
  const allConflicts: UniqueFieldConflict[] = [];

  for (const [collection, conflicts] of report.conflictsByCollection) {
    conflictCountByCollection[collection] = conflicts.length;
    allConflicts.push(...conflicts);
  }

  logger.warn(
    {
      conflictCountByCollection,
      fields: [...new Set(allConflicts.map((conflict) => conflict.field))],
    },
    'Unique field conflicts detected before import',
  );
};

/**
 * One collection's declared input to detection: where its archive JSON lives (or `null`
 * when the collection is not part of this transfer) and how to read the destination's
 * existing documents for it. The caller (`g2g-transfer.ts`) builds one of these per
 * collection via {@link toLookup}; this module never imports a Mongoose model directly.
 */
export interface CollectionInput {
  collection: CollectionName;
  jsonPath: string | null;
  lookup: ExistingDocumentLookup;
}

/**
 * Orchestrates the detection for one import target: streams the unique fields out of the
 * archive JSONs, batch-queries the destination for the documents that could collide, and
 * runs the pure comparison. A `null` `jsonPath` means that collection is not part of the
 * transfer, so its detection is skipped rather than failing (requirement 1.6).
 *
 * A collection listed in `replaceTargetCollections` is skipped as well: every document in
 * it is deleted before the archive's are written, so there is nothing left for the
 * archive to collide with and a conflict reported here would abort a transfer that would
 * have succeeded. The set is passed in rather than worked out here — which collections a
 * given import replaces is the caller's knowledge (see replace-target-collections.ts).
 *
 * Every non-skipped collection is resolved against `COLLECTION_DETECTORS` by name. Every
 * `CollectionInput.collection` is a `CollectionName`, and `COLLECTION_DETECTORS` declares
 * exactly one entry per member of that closed union, so the lookup below always finds a
 * match — there is no runtime fallback branch for "no declared detector" because that
 * state is unreachable, not merely unlikely.
 *
 * The destination is only ever read (requirement 2.3).
 */
export async function detectUniqueConflicts(input: {
  collections: readonly CollectionInput[];
  replaceTargetCollections?: ReadonlySet<string>;
}): Promise<UniqueConflictReport> {
  const { collections, replaceTargetCollections } = input;

  // Type predicate (rather than a plain boolean filter) so `jsonPath` narrows to `string`
  // for every survivor below — no type assertion needed to hand it to `detector.detect`.
  const isActive = (
    collectionInput: CollectionInput,
  ): collectionInput is CollectionInput & { jsonPath: string } =>
    collectionInput.jsonPath != null &&
    !(replaceTargetCollections?.has(collectionInput.collection) ?? false);

  const entries = await Promise.all(
    collections.filter(isActive).map(async (collectionInput) => {
      const detector = COLLECTION_DETECTORS.find(
        (candidate) => candidate.collection === collectionInput.collection,
      );
      if (detector == null) {
        throw new Error(
          `No CollectionDetector declared for collection: ${collectionInput.collection}`,
        );
      }

      const conflicts = await detector.detect(
        collectionInput.jsonPath,
        collectionInput.lookup,
      );
      return [collectionInput.collection, conflicts] as const;
    }),
  );

  const report: UniqueConflictReport = {
    conflictsByCollection: new Map(entries),
  };

  if (hasConflicts(report)) {
    logDetectedConflicts(report);
  }

  return report;
}
