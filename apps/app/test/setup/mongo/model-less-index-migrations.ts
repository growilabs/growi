import type mongoose from 'mongoose';

import * as searchHistoriesUniqueIndex from '~/migrations/20261021120000-add-unique-index-to-searchhistories';

type MongooseDb = NonNullable<typeof mongoose.connection.db>;

type IndexMigration = {
  readonly up: (db: MongooseDb) => Promise<void>;
};

/**
 * Migrations that are the only owner of a collection's indexes because no
 * Mongoose model declares them (Prisma-only collections). The embedded test
 * server never runs migrations, so these are applied to it explicitly.
 * Each `up` must take the raw `db` handle and be idempotent.
 */
export const MODEL_LESS_INDEX_MIGRATIONS: readonly IndexMigration[] = [
  searchHistoriesUniqueIndex,
];

export const applyIndexMigrations = async (
  db: MongooseDb,
  migrations: readonly IndexMigration[],
): Promise<void> => {
  await Promise.all(migrations.map((migration) => migration.up(db)));
};
