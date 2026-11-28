import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:add-indexes-to-pagelinks');

const COLLECTION_NAME = 'pagelinks';

/**
 * `pagelinks` is a prisma-only collection (no mongoose model, no `prisma db push` in
 * deploy), so its indexes must be provisioned here — schema.prisma's @@index/@@unique
 * declarations describe them but create nothing.
 *
 * - fromPage_1_toPath_1 is the correctness-critical one: replaceOutboundLinks upserts
 *   against that filter, and without the unique constraint concurrent replaces of the
 *   same source page can insert duplicate rows, surfacing as duplicated backlinks.
 *   It also serves every fromPage-only lookup (fromPage is the prefix), so a standalone
 *   fromPage index would be dead weight.
 * - toPage_1 is what findBacklinkSources' distinct rides.
 * - toPath_1 serves repointInboundLinks, which filters on toPath alone (the compound
 *   above cannot serve it — wrong prefix).
 *
 * Names match MongoDB's own `<field>_<direction>` convention so they line up with the
 * `map:` values in schema.prisma, and with whatever `prisma db push` would create once
 * the migration off mongoose completes repo-wide.
 */
const INDEXES = [
  { key: { fromPage: 1, toPath: 1 }, options: { unique: true } },
  { key: { toPage: 1 }, options: {} },
  { key: { toPath: 1 }, options: {} },
];

const indexNameOf = (key) =>
  Object.entries(key)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_');

export async function up() {
  logger.info('Apply migration');

  await mongoose.connect(getMongoUri(), mongoOptions);
  const collection = mongoose.connection.collection(COLLECTION_NAME);

  // No dedupe pass before the unique build (unlike the auditlog migration, which
  // retrofitted a constraint onto pre-existing data): this collection has been under the
  // same unique index since it was introduced, and the feature that writes it has not
  // shipped, so no database can hold a duplicate for it to trip over.
  // createIndex creates the collection if absent and is a no-op when the identical index
  // already exists, so this is safe whether or not it was provisioned elsewhere.
  await Promise.all(
    INDEXES.map(({ key, options }) => collection.createIndex(key, options)),
  );
}

export async function down(db) {
  logger.info('Rollback migration');

  await mongoose.connect(getMongoUri(), mongoOptions);

  const items = await db
    .listCollections({ name: COLLECTION_NAME }, { nameOnly: true })
    .toArray();
  if (items.length === 0) {
    return;
  }

  const collection = db.collection(COLLECTION_NAME);
  await Promise.all(
    INDEXES.map(async ({ key }) => {
      const name = indexNameOf(key);
      if (await collection.indexExists(name)) {
        await collection.dropIndex(name);
      }
    }),
  );
}
